import {
  acknowledgeReminder,
  AiUnavailableError,
  ask,
  describeImage,
  extractTasks,
  quickAddText,
  type ExtractedTask,
  applyTaskAction,
  listTasks,
  notes,
  projects,
  slugify,
  TASK_ACTIONS,
  TaskLineConflictError,
  TaskNotFoundError,
  tasks,
  todayInTz,
  todayView,
  type TaskAction,
} from "@omnicore/core";
import { eq, like, or, sql } from "drizzle-orm";
import { Bot, GrammyError, type BotConfig, type Context } from "grammy";
import type { AppContext } from "../context.js";
import { esc, formatExtracted, formatProject, formatTaskCreated, formatToday, getMiniAppUrl, HELP, partialKeyboard, reminderKeyboard } from "./format.js";
import { InlineKeyboard } from "grammy";
import { randomBytes } from "node:crypto";
import { runDigest } from "../ai.js";
import { installMenus } from "./menu.js";

const COMMANDS = [
  { command: "menu", description: "Buttons for everything" },
  { command: "new", description: "New task, step by step" },
  { command: "todo", description: "Add a task (!p1 @today #project/x)" },
  { command: "today", description: "Today's list" },
  { command: "note", description: "Capture a note into the inbox" },
  { command: "project", description: "Project status" },
  { command: "search", description: "Search notes and tasks" },
  { command: "ask", description: "Ask a question about your notes" },
  { command: "standup", description: "Morning summary" },
  { command: "retro", description: "End-of-day review" },
  { command: "log", description: "Add a line to today's log" },
  { command: "help", description: "How to use this bot" },
];

const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024; // Bot API download limit

