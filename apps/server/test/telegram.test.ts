import { runNagTick, tasks } from "@omnicore/core";
import { eq } from "drizzle-orm";
import type { Update } from "grammy/types";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { createContext, type AppContext } from "../src/context.js";
import { createBot } from "../src/telegram/bot.js";
import { TelegramNotifier } from "../src/telegram/notifier.js";

const ME = 111;
const STRANGER = 999;

interface Call {
  method: string;
  payload: Record<string, any>;
  result?: any;
}

function harness() {
  const dir = mkdtempSync(join(tmpdir(), "omnicore-tg-"));
  const config = loadConfig({
    VAULT_PATH: join(dir, "vault"),
    DATABASE_PATH: join(dir, "app.db"),
    TIMEZONE: "Asia/Riyadh",
    TELEGRAM_BOT_TOKEN: "123:TEST",
    TELEGRAM_ALLOWED_USER_IDS: String(ME),
  });
  const ctx: AppContext = createContext(config);
  const bot = createBot(ctx, {
    botInfo: {
      id: 1, is_bot: true, first_name: "OmniCore", username: "omnicore_bot",
      can_join_groups: false, can_read_all_group_messages: false, supports_inline_queries: false,
      can_connect_to_business: false, has_main_web_app: false,
    } as never,
  });
  const calls: Call[] = [];
  let msgId = 1000;
  bot.api.config.use(async (_prev, method, payload) => {
    const p = payload as Record<string, any>;
    const result =
      method === "sendMessage"
        ? { message_id: ++msgId, date: 0, chat: { id: p.chat_id, type: "private" }, text: p.text }
        : true;
    calls.push({ method, payload: p, result });
    return { ok: true, result } as never;
  });
  let updateId = 1;
  const send = (text: string, extra: Record<string, unknown> = {}, from = ME) =>
    bot.handleUpdate({
      update_id: updateId++,
      message: {
        message_id: ++msgId, date: 0, text,
        chat: { id: from, type: "private", first_name: "S" },
        from: { id: from, is_bot: false, first_name: "S" },
        ...(text.startsWith("/") && { entities: [{ type: "bot_command", offset: 0, length: text.split(/[\s\n]/)[0]!.length }] }),
        ...extra,
      },
    } as Update);
  const tap = (data: string, messageText = "x") =>
    bot.handleUpdate({
      update_id: updateId++,
      callback_query: {
        id: String(updateId), chat_instance: "c", data,
        from: { id: ME, is_bot: false, first_name: "S" },
        message: { message_id: 500, date: 0, text: messageText, chat: { id: ME, type: "private", first_name: "S" } },
      },
    } as Update);
  const last = (method: string) => [...calls].reverse().find((c) => c.method === method)!;
  const vaultFile = (rel: string) => readFileSync(join(config.VAULT_PATH, rel), "utf8");
  return { ctx, bot, calls, send, tap, last, vaultFile };
}

