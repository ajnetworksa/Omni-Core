import {
  addDays,
  applyTaskAction,
  listTasks,
  parseQuickAdd,
  projects,
  todayInTz,
  todayView,
  type TaskPatch,
} from "@omnicore/core";
import { asc, eq } from "drizzle-orm";
import { GrammyError, InlineKeyboard, Keyboard, type Bot, type Context } from "grammy";
import { randomBytes } from "node:crypto";
import { aiFeatures } from "../ai.js";
import type { AppContext } from "../context.js";
import { esc, formatProject, formatTaskCreated, formatToday, getMiniAppUrl, HELP, reminderKeyboard, shortDate } from "./format.js";

/**
 * The button-driven side of the bot: a persistent keyboard, a menu, a step-by-step "new task"
 * card (date, time, priority and project by tapping), and project screens you can create and
 * work in without typing commands. Typed shortcuts (/todo, "+ task", …) keep working alongside.
 */

/** Labels of the always-visible keyboard under the message box. */
export const KEYS = { today: "📋 Today", task: "➕ New task", projects: "📁 Projects", menu: "☰ Menu" } as const;

export function mainKeyboard(): Keyboard {
  return new Keyboard().text(KEYS.today).text(KEYS.task).row().text(KEYS.projects).text(KEYS.menu).resized().persistent();
}

export interface MenuDeps {
  search(ctx: Context, q: string): Promise<unknown>;
  ask(ctx: Context, q: string): unknown;
  digest(ctx: Context, kind: "standup" | "retro"): unknown;
}

interface Draft {
  raw: string;
  title: string;
  date?: string;
  time?: string;
  priority: number;
  projectId?: string;
  projectTitle?: string;
  choices?: string[];
  card?: { chat: number; msg: number };
}

type Waiting =
  | { kind: "task"; projectId?: string }
  | { kind: "project"; draftId?: string }
  | { kind: "search" }
  | { kind: "ask" };