export function createBot(app: AppContext, botConfig?: BotConfig<Context>): Bot {
  const { config, db } = app;
  const apiRoot = config.TELEGRAM_API_ROOT.replace(/\/+$/, "");
  const bot = new Bot(config.TELEGRAM_BOT_TOKEN!, { ...botConfig, client: { apiRoot, ...botConfig?.client } });
  const allowed = new Set(config.TELEGRAM_ALLOWED_USER_IDS);
  const warned = new Set<number>();

  // --- auth: only allow-listed users; tell strangers their id so setup is easy ---
  bot.use(async (ctx, next) => {
    const id = ctx.from?.id;
    if (id && allowed.has(id)) return next();
    if (id && !warned.has(id)) {
      warned.add(id);
      console.warn(`[telegram] rejected user ${id} (@${ctx.from?.username ?? "?"})`);
      if (ctx.chat?.type === "private") {
        await ctx.reply(`⛔ Not authorised.\nYour Telegram user id is <code>${id}</code> — put it in .env as TELEGRAM_ALLOWED_USER_IDS=${id} and run <code>docker compose up -d</code>.`, {
          parse_mode: "HTML",
        });
      }
    }
    if (ctx.callbackQuery) await ctx.answerCallbackQuery().catch(() => {});
  });

  const html = (ctx: Context, text: string, extra: object = {}) => ctx.reply(text, { parse_mode: "HTML", ...extra });

  // Menus, the new-task card and project screens; search/ask/digest are defined below.
  const menus = installMenus(bot, app, {
    search: (ctx, q) => searchReply(ctx, q),
    ask: (ctx, q) => askReply(ctx, q),
    digest: (ctx, kind) => digestReply(ctx, kind),
  });
  bot.command("start", (ctx) => menus.sendStart(ctx));
  bot.command("menu", (ctx) => menus.sendMenu(ctx));
  bot.command("new", (ctx) => menus.newTask(ctx));
  bot.command("help", (ctx) => html(ctx, HELP, { reply_markup: new InlineKeyboard().text("☰ Menu", "m:menu") }));

  bot.command("todo", async (ctx) => {
    const text = ctx.match.trim();
    if (!text) return html(ctx, "Usage: <code>/todo Title !p1 @today 18:00 #project/homelab</code>");
    const t = await app.tasks.create({ text });
    await html(ctx, formatTaskCreated(t), { reply_markup: reminderKeyboard(t.id) });
  });

  bot.command("log", async (ctx) => {
    if (!ctx.match.trim()) return html(ctx, "Usage: <code>/log text</code>");
    const path = await app.tasks.appendLog(ctx.match);
    await ctx.react("✍").catch(() => html(ctx, `Logged to <code>${esc(path)}</code>`));
  });

  bot.command("note", async (ctx) => {
    const [first, ...rest] = ctx.match.split("\n");
    const title = first?.trim();
    if (!title) return html(ctx, "Usage:\n<code>/note Title\ncontent…</code>");
    const path = await app.tasks.captureNote(title, rest.join("\n"));
    await html(ctx, `🗒 Saved to <code>${esc(path)}</code>`);
  });

  bot.command("today", async (ctx) => {
    const { text, keyboard } = formatToday(todayView(db, config.TIMEZONE));
    await html(ctx, text, { reply_markup: keyboard });
  });

  bot.command("project", async (ctx) => {
    const q = ctx.match.trim();
    if (!q) return menus.showProjects(ctx);
    const p = db
      .select()
      .from(projects)
      .where(or(eq(projects.slug, slugify(q)), sql`lower(${projects.title}) like ${`%${q.toLowerCase()}%`}`))
      .get();
    if (!p) return html(ctx, `No project matching <b>${esc(q)}</b>.`, { reply_markup: new InlineKeyboard().text(`➕ Create “${q.slice(0, 24)}”`, `pjc:${slugify(q).slice(0, 50)}`).text("📁 All projects", "m:proj") });
    await menus.openProject(ctx, p.id);
  });

  bot.command("search", (ctx) => {
    if (!ctx.match.trim()) return html(ctx, "Usage: <code>/search words</code>, or tap 🔍 Search in the ☰ Menu");
    return searchReply(ctx, ctx.match);
  });
  async function searchReply(ctx: Context, input: string) {
    const q = input.trim().replace(/[%_\\]/g, "");
    if (q.length < 2) return html(ctx, "Search needs at least 2 characters.");
    const pat = `%${q}%`;
    const noteHits = db
      .select({ title: notes.title, path: notes.path, content: notes.content })
      .from(notes)
      .where(or(like(notes.title, pat), like(notes.content, pat)))
      .limit(8)
      .all();
    const taskHits = db.select().from(tasks).where(like(tasks.title, pat)).limit(8).all();
    if (!noteHits.length && !taskHits.length) return html(ctx, `Nothing found for <b>${esc(q)}</b>.`);
    const lines = [`🔎 <b>${esc(q)}</b>`];
    if (taskHits.length) lines.push("", "<b>Tasks</b>", ...taskHits.map((t) => `${t.status === "done" ? "☑️" : "◻️"} ${esc(t.title)}`));
    if (noteHits.length) {
      lines.push("", "<b>Notes</b>");
      for (const n of noteHits) {
        const i = n.content.toLowerCase().indexOf(q.toLowerCase());
        // Slice by UTF-16 index, then drop any half of an emoji (surrogate pair) cut at either edge.
        const snip = i >= 0
          ? n.content.slice(Math.max(0, i - 40), i + 60).replace(/\s+/g, " ").replace(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/g, "")
          : "";
        lines.push(`📄 <b>${esc(n.title)}</b> <code>${esc(n.path)}</code>${snip ? `\n   <i>…${esc(snip)}…</i>` : ""}`);
      }
    }
    await html(ctx, lines.join("\n"));
  }

  // --- AI ---
  const deps = () => ({ db, ai: app.ai, semantic: app.semantic, nag: app.nag });
  const aiError = (e: unknown) =>
    e instanceof AiUnavailableError
      ? e.reason === "busy"
        ? "⏳ The AI is busy with something else — try again in a minute."
        : e.reason === "disabled"
          ? `🤖 ${esc(e.message)}`
          : "🤖 The AI model didn't answer (is Ollama running?). I'll keep working without it."
      : null;

  /** Long AI work runs off the update loop so reminder buttons stay responsive. */
  const background = (ctx: Context, work: () => Promise<void>) => {
    void ctx.replyWithChatAction("typing").catch(() => {});
    work().catch(async (e: unknown) => {
      const msg = aiError(e);
      if (!msg) console.error("[telegram] ai", e);
      await ctx.reply(msg ?? "⚠️ Something went wrong — check the server log.", { parse_mode: "HTML" }).catch(() => {});
    });
  };

  bot.command("ask", (ctx) => {
    if (ctx.match.trim().length < 3) return html(ctx, "Usage: <code>/ask what did I decide about the core switch?</code>");
    askReply(ctx, ctx.match);
  });
  function askReply(ctx: Context, input: string) {
    const q = input.trim();
    if (q.length < 3) return void html(ctx, "That question is too short.");
    background(ctx, async () => {
      const r = await ask(deps(), q);
      const cited = r.sources.filter((s) => r.cited.includes(s.n));
      const list = (cited.length ? cited : r.sources.slice(0, 3))
        .map((s) => `[${s.n}] ${s.kind === "task" ? "☑️" : "📄"} ${esc(s.title)}${s.path ? ` <code>${esc(s.path)}</code>` : ""}`)
        .join("\n");
      await html(ctx, `${esc(r.answer)}${list ? `\n\n<b>Sources</b>${r.timeRange ? ` <i>(${esc(r.timeRange)})</i>` : ""}\n${list}` : ""}`);
    });
  }

  function digestReply(ctx: Context, kind: "standup" | "retro") {
    background(ctx, async () => {
      const d = await runDigest(app, kind);
      if (d.empty) return void (await html(ctx, kind === "standup" ? "Nothing done yesterday and nothing scheduled today." : "Nothing done or open today."));
      await html(ctx, `${kind === "standup" ? "🌅 <b>Standup</b>" : "🌙 <b>Today in review</b>"}\n\n${esc(d.text)}\n\n<i>Saved to ${esc(d.path)}</i>`);
    });
  }
  for (const kind of ["standup", "retro"] as const) bot.command(kind, (ctx) => digestReply(ctx, kind));

  // Tasks found in a voice note wait here (in SQLite, so a restart doesn't lose them) for a tap.
  const PENDING_TTL_MS = 3 * 86_400_000;
  const putPending = (payload: unknown) => {
    const id = randomBytes(6).toString("hex");
    db.$client.prepare("DELETE FROM ai_pending WHERE created_at < ?").run(new Date(Date.now() - PENDING_TTL_MS).toISOString());
    db.$client.prepare("INSERT INTO ai_pending(id, kind, payload) VALUES (?, 'voice-tasks', ?)").run(id, JSON.stringify(payload));
    return id;
  };
  const takePending = (id: string) => {
    const row = db.$client.prepare("SELECT payload FROM ai_pending WHERE id = ? AND kind = 'voice-tasks'").get(id) as { payload: string } | undefined;
    if (row) db.$client.prepare("DELETE FROM ai_pending WHERE id = ?").run(id);
    return row ? (JSON.parse(row.payload) as { tasks: ExtractedTask[] }) : undefined;
  };

  bot.callbackQuery(/^ai:(add|skip):([0-9a-f]{12})$/, async (ctx) => {
    const [, what, id] = ctx.match as RegExpMatchArray as [string, string, string];
    const pending = takePending(id);
    const msg = ctx.callbackQuery.message;
    const finish = (note: string) =>
      msg && "text" in msg && msg.text ? ctx.editMessageText(`${msg.text}\n\n${note}`, { entities: msg.entities }).catch(() => {}) : undefined;
    if (!pending) {
      await ctx.answerCallbackQuery("Already handled");
      return void (await ctx.editMessageReplyMarkup().catch(() => {}));
    }
    if (what === "skip") {
      await ctx.answerCallbackQuery("Skipped");
      return void (await finish("✖ Skipped — the transcript stays in today's log."));
    }
    const created = [];
    for (const t of pending.tasks) created.push(await app.tasks.create({ text: quickAddText(t) }));
    await ctx.answerCallbackQuery(`Added ${created.length}`);
    await finish(`✅ Added ${created.length === 1 ? "1 task" : `${created.length} tasks`} to today's note.`);
  });

  // --- inline keyboards ---
  bot.callbackQuery(/^undo:([A-Za-z0-9_-]+)$/, async (ctx) => {
    try {
      await app.tasks.restore(ctx.match![1]!);
      await ctx.answerCallbackQuery("Restored");
      await ctx.editMessageText("↩️ Restored.").catch(() => {});
    } catch (e) {
      await ctx.answerCallbackQuery((e as Error).message.slice(0, 180));
    }
  });

  bot.callbackQuery(/^t:([a-z0-9]+):(.+)$/, async (ctx) => {
    const [, action, id] = ctx.match as RegExpMatchArray as [string, string, string];
    const msg = ctx.callbackQuery.message;
    if (msg) acknowledgeReminder(db, String(msg.chat.id), msg.message_id);

    if (action === "menu") return void (await ctx.editMessageReplyMarkup({ reply_markup: partialKeyboard(id) }), await ctx.answerCallbackQuery());
    if (action === "back") return void (await ctx.editMessageReplyMarkup({ reply_markup: reminderKeyboard(id) }), await ctx.answerCallbackQuery());
    if (action === "del") {
      const task = app.tasks.get(id);
      await ctx.answerCallbackQuery();
      return void (await ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard().text(`🗑 Yes, delete “${task.title.slice(0, 24)}”`, `t:delok:${id}`).row().text("⬅️ No, keep it", `t:back:${id}`) }));
    }
    if (action === "delok") {
      const r = await app.tasks.delete(id);
      await ctx.answerCallbackQuery("Deleted");
      const kb = r.undo ? new InlineKeyboard().text("↩️ Undo", `undo:${r.undo}`) : undefined;
      return void (await ctx.editMessageText(`🗑 <s>${esc(r.title)}</s>\nDeleted${r.removed > 1 ? ` with ${r.removed - 1} subtask${r.removed > 2 ? "s" : ""}` : ""}. You can undo this for 15 minutes.`, { parse_mode: "HTML", reply_markup: kb }));
    }
    if (action === "rem") {
      const task = app.tasks.get(id);
      await ctx.answerCallbackQuery();
      return void (await menus.askRemark(ctx, id, task.title));
    }
    if (!(TASK_ACTIONS as readonly string[]).includes(action)) return void (await ctx.answerCallbackQuery("Unknown action"));

    const { summary } = await applyTaskAction(app.tasks, id, action as TaskAction, { tomorrowTime: config.TOMORROW_TIME });
    await ctx.answerCallbackQuery(summary);
    if (msg && "text" in msg && msg.text) {
      // Append the outcome, keep original formatting via entities, drop the keyboard.
      await ctx.editMessageText(`${msg.text}\n\n${summary}`, { entities: msg.entities }).catch(() => {});
    }
  });

  const refreshToday = async (ctx: Context) => {
    const { text, keyboard } = formatToday(todayView(db, config.TIMEZONE));
    await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: keyboard }).catch((e: unknown) => {
      if (!(e instanceof GrammyError && e.description.includes("not modified"))) throw e;
    });
  };
  bot.callbackQuery(/^td:(.+)$/, async (ctx) => {
    const { summary, task } = await applyTaskAction(app.tasks, ctx.match![1]!, "done");
    await ctx.answerCallbackQuery(`${summary}: ${task.title}`);
    await refreshToday(ctx);
  });
  bot.callbackQuery("today:r", async (ctx) => {
    await refreshToday(ctx);
    await ctx.answerCallbackQuery("Refreshed");
  });

  // --- media → vault/attachments + log line; voice → transcript + tasks, photo → note (when AI is set up) ---
  const saveMedia = async (ctx: Context, fileId: string, kind: string, ext: string, size?: number) => {
    if (size && size > MAX_ATTACHMENT_BYTES) return void (await html(ctx, "That file is over Telegram's 20 MB bot download limit."));
    const file = await ctx.api.getFile(fileId);
    const res = await fetch(`${apiRoot}/file/bot${config.TELEGRAM_BOT_TOKEN}/${file.file_path}`);
    if (!res.ok) throw new Error(`download failed: ${res.status}`);
    const now = new Date();
    const day = todayInTz(config.TIMEZONE, now);
    // Only a short alphanumeric extension from the server-supplied name; the rest of the path is ours.
    const fromServer = file.file_path?.split("/").pop()?.split(".").slice(1).pop() ?? "";
    const fileExt = fromServer.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8) || ext;
    const rel = `attachments/${day.slice(0, 7)}/${day}_${now.getTime().toString(36)}_${kind}.${fileExt}`;
    const bytes = new Uint8Array(await res.arrayBuffer());
    await app.vault.writeBinaryAtomic(rel, bytes);
    const caption = ctx.message?.caption?.trim();
    const icon = { photo: "📷", voice: "🎤", audio: "🎵", video: "🎬", document: "📎" }[kind] ?? "📎";

    if ((kind === "voice" || kind === "audio") && app.ai.canTranscribe) {
      background(ctx, async () => {
        const transcript = await app.ai.transcribe(bytes, rel.split("/").pop()!, kind === "voice" ? "audio/ogg" : "audio/mpeg");
        await app.tasks.appendLog(`${icon} ![[${rel}]] ${transcript || "(no speech)"}`, now);
        if (!transcript || !app.ai.enabled) return void (await html(ctx, formatExtracted(transcript, "", [])));
        let found: Awaited<ReturnType<typeof extractTasks>>;
        try {
          found = await extractTasks(deps(), transcript);
        } catch (e) {
          if (!(e instanceof AiUnavailableError)) throw e;
          return void (await html(ctx, `🎤 <i>${esc(transcript.slice(0, 700))}</i>\n\nSaved to today's log. I couldn't check it for tasks — the AI model didn't answer.`));
        }
        if (!found.tasks.length) return void (await html(ctx, formatExtracted(transcript, found.summary, [])));
        const id = putPending({ tasks: found.tasks });
        const kb = new InlineKeyboard().text(`✅ Add ${found.tasks.length === 1 ? "it" : `all ${found.tasks.length}`}`, `ai:add:${id}`).text("✖ Skip", `ai:skip:${id}`);
        await html(ctx, formatExtracted(transcript, found.summary, found.tasks), { reply_markup: kb });
      });
      return;
    }

    if (kind === "photo" && app.ai.canSeeImages) {
      background(ctx, async () => {
        let d: Awaited<ReturnType<typeof describeImage>>;
        try {
          d = await describeImage(deps(), { mime: "image/jpeg", data: Buffer.from(bytes).toString("base64") }, caption);
        } catch (e) {
          if (!(e instanceof AiUnavailableError)) throw e;
          await app.tasks.appendLog(`${icon} ![[${rel}]]${caption ? ` ${caption}` : ""}`, now);
          return void (await html(ctx, `${icon} Saved to <code>${esc(rel)}</code>. I couldn't read it — the AI model didn't answer.`));
        }
        const notePath = await app.tasks.captureNote(d.title, `![[${rel}]]\n\n${caption ? `> ${caption.replace(/\n/g, " ")}\n\n` : ""}${d.markdown}`, now);
        await app.tasks.appendLog(`${icon} ![[${rel}]] → [[${d.title}]]`, now);
        const preview = d.markdown.length > 600 ? `${d.markdown.slice(0, 600)}…` : d.markdown;
        await html(ctx, `📷 <b>${esc(d.title)}</b> → <code>${esc(notePath)}</code>\n\n${esc(preview)}`);
      });
      return;
    }

    await app.tasks.appendLog(`${icon} ![[${rel}]]${caption ? ` ${caption}` : ""}`, now);
    await ctx.react("👌").catch(() => html(ctx, `${icon} Saved to <code>${esc(rel)}</code>`));
  };
  bot.on("message:photo", (ctx) => {
    const p = ctx.message.photo.at(-1)!;
    return saveMedia(ctx, p.file_id, "photo", "jpg", p.file_size);
  });
  bot.on("message:voice", (ctx) => saveMedia(ctx, ctx.message.voice.file_id, "voice", "oga", ctx.message.voice.file_size));
  bot.on("message:audio", (ctx) => saveMedia(ctx, ctx.message.audio.file_id, "audio", "mp3", ctx.message.audio.file_size));
  bot.on("message:video", (ctx) => saveMedia(ctx, ctx.message.video.file_id, "video", "mp4", ctx.message.video.file_size));
  bot.on("message:document", (ctx) => saveMedia(ctx, ctx.message.document.file_id, "document", "bin", ctx.message.document.file_size));

  // --- plain text: remark replies, "+ task", or a log line ---
  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text;
    if (await menus.handleText(ctx)) return;
    if (/^\+\s*\S/.test(text)) {
      const t = await app.tasks.create({ text: text.replace(/^\+\s*/, "") });
      return html(ctx, formatTaskCreated(t), { reply_markup: reminderKeyboard(t.id) });
    }
    if (text.startsWith("/")) return html(ctx, "Unknown command. Tap ☰ Menu or send /help.");
    await app.tasks.appendLog(text);
    await ctx.react("✍").catch(() => {});
  });

  bot.catch(async (err) => {
    const e = err.error;
    const friendly =
      e instanceof TaskLineConflictError
        ? "⚠️ That task's line changed in the file. I've re-read it — please try again."
        : e instanceof TaskNotFoundError
          ? "That task no longer exists (it was removed from its note)."
          : null;
    if (!friendly) console.error("[telegram]", e);
    try {
      if (err.ctx.callbackQuery) await err.ctx.answerCallbackQuery(friendly ?? "Something went wrong");
      else await err.ctx.reply(friendly ?? "⚠️ Something went wrong — check the server log.");
    } catch {
      /* ignore */
    }
  });

  return bot;
}

export async function registerCommands(bot: Bot): Promise<void> {
  await bot.api.setMyCommands(COMMANDS);
  const url = getMiniAppUrl();
  // The chat's menu button opens the Mini App (needs a public https URL); otherwise the command list.
  await bot.api.setChatMenuButton({
    menu_button: url ? { type: "web_app", text: "Open", web_app: { url } } : { type: "commands" },
  });
}