describe("telegram bot", () => {
  let h: ReturnType<typeof harness>;
  beforeEach(() => {
    h = harness();
  });

  it("tells strangers their id and does nothing else", async () => {
    await h.send("/todo sneaky", {}, STRANGER);
    expect(h.last("sendMessage").payload.text).toContain(`<code>${STRANGER}</code>`);
    expect(h.ctx.db.select().from(tasks).all()).toHaveLength(0);
  });

  it("/todo writes to the daily note and replies with action buttons", async () => {
    await h.send("/todo Replace UPS battery !p1 @today 18:00 #homelab");
    const t = h.ctx.db.select().from(tasks).get()!;
    expect(t).toMatchObject({ title: "Replace UPS battery", priority: 1, dueTime: "18:00" });
    const reply = h.last("sendMessage").payload;
    expect(reply.text).toContain("<b>Replace UPS battery</b>");
    const buttons = reply.reply_markup.inline_keyboard.flat().map((b: any) => b.callback_data);
    expect(buttons).toContain(`t:done:${t.id}`);
    expect(buttons.every((d: string) => Buffer.byteLength(d) <= 64)).toBe(true);
    expect(h.vaultFile(`daily/${t.dueDate}.md`)).toMatch(/- \[ \] Replace UPS battery !p1 📅 \S+ 18:00 #homelab \^oc-/);
  });

  it("partial, remark-by-reply and done flow through to the file", async () => {
    await h.send("/todo Order SFPs @today");
    const t = h.ctx.db.select().from(tasks).get()!;
    const file = () => h.vaultFile(`daily/${t.dueDate}.md`);

    await h.tap(`t:menu:${t.id}`);
    expect(h.last("editMessageReplyMarkup").payload.reply_markup.inline_keyboard.flat().map((b: any) => b.text)).toContain("50%");

    await h.tap(`t:p50:${t.id}`);
    expect(file()).toMatch(/- \[\/\] Order SFPs/);
    expect(h.last("answerCallbackQuery").payload.text).toBe("🌗 50% done");
    expect(h.last("editMessageText").payload.text).toBe("x\n\n🌗 50% done");

    await h.tap(`t:rem:${t.id}`);
    const prompt = h.last("sendMessage");
    expect(prompt.payload.reply_markup.force_reply).toBe(true);
    const promptMessageId = prompt.result.message_id;
    await h.send("Awaiting parts delivery", { reply_to_message: { message_id: promptMessageId, date: 0, chat: { id: ME, type: "private" } } });
    expect(h.ctx.tasks.get(t.id).remarks.map((r) => r.text)).toEqual(["Awaiting parts delivery"]);

    await h.tap(`t:done:${t.id}`);
    expect(file()).toMatch(/- \[x\] Order SFPs .*✅ \d{4}-\d{2}-\d{2} \^oc-/);
  });

  it("'+ text' creates a task, plain text is logged, /today lists with one-tap done", async () => {
    await h.send("+ Call ISP @today");
    await h.send("Router rebooted at noon");
    const t = h.ctx.db.select().from(tasks).where(eq(tasks.title, "Call ISP")).get()!;
    expect(h.vaultFile(`daily/${t.dueDate}.md`)).toMatch(/## Log\n- \d{2}:\d{2} Router rebooted at noon/);

    await h.send("/today");
    const today = h.last("sendMessage").payload;
    expect(today.text).toContain("Due today (1)");
    expect(today.reply_markup.inline_keyboard[0][0].callback_data).toBe(`td:${t.id}`);
    await h.tap(`td:${t.id}`);
    expect(h.ctx.tasks.get(t.id).status).toBe("done");
    expect(h.last("editMessageText").payload.text).toContain("1 done today");
  });

  it("/note, /project and /search", async () => {
    await h.send("/note Router Ideas\nUse VLAN 30 for IoT\n- [ ] Buy managed switch");
    expect(h.last("sendMessage").payload.text).toContain("inbox/router-ideas.md");
    await h.send("/todo Flash firmware #project/homelab");
    await h.send("/project homelab");
    expect(h.last("sendMessage").payload.text).toMatch(/homelab[\s\S]*0% · 0\/1 done/);
    expect(h.last("sendMessage").payload.reply_markup.inline_keyboard.flat().map((b: any) => b.text)).toContain("✅ Flash firmware");
    await h.send("/search vlan");
    expect(h.last("sendMessage").payload.text).toContain("Router Ideas");
    // Snippets must never split an emoji (would render as \uFFFD in Telegram)
    // The snippet is cut 40 UTF-16 units before / 60 after the match; one ASCII char on each side of
    // the needle puts both cut points in the middle of a 2-unit emoji.
    await h.send("/note Emoji Edge\n" + "📅".repeat(30) + "xneedley" + "🔁".repeat(40));
    await h.send("/search needle");
    expect(h.last("sendMessage").payload.text).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
  });

  it("the nag engine sends reminders with action keyboards through Telegram", async () => {
    await h.send("/todo Pay internet bill @today 09:00");
    const t = h.ctx.db.select().from(tasks).get()!;
    const notifier = new TelegramNotifier(h.bot, [ME]);
    const at = new Date(`${t.dueDate}T07:00:00Z`); // 10:00 Riyadh, an hour late
    const r = await runNagTick(h.ctx.db, notifier, h.ctx.nag, at);
    expect(r.sent).toBe(1);
    const msg = h.last("sendMessage").payload;
    expect(msg.text).toContain("⏰ <b>Overdue</b> by 1h");
    expect(msg.reply_markup.inline_keyboard[1].map((b: any) => b.text)).toEqual(["⏱ +1h", "🌅 Tomorrow", "🔕 Today"]);
    expect((await runNagTick(h.ctx.db, notifier, h.ctx.nag, new Date(at.getTime() + 60_000))).sent).toBe(0);
  });
});

describe("telegram buttons", () => {
  let h: ReturnType<typeof harness>;
  beforeEach(() => {
    h = harness();
  });
  const buttons = (c: Call) => (c.payload.reply_markup?.inline_keyboard ?? []).flat() as { text: string; callback_data?: string }[];
  const data = (c: Call, text: string) => buttons(c).find((b) => b.text.includes(text))!.callback_data!;

  it("/start shows the keyboard and the menu", async () => {
    await h.send("/start");
    const msgs = h.calls.filter((c) => c.method === "sendMessage");
    expect(msgs[0]!.payload.reply_markup.keyboard.flat().map((b: any) => b.text)).toEqual(["📋 Today", "➕ New task", "📁 Projects", "☰ Menu"]);
    expect(buttons(msgs[1]!).map((b) => b.callback_data)).toEqual(expect.arrayContaining(["m:today", "m:new", "m:proj", "m:search", "m:help"]));
    await h.send("📋 Today");
    expect(h.last("sendMessage").payload.text).toContain("📋 Today");
  });

  it("new task card: date, priority, time and a new project by tapping", async () => {
    await h.send("➕ New task");
    expect(h.last("sendMessage").payload.reply_markup.force_reply).toBe(true);
    await h.send("Replace UPS battery");
    const card = h.last("sendMessage");
    expect(card.payload.text).toContain("<b>Replace UPS battery</b>");
    const id = data(card, "Tomorrow").split(":")[1]!;
    expect(buttons(card).every((b) => !b.callback_data || Buffer.byteLength(b.callback_data) <= 64)).toBe(true);

    await h.tap(`dr:${id}:d:1`);
    await h.tap(`dr:${id}:p:1`);
    await h.tap(`dr:${id}:tm`);
    expect(buttons(h.last("editMessageText")).map((b) => b.text)).toContain("18:00");
    await h.tap(`dr:${id}:t:1800`);
    await h.tap(`dr:${id}:pj`);
    await h.tap(`dr:${id}:jn`);
    await h.send("Home Lab");
    const edited = h.last("editMessageText").payload;
    expect(edited.chat_id).toBe(ME);
    expect(edited.text).toContain("📁 Home Lab");
    expect(edited.text).toMatch(/Tomorrow.*⏰ 18:00/);

    await h.tap(`dr:${id}:ok`);
    const t = h.ctx.db.select().from(tasks).get()!;
    expect(t).toMatchObject({ title: "Replace UPS battery", priority: 1, dueTime: "18:00" });
    expect(h.vaultFile("projects/home-lab.md")).toMatch(/project: "Home Lab"[\s\S]*## Tasks\n- \[ \] Replace UPS battery !p1 📅 \S+ 18:00/);
    expect(h.last("editMessageText").payload.text).toContain("✅ <b>Saved</b>");
    // the card is gone once saved
    await h.tap(`dr:${id}:ok`);
    expect(h.last("answerCallbackQuery").payload.text).toContain("expired");
  });

  it("typed shortcuts still prefill the card; cancel saves nothing", async () => {
    await h.tap("m:new");
    await h.send("Call ISP !p2 @+3d 09:00");
    const card = h.last("sendMessage").payload.text;
    expect(card).toContain("🟠 P2");
    expect(card).toContain("⏰ 09:00");
    const id = data(h.last("sendMessage"), "Cancel").split(":")[1]!;
    await h.tap(`dr:${id}:x`);
    expect(h.ctx.db.select().from(tasks).all()).toHaveLength(0);
  });

  it("#project/name creates a project; tasks are added and done from its screen", async () => {
    await h.send("#project/emo");
    expect(data(h.last("sendMessage"), "Create")).toBe("pjc:emo");
    await h.tap("pjc:emo");
    expect(h.vaultFile("projects/emo.md")).toContain('project: "emo"');
    const screen = h.last("sendMessage");
    await h.tap(data(screen, "Add task"));
    await h.send("Order cables");
    await h.tap(`dr:${data(h.last("sendMessage"), "Save").split(":")[1]}:ok`);
    const t = h.ctx.db.select().from(tasks).get()!;
    expect(h.vaultFile("projects/emo.md")).toContain("- [ ] Order cables");

    await h.send("📁 Projects");
    expect(buttons(h.last("sendMessage")).map((b) => b.text)).toContain("📁 emo  0/1");
    await h.tap(`pd:${t.id}`);
    expect(h.ctx.tasks.get(t.id).status).toBe("done");
    expect(h.last("editMessageText").payload.text).toContain("1/1 done");
    // a lone #project/emo now opens it
    await h.send("#project/emo");
    expect(h.last("sendMessage").payload.text).toContain("📁 emo");
  });

  it("search from the menu; a prompt doesn't swallow commands", async () => {
    await h.send("/note Router Ideas\nUse VLAN 30");
    await h.tap("m:search");
    await h.send("/today");
    expect(h.last("sendMessage").payload.text).toContain("📋 Today");
    await h.tap("m:search");
    await h.send("vlan");
    expect(h.last("sendMessage").payload.text).toContain("Router Ideas");
    await h.send("just a log line");
    expect(h.ctx.db.select().from(tasks).all()).toHaveLength(0);
  });
});
