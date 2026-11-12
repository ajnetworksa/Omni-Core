import { tasks } from "@omnicore/core";
import { eq } from "drizzle-orm";
import type { Update } from "grammy/types";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// @ts-expect-error plain JS test helper
import { startMockAi } from "../../../tests/lib/mock-ai.mjs";
import { loadConfig } from "../src/config.js";
import { createContext, type AppContext } from "../src/context.js";
import { buildHttp } from "../src/http.js";
import { createBot } from "../src/telegram/bot.js";
import { TelegramNotifier } from "../src/telegram/notifier.js";

const ME = 111;
let mock: { url: string; close(): Promise<void> };
beforeAll(async () => {
  mock = await startMockAi();
});
afterAll(() => mock.close());
const fail = (on: boolean) => fetch(`${mock.url}/__fail?on=${on ? 1 : 0}`);

async function harness(env: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "omnicore-ai-"));
  const vault = join(dir, "vault");
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(new Date());
  mkdirSync(join(vault, "projects"), { recursive: true });
  writeFileSync(
    join(vault, "projects/homelab.md"),
    `---\nproject: Homelab\n---\n# Homelab\n\n## Core switch\nWe decided to replace the core switch with an SG350 because the old one drops VLAN config after firmware updates.\n\n## Tasks\n- [ ] Replace core switch !p1 📅 ${today}\n- [ ] Migrate VLANs\n`,
  );
  const config = loadConfig({
    VAULT_PATH: vault,
    DATABASE_PATH: join(dir, "app.db"),
    TIMEZONE: "Asia/Riyadh",
    API_TOKEN: "test-token-0123456789",
    TELEGRAM_BOT_TOKEN: "123:TEST",
    TELEGRAM_ALLOWED_USER_IDS: String(ME),
    TELEGRAM_API_ROOT: mock.url,
    OLLAMA_BASE_URL: mock.url,
    STT_BASE_URL: `${mock.url}/v1`,
    AI_VISION_MODEL: "llama3.2-vision",
    ...env,
  });
  const ctx: AppContext = createContext(config);
  await ctx.indexer.fullScan();
  return { ctx, config, today, file: (rel: string) => readFileSync(join(vault, rel), "utf8"), vault };
}

function botHarness(ctx: AppContext) {
  const bot = createBot(ctx, {
    botInfo: { id: 1, is_bot: true, first_name: "OmniCore", username: "omnicore_bot", can_join_groups: false, can_read_all_group_messages: false, supports_inline_queries: false, can_connect_to_business: false, has_main_web_app: false } as never,
  });
  const calls: { method: string; payload: Record<string, any> }[] = [];
  let msgId = 1000;
  bot.api.config.use(async (_prev, method, payload) => {
    const p = payload as Record<string, any>;
    calls.push({ method, payload: p });
    const result =
      method === "sendMessage"
        ? { message_id: ++msgId, date: 0, chat: { id: p.chat_id, type: "private" }, text: p.text }
        : method === "getFile"
          ? { file_id: p.file_id, file_unique_id: "u", file_path: p.file_id.startsWith("photo") ? "photos/file_1.jpg" : "voice/file_2.oga" }
          : true;
    return { ok: true, result } as never;
  });
  let updateId = 1;
  const message = (extra: Record<string, unknown>) =>
    bot.handleUpdate({
      update_id: updateId++,
      message: { message_id: ++msgId, date: 0, chat: { id: ME, type: "private", first_name: "S" }, from: { id: ME, is_bot: false, first_name: "S" }, ...extra },
    } as Update);
  const command = (text: string) => message({ text, entities: [{ type: "bot_command", offset: 0, length: text.split(/\s/)[0]!.length }] });
  const tap = (data: string, text = "x") =>
    bot.handleUpdate({
      update_id: updateId++,
      callback_query: { id: String(updateId), chat_instance: "c", data, from: { id: ME, is_bot: false, first_name: "S" }, message: { message_id: 500, date: 0, text, chat: { id: ME, type: "private", first_name: "S" } } },
    } as Update);
  const sent = () => calls.filter((c) => c.method === "sendMessage").map((c) => c.payload);
  /** AI work runs in the background; wait for the reply that matches. */
  const waitFor = async (pred: (p: Record<string, any>) => boolean, ms = 4000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const hit = sent().find(pred);
      if (hit) return hit;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error(`no matching message; got: ${sent().map((p) => p.text).join(" | ")}`);
  };
  return { bot, calls, message, command, tap, sent, waitFor };
}