const WAIT_MS = 15 * 60_000;
const DRAFT_TTL_MS = 2 * 86_400_000;
const TIMES = ["08:00", "09:00", "12:00", "15:00", "18:00", "21:00"];
const PRIO = { 1: "🔴 P1", 2: "🟠 P2", 3: "🔵 P3", 4: "⚪ None" } as Record<number, string>;
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function installMenus(bot: Bot, app: AppContext, deps: MenuDeps) {
  const { db, config } = app;
  const tz = config.TIMEZONE;
  /** chat id → what the next plain message answers (set by a prompt like "What needs doing?"). */
  const waiting = new Map<number, Waiting & { at: number; prompt: number }>();

  // A command cancels whatever a prompt was waiting for.
  bot.use((ctx, next) => {
    if (ctx.chat && ctx.message?.text?.startsWith("/")) waiting.delete(ctx.chat.id);
    return next();
  });

  // ---------- helpers ----------
  const notModified = (e: unknown) => e instanceof GrammyError && e.description.includes("not modified");
  /** From a button: replace the current message (app-like navigation). Otherwise: send a new one. */
  const show = async (ctx: Context, text: string, kb?: InlineKeyboard) => {
    if (ctx.callbackQuery?.message) {
      try {
        return await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: kb });
      } catch (e) {
        if (notModified(e)) return;
      }
    }
    return ctx.reply(text, { parse_mode: "HTML", reply_markup: kb });
  };
  const prompt = async (ctx: Context, w: Waiting, text: string, placeholder: string) => {
    const m = await ctx.reply(text, { parse_mode: "HTML", reply_markup: { force_reply: true, input_field_placeholder: placeholder } });
    waiting.set(ctx.chat!.id, { ...w, at: Date.now(), prompt: m.message_id });
  };

  const loadDraft = (id: string): Draft | undefined => {
    const row = db.$client.prepare("SELECT payload FROM ai_pending WHERE id = ? AND kind = 'draft'").get(id) as { payload: string } | undefined;
    return row ? (JSON.parse(row.payload) as Draft) : undefined;
  };
  const saveDraft = (id: string, d: Draft) =>
    db.$client.prepare("INSERT INTO ai_pending(id, kind, payload) VALUES (?, 'draft', ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload").run(id, JSON.stringify(d));
  const dropDraft = (id: string) => db.$client.prepare("DELETE FROM ai_pending WHERE id = ? AND kind = 'draft'").run(id);

  const dayLabel = (date: string | undefined) => {
    if (!date) return "No date";
    const today = todayInTz(tz);
    if (date === today) return `Today, ${shortDate(date)}`;
    if (date === addDays(today, 1)) return `Tomorrow, ${shortDate(date)}`;
    return shortDate(date);
  };

  // ---------- menu ----------
  const menuView = () => {
    const v = todayView(db, tz);
    const open = new Set([...v.overdue, ...v.dueToday, ...v.pinned].map((t) => t.id)).size;
    const status = [`${open} open`, v.overdue.length ? `⚠️ ${v.overdue.length} overdue` : "", v.completed.length ? `✅ ${v.completed.length} done` : ""].filter(Boolean).join(" · ");
    const kb = new InlineKeyboard()
      .text("📋 Today", "m:today").text("➕ New task", "m:new").row()
      .text("📁 Projects", "m:proj").text("🔍 Search", "m:search").row();
    if (aiFeatures(app).ask) kb.text("🤖 Ask my notes", "m:ask");
    kb.text("🌅 Standup", "m:standup").row();
    const mini = getMiniAppUrl();
    if (mini) kb.webApp("📱 Open the app", mini).row();
    kb.text("⌨️ Typing shortcuts", "m:help");
    const lines = [`☰ <b>OmniCore</b>`, `Today: ${status}`];
    if (!mini) lines.push("", "<i>📱 The full app opens here once the Cloudflare tunnel is set up (see docs/DEPLOY.md).</i>");
    return { text: lines.join("\n"), kb };
  };
  const sendMenu = (ctx: Context) => {
    const { text, kb } = menuView();
    return show(ctx, text, kb);
  };
  const sendStart = async (ctx: Context) => {
    const name = ctx.from?.first_name ? `, ${esc(ctx.from.first_name)}` : "";
    await ctx.reply(
      `👋 Hi${name}! I keep your tasks and notes, and I keep reminding you until things are done.\n\n` +
        `Tap the buttons below, or just type:\n• <code>+ Buy SFP modules tomorrow</code>: a task\n• anything else: a line in today's log\n• a photo, voice note or file: saved to your notes`,
      { parse_mode: "HTML", reply_markup: mainKeyboard() },
    );
    const { text, kb } = menuView();
    await ctx.reply(text, { parse_mode: "HTML", reply_markup: kb });
  };

  const todayScreen = (ctx: Context) => {
    const { text, keyboard } = formatToday(todayView(db, tz));
    return show(ctx, text, keyboard);
  };

  // ---------- new task card ----------
  const draftCard = (id: string, d: Draft, mode: "main" | "time" | "project" = "main") => {
    const lines = [
      "📝 <b>New task</b>",
      `<b>${esc(d.title)}</b>`,
      "",
      `📅 ${dayLabel(d.date)}${d.time ? ` · ⏰ ${d.time}` : ""}`,
      `🚩 ${PRIO[d.priority] ?? PRIO[4]}`,
      `📁 ${d.projectTitle ? esc(d.projectTitle) : "No project"}`,
    ];
    const kb = new InlineKeyboard();
    const cb = (op: string) => `dr:${id}:${op}`;
    if (mode === "time") {
      lines.push("", "<i>Pick a time for the reminder:</i>");
      TIMES.forEach((t, i) => {
        kb.text(d.time === t ? `• ${t}` : t, cb(`t:${t.replace(":", "")}`));
        if (i % 3 === 2) kb.row();
      });
      kb.text(d.time ? "No time" : "• No time", cb("t:n")).text("⬅️ Back", cb("bk"));
    } else if (mode === "project") {
      lines.push("", "<i>Which project?</i>");
      const all = db.select().from(projects).orderBy(asc(projects.title)).all().slice(0, 16);
      d.choices = all.map((p) => p.id);
      all.forEach((p, i) => {
        kb.text(`${d.projectId === p.id ? "• " : ""}${clip(p.title, 22)}`, cb(`j:${i}`));
        if (i % 2 === 1) kb.row();
      });
      if (all.length % 2) kb.row();
      kb.text("➕ New project", cb("jn")).text(d.projectId ? "No project" : "• No project", cb("j:n")).row().text("⬅️ Back", cb("bk"));
    } else {
      const today = todayInTz(tz);
      const dates: [string, string | undefined][] = [["Today", today], ["Tomorrow", addDays(today, 1)], ["+3 days", addDays(today, 3)], ["No date", undefined]];
      for (const [label, v] of dates) kb.text(d.date === v ? `• ${label}` : label, cb(`d:${v ? dates.findIndex((x) => x[1] === v) : "n"}`));
      kb.row();
      for (const p of [1, 2, 3, 4]) kb.text(d.priority === p ? `• ${PRIO[p]}` : PRIO[p]!, cb(`p:${p}`));
      kb.row().text(`⏰ ${d.time ?? "Time"}`, cb("tm")).text(`📁 ${d.projectTitle ? clip(d.projectTitle, 16) : "Project"}`, cb("pj")).row();
      kb.text("✅ Save", cb("ok")).text("✖ Cancel", cb("x"));
    }
    return { text: lines.join("\n"), kb };
  };

  const startDraft = async (ctx: Context, raw: string, projectId?: string) => {
    const meta = parseQuickAdd(raw, tz);
    if (!meta.title) return ctx.reply("That task has no title. Try again with ➕ New task.");
    const proj = projectId ? db.select().from(projects).where(eq(projects.id, projectId)).get() : undefined;
    const d: Draft = {
      raw,
      title: meta.title,
      date: meta.dueDate ?? todayInTz(tz),
      time: meta.dueTime,
      priority: meta.priority ?? 4,
      projectId: proj?.id,
      projectTitle: proj?.title,
    };
    const id = randomBytes(6).toString("hex");
    db.$client.prepare("DELETE FROM ai_pending WHERE kind = 'draft' AND created_at < ?").run(new Date(Date.now() - DRAFT_TTL_MS).toISOString());
    const { text, kb } = draftCard(id, d);
    const m = await ctx.reply(text, { parse_mode: "HTML", reply_markup: kb });
    d.card = { chat: m.chat.id, msg: m.message_id };
    saveDraft(id, d);
  };

  const saveTask = async (ctx: Context, id: string, d: Draft) => {
    const meta = parseQuickAdd(d.raw, tz);
    const proj = d.projectId ? db.select().from(projects).where(eq(projects.id, d.projectId)).get() : undefined;
    const projectNote = proj && (await app.vault.exists(`projects/${proj.slug}.md`)) ? `projects/${proj.slug}.md` : undefined;
    const typedProject = meta.tags.some((t) => t.startsWith("project/"));
    let t = await app.tasks.create({ text: d.raw, notePath: projectNote, projectSlug: proj && !projectNote && !typedProject ? proj.slug : undefined });
    const patch: TaskPatch = {};
    if (d.priority !== (meta.priority ?? 4)) patch.priority = d.priority;
    if (d.date !== meta.dueDate) patch.dueDate = d.date ?? null;
    if (d.time !== meta.dueTime) patch.dueTime = d.time ?? null;
    if (Object.keys(patch).length) t = await app.tasks.update(t.id, patch);
    dropDraft(id);
    await show(ctx, `✅ <b>Saved</b>\n${formatTaskCreated(t)}${proj ? `\n📁 ${esc(proj.title)}` : ""}`, reminderKeyboard(t.id));
  };

  bot.callbackQuery(/^dr:([0-9a-f]{12}):([a-z]+)(?::([0-9a-z]+))?$/, async (ctx) => {
    const [, id, op, val] = ctx.match as RegExpMatchArray as [string, string, string, string | undefined];
    const d = loadDraft(id);
    if (!d) {
      await ctx.answerCallbackQuery("This card has expired. Start again with ➕ New task.");
      return void (await ctx.editMessageReplyMarkup().catch(() => {}));
    }
    const today = todayInTz(tz);
    let mode: "main" | "time" | "project" = "main";
    switch (op) {
      case "d":
        d.date = val === "n" ? undefined : addDays(today, [0, 1, 3][Number(val)] ?? 0);
        if (!d.date) d.time = undefined;
        break;
      case "p":
        d.priority = Math.min(4, Math.max(1, Number(val) || 4));
        break;
      case "tm":
        mode = "time";
        break;
      case "t":
        d.time = val === "n" || !val ? undefined : `${val.slice(0, 2)}:${val.slice(2, 4)}`;
        if (d.time && !d.date) d.date = today;
        break;
      case "pj":
        mode = "project";
        break;
      case "j": {
        const pid = val === "n" ? undefined : d.choices?.[Number(val)];
        const p = pid ? db.select().from(projects).where(eq(projects.id, pid)).get() : undefined;
        d.projectId = p?.id;
        d.projectTitle = p?.title;
        break;
      }
      case "jn":
        saveDraft(id, d);
        await ctx.answerCallbackQuery();
        return void (await prompt(ctx, { kind: "project", draftId: id }, "📁 Name of the new project?", "e.g. Home lab"));
      case "ok":
        await ctx.answerCallbackQuery("Saved");
        return void (await saveTask(ctx, id, d));
      case "x":
        dropDraft(id);
        await ctx.answerCallbackQuery("Cancelled");
        return void (await show(ctx, `✖ <s>${esc(d.title)}</s>\nNot saved.`));
      case "bk":
        break;
    }
    const { text, kb } = draftCard(id, d, mode);
    saveDraft(id, d);
    await ctx.answerCallbackQuery();
    await show(ctx, text, kb);
  });

  // ---------- projects ----------
  const projectList = () => {
    const all = db.select().from(projects).orderBy(asc(projects.title)).all();
    const counts = new Map(
      (db.$client.prepare("SELECT project_id AS id, sum(status = 'done') AS done, sum(status != 'cancelled') AS total FROM tasks WHERE project_id IS NOT NULL GROUP BY project_id").all() as { id: string; done: number; total: number }[]).map((r) => [r.id, r]),
    );
    const kb = new InlineKeyboard();
    for (const p of all.slice(0, 30)) {
      const c = counts.get(p.id);
      kb.text(`📁 ${clip(p.title, 28)}${c?.total ? `  ${c.done}/${c.total}` : ""}`, `pj:${p.id}`).row();
    }
    kb.text("➕ New project", "pj:new").text("⬅️ Menu", "m:menu");
    const text = all.length ? `📁 <b>Projects</b> (${all.length})\nTap one to see its tasks.` : "📁 <b>No projects yet</b>\nCreate one, then add tasks to it.";
    return { text, kb };
  };
  const projectScreen = (projectId: string) => {
    const p = db.select().from(projects).where(eq(projects.id, projectId)).get();
    if (!p) return undefined;
    const all = listTasks(db, { projectSlug: p.slug, limit: 2000 });
    const open = all.filter((t) => ["backlog", "ready", "in_progress", "blocked"].includes(t.status));
    const today = todayInTz(tz);
    const text = formatProject({
      title: p.title,
      total: all.filter((t) => t.status !== "cancelled").length,
      done: all.filter((t) => t.status === "done").length,
      open,
      blocked: open.filter((t) => t.status === "blocked" || t.remarks.length > 0),
      overdue: open.filter((t) => t.dueDate && t.dueDate < today),
    });
    const kb = new InlineKeyboard();
    for (const t of open.slice(0, 8)) kb.text(`✅ ${clip(t.title, 32)}`, `pd:${t.id}`).row();
    kb.text("➕ Add task", `pjt:${p.id}`).text("⬅️ Projects", "m:proj");
    return { text: open.length ? `${text}\n\n<i>Tap a task to mark it done.</i>` : `${text}\n\nNo open tasks.`, kb };
  };
  const openProject = async (ctx: Context, projectId: string) => {
    const s = projectScreen(projectId);
    if (!s) return show(ctx, "That project no longer exists.", new InlineKeyboard().text("⬅️ Projects", "m:proj"));
    return show(ctx, s.text, s.kb);
  };
  const newProject = async (ctx: Context, name: string, draftId?: string) => {
    const r = await app.tasks.createProject(name);
    const p = db.select().from(projects).where(eq(projects.slug, r.slug)).get();
    if (draftId && p) {
      const d = loadDraft(draftId);
      if (d?.card) {
        d.projectId = p.id;
        d.projectTitle = p.title;
        saveDraft(draftId, d);
        const { text, kb } = draftCard(draftId, d);
        await ctx.api.editMessageText(d.card.chat, d.card.msg, text, { parse_mode: "HTML", reply_markup: kb }).catch(() => {});
        return ctx.reply(`📁 ${r.created ? "Created" : "Using"} <b>${esc(p.title)}</b>. It's set on the task card above.`, { parse_mode: "HTML" });
      }
    }
    if (!p) return ctx.reply("Couldn't create that project.");
    const s = projectScreen(p.id)!;
    return ctx.reply(`${r.created ? `📁 Created <code>${esc(r.path)}</code>\n\n` : ""}${s.text}`, { parse_mode: "HTML", reply_markup: s.kb });
  };

  bot.callbackQuery(/^pj:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (ctx.match![1] === "new") return void (await prompt(ctx, { kind: "project" }, "📁 Name of the new project?", "e.g. Home lab"));
    await openProject(ctx, ctx.match![1]!);
  });
  bot.callbackQuery(/^pjt:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await prompt(ctx, { kind: "task", projectId: ctx.match![1] }, "➕ What needs doing in this project?", "e.g. Order patch cables");
  });
  bot.callbackQuery(/^pjc:([a-z0-9-]+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await newProject(ctx, ctx.match![1]!);
  });
  bot.callbackQuery(/^pd:(.+)$/, async (ctx) => {
    const { summary, task } = await applyTaskAction(app.tasks, ctx.match![1]!, "done");
    await ctx.answerCallbackQuery(`${summary}: ${task.title}`);
    if (task.projectId) await openProject(ctx, task.projectId);
  });

  // ---------- menu buttons ----------
  bot.callbackQuery(/^m:([a-z]+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    switch (ctx.match![1]) {
      case "menu":
        return void (await sendMenu(ctx));
      case "today":
        return void (await todayScreen(ctx));
      case "new":
        return void (await prompt(ctx, { kind: "task" }, "➕ <b>What needs doing?</b>\n<i>You can pick the date, time and project next.</i>", "e.g. Replace UPS battery"));
      case "proj": {
        const { text, kb } = projectList();
        return void (await show(ctx, text, kb));
      }
      case "search":
        return void (await prompt(ctx, { kind: "search" }, "🔍 What should I look for?", "words in your notes or tasks"));
      case "ask":
        return void (await prompt(ctx, { kind: "ask" }, "🤖 What do you want to know from your notes?", "e.g. what did I decide about the core switch?"));
      case "standup":
        return void deps.digest(ctx, "standup");
      case "help":
        return void (await show(ctx, HELP, new InlineKeyboard().text("⬅️ Menu", "m:menu")));
    }
  });

  /** Plain text: keyboard buttons, answers to prompts, a lone #project/name. True when handled. */
  const handleText = async (ctx: Context): Promise<boolean> => {
    const text = ctx.message?.text?.trim() ?? "";
    const chat = ctx.chat!.id;
    switch (text) {
      case KEYS.today:
        waiting.delete(chat);
        return (await todayScreen(ctx), true);
      case KEYS.task:
        return (await prompt(ctx, { kind: "task" }, "➕ <b>What needs doing?</b>\n<i>You can pick the date, time and project next.</i>", "e.g. Replace UPS battery"), true);
      case KEYS.projects: {
        waiting.delete(chat);
        const { text: t, kb } = projectList();
        return (await ctx.reply(t, { parse_mode: "HTML", reply_markup: kb }), true);
      }
      case KEYS.menu:
        waiting.delete(chat);
        return (await sendMenu(ctx), true);
    }
    const w = waiting.get(chat);
    const replyTo = ctx.message?.reply_to_message?.message_id;
    if (w && !text.startsWith("/") && Date.now() - w.at < WAIT_MS && (!replyTo || replyTo === w.prompt)) {
      waiting.delete(chat);
      if (!text) return true;
      switch (w.kind) {
        case "task":
          await startDraft(ctx, text.replace(/^\+\s*/, ""), w.projectId);
          return true;
        case "project":
          await newProject(ctx, text, w.draftId);
          return true;
        case "search":
          await deps.search(ctx, text);
          return true;
        case "ask":
          await deps.ask(ctx, text);
          return true;
      }
    }
    const tag = text.match(/^#project\/([a-z0-9][a-z0-9-]*)$/i);
    if (tag) {
      const slug = tag[1]!.toLowerCase();
      const p = db.select().from(projects).where(eq(projects.slug, slug)).get();
      if (p) return (await openProject(ctx, p.id), true);
      await ctx.reply(`There's no project <b>${esc(slug)}</b> yet.`, {
        parse_mode: "HTML",
        reply_markup: new InlineKeyboard().text(`➕ Create “${clip(slug, 24)}”`, `pjc:${slug.slice(0, 50)}`).text("✖ No", "m:menu"),
      });
      return true;
    }
    return false;
  };

  return {
    openProject,
    sendStart,
    sendMenu,
    showProjects: (ctx: Context) => {
      const { text, kb } = projectList();
      return ctx.reply(text, { parse_mode: "HTML", reply_markup: kb });
    },
    newTask: (ctx: Context) => prompt(ctx, { kind: "task" }, "➕ <b>What needs doing?</b>\n<i>You can pick the date, time and project next.</i>", "e.g. Replace UPS battery"),
    handleText,
  };
}