describe("AI over the API", () => {
  it("status, Ask with citations, related search", async () => {
    const { ctx } = await harness();
    await ctx.semantic!.sync();
    const app = await buildHttp(ctx, { logger: false });
    const auth = { authorization: "Bearer test-token-0123456789" };
    const st = (await app.inject({ url: "/api/ai/status", headers: auth })).json();
    expect(st.features).toMatchObject({ ask: true, breakdown: true, summaries: true, voice: true, photos: true });
    expect(st.local).toMatchObject({ chatModel: "llama3.2:3b", embedModel: "nomic-embed-text" });
    expect(st.cloud).toBeUndefined();
    expect(st.index.engine).toBe("sqlite-vec");
    expect(st.index.chunks).toBeGreaterThan(0);

    const ask = (await app.inject({ method: "POST", url: "/api/ai/ask", headers: auth, payload: { q: "why did we decide to replace the core switch?" } })).json();
    expect(ask.answer).toContain("SG350");
    expect(ask.answer).toContain("<b>not html</b>"); // raw text; clients render it as text
    expect(ask.sources[ask.cited[0] - 1].path).toBe("projects/homelab.md");

    const rel = (await app.inject({ url: "/api/search/semantic?q=switch%20firmware%20config", headers: auth })).json();
    expect(rel.hits[0].heading).toBe("Core switch");
    await app.close();
  });

  it("breakdown → add subtasks, digest into the daily note, clear errors when the model is down", async () => {
    const { ctx, file, today } = await harness();
    const app = await buildHttp(ctx, { logger: false });
    const auth = { authorization: "Bearer test-token-0123456789" };
    const t = ctx.db.select().from(tasks).where(eq(tasks.title, "Replace core switch")).get()!;
    const b = (await app.inject({ method: "POST", url: `/api/tasks/${t.id}/breakdown`, headers: auth, payload: {} })).json();
    expect(b.subtasks).toHaveLength(5);
    const add = await app.inject({ method: "POST", url: `/api/tasks/${t.id}/subtasks`, headers: auth, payload: { titles: b.subtasks.slice(0, 3) } });
    expect(add.statusCode).toBe(201);
    expect(file("projects/homelab.md")).toMatch(/Replace core switch.*\n {4}- \[ \] Check what's needed/);
    const detail = (await app.inject({ url: `/api/tasks/${t.id}/detail`, headers: auth })).json();
    expect(detail.children).toHaveLength(3);

    const d = (await app.inject({ method: "POST", url: "/api/ai/digest", headers: auth, payload: { kind: "standup" } })).json();
    expect(d.ai).toBe(true);
    expect(file(`daily/${today}.md`)).toMatch(/## Standup\n.*core switch/);

    await fail(true);
    try {
      const r = await app.inject({ method: "POST", url: `/api/tasks/${t.id}/breakdown`, headers: auth, payload: {} });
      expect(r.statusCode).toBe(503);
      expect(r.json()).toMatchObject({ error: "ai_unavailable" });
      expect(JSON.stringify(r.json())).not.toContain("sk-");
      // the retro still gets written, from the template
      const retro = (await app.inject({ method: "POST", url: "/api/ai/digest", headers: auth, payload: { kind: "retro" } })).json();
      expect(retro.ai).toBe(false);
      expect(file(`daily/${today}.md`)).toMatch(/## Retro\nDone today/);
    } finally {
      await fail(false);
    }
    // validation
    expect((await app.inject({ method: "POST", url: `/api/tasks/${t.id}/subtasks`, headers: auth, payload: { titles: [] } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/api/ai/ask", headers: auth, payload: { q: "x".repeat(501) } })).statusCode).toBe(400);
    await app.close();
  });

  it("extension loading is switched off again once sqlite-vec is in", async () => {
    for (const env of [{}, { AI_PROVIDER: "none" }]) {
      const { ctx } = await harness(env);
      expect(() => ctx.db.$client.prepare("SELECT load_extension('/tmp/nope')").get()).toThrow(/not authorized/i);
      expect(() => (ctx.db.$client.native as unknown as { loadExtension(p: string): void }).loadExtension("/tmp/nope")).toThrow();
    }
  });

  it("AI_PROVIDER=none hides everything and the endpoints say why", async () => {
    const { ctx } = await harness({ AI_PROVIDER: "none", STT_BASE_URL: "" , AI_VISION_MODEL: ""});
    const app = await buildHttp(ctx, { logger: false });
    const auth = { authorization: "Bearer test-token-0123456789" };
    const st = (await app.inject({ url: "/api/ai/status", headers: auth })).json();
    expect(st.enabled).toBe(false);
    expect(Object.values(st.features).filter((v) => v === true)).toEqual([]);
    const r = await app.inject({ method: "POST", url: "/api/ai/ask", headers: auth, payload: { q: "anything here?" } });
    expect(r.statusCode).toBe(503);
    expect(r.json().reason).toBe("disabled");
    await app.close();
  });
});

describe("AI in Telegram", () => {
  it("/ask answers with sources", async () => {
    const { ctx } = await harness();
    await ctx.semantic!.sync();
    const h = botHarness(ctx);
    await h.command("/ask why did we decide to replace the core switch?");
    const m = await h.waitFor((p) => /Sources/.test(p.text));
    expect(m.text).toContain("SG350");
    expect(m.text).toContain("&lt;b&gt;not html&lt;/b&gt;"); // escaped for Telegram HTML
    expect(m.text).toMatch(/\[1\] 📄 homelab <code>projects\/homelab\.md<\/code>/);
  });

  it("voice note → transcript, task suggestions, one tap to add them", async () => {
    const { ctx, file, today } = await harness();
    const h = botHarness(ctx);
    await fetch(`${mock.url}/__voice?text=${encodeURIComponent("Remember to order a spare PSU tomorrow, it's urgent. I also need to call the ISP about the outage.")}`);
    await h.message({ voice: { file_id: "voice1", file_unique_id: "v", duration: 4, file_size: 2000 } });
    const m = await h.waitFor((p) => /I heard 2 tasks/.test(p.text));
    expect(m.text).toMatch(/1\. Order a spare PSU {2}<i>📅 \w{3} \d{1,2} \w{3} · p1 · #homelab<\/i>/);
    const add = m.reply_markup.inline_keyboard[0][0].callback_data as string;
    expect(add).toMatch(/^ai:add:[0-9a-f]{12}$/);
    expect(file(`daily/${today}.md`)).toMatch(/🎤 !\[\[attachments\/.*_voice\.oga\]\] Remember to order a spare PSU/);
    expect(ctx.db.select().from(tasks).where(eq(tasks.title, "Order a spare PSU")).get()).toBeUndefined(); // nothing until the tap

    await h.tap(add, m.text);
    const created = ctx.db.select().from(tasks).where(eq(tasks.title, "Order a spare PSU")).get()!;
    expect(created).toMatchObject({ priority: 1, dueDate: addDay(today) });
    expect(ctx.db.select().from(tasks).where(eq(tasks.title, "Call the ISP about the outage")).get()).toBeDefined();
    expect(h.calls.find((c) => c.method === "editMessageText")?.payload.text).toMatch(/Added 2 tasks/);
    await h.tap(add, m.text); // replay
    expect(ctx.db.select().from(tasks).where(eq(tasks.title, "Order a spare PSU")).all()).toHaveLength(1);
    expect(h.calls.filter((c) => c.method === "answerCallbackQuery").at(-1)!.payload.text).toBe("Already handled");
  });

  it("voice note when the model is down: still transcribed and logged", async () => {
    const { ctx, file, today } = await harness({ STT_BASE_URL: `${mock.url}/v1` });
    const h = botHarness(ctx);
    await fetch(`${mock.url}/__voice?text=${encodeURIComponent("Need to renew the domain.")}`);
    await fail(true); // the mock's STT keeps working; chat and embeddings fail
    try {
      await h.message({ voice: { file_id: "voice2", file_unique_id: "v2", duration: 2, file_size: 900 } });
      const m = await h.waitFor((p) => /Saved to today's log/.test(p.text));
      expect(m.text).toMatch(/Need to renew the domain[\s\S]*couldn't check it for tasks/);
      expect(file(`daily/${today}.md`)).toMatch(/🎤 .* Need to renew the domain/);
      expect(readdirSync(join(ctx.config.VAULT_PATH, "attachments", today.slice(0, 7))).some((f) => f.endsWith("_voice.oga"))).toBe(true);
    } finally {
      await fail(false);
    }
    expect(file(`daily/${today}.md`)).not.toMatch(/- \[ \] Renew/);
  });

  it("photo → a note with the text the model read, sanitised", async () => {
    const { ctx, file, today } = await harness();
    const h = botHarness(ctx);
    await h.message({ photo: [{ file_id: "photo1", file_unique_id: "p", width: 800, height: 600, file_size: 5000 }], caption: "rear of the new switch" });
    const m = await h.waitFor((p) => /Switch rear label/.test(p.text));
    expect(m.text).toContain("inbox/switch-rear-label.md");
    const note = file("inbox/switch-rear-label.md");
    expect(note).toMatch(/!\[\[attachments\/.*_photo\.jpg\]\]/);
    expect(note).toContain("> rear of the new switch");
    expect(note).toContain("- Serial: PSZ2219A0KX");
    expect(note).not.toMatch(/\[ \]|\^oc-photo01|^---$\n- PoE/m);
    expect(ctx.db.select().from(tasks).where(eq(tasks.title, "sneaky checkbox")).get()).toBeUndefined();
    expect(file(`daily/${today}.md`)).toContain("→ [[Switch rear label]]");
  });

  it("/standup writes the daily note and replies", async () => {
    const { ctx, file, today } = await harness();
    const h = botHarness(ctx);
    await h.command("/standup");
    const m = await h.waitFor((p) => /Standup/.test(p.text));
    expect(m.text).toContain(`Saved to daily/${today}.md`);
    expect(file(`daily/${today}.md`)).toMatch(/## Standup\nYou wrapped up/);
    expect(file(`daily/${today}.md`)).not.toMatch(/Fake task from the model.*\^oc-|^- \[ \] Fake/m);
  });

  it("reminders get a varied line from the local model when AI_NAG_VARIATION is on", async () => {
    const { ctx } = await harness({ AI_NAG_VARIATION: "true" });
    const h = botHarness(ctx);
    const n = new TelegramNotifier(h.bot, [ME], { db: ctx.db, ai: ctx.ai, nag: ctx.nag });
    const t = ctx.db.select().from(tasks).where(eq(tasks.title, "Replace core switch")).get()!;
    await n.sendReminder({ task: t, state: "overdue", decision: { state: "overdue", intervalMin: 30, dueAt: new Date(Date.now() - 3600e3), nextAt: new Date(), send: true }, subtasks: { done: 0, total: 0 }, reminderCount: 2, now: new Date() });
    expect(h.sent().at(-1)!.text).toMatch(/<i>Five minutes on this now saves an hour later \(\d+\)\.<\/i>$/);
    await fail(true);
    try {
      await n.sendReminder({ task: { ...t, id: "other" }, state: "overdue", decision: { state: "overdue", intervalMin: 30, dueAt: new Date(Date.now() - 3600e3), nextAt: new Date(), send: true }, subtasks: { done: 0, total: 0 }, reminderCount: 3, now: new Date() });
      expect(h.sent().at(-1)!.text).not.toContain("<i>Five"); // falls back to the plain reminder
    } finally {
      await fail(false);
    }
  });
});

function addDay(iso: string) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
