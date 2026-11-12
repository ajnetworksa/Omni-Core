// Live demo session: real server + real bot code + mock Bot API; records everything for rendering.
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { client, freshDir, localDate, ROOT, sleep, startServer } from "../tests/lib/harness.mjs";
import { callbackUpdate, mediaUpdate, startMockTelegram, textUpdate, PNG } from "../tests/lib/mock-telegram.mjs";
import { seedVault } from "../tests/lib/seed.mjs";

const TZ = "Asia/Riyadh", ME = 111, STRANGER = 999;
const TOKEN = "4242:DEMO", API_TOKEN = "demo-token-0123456789abcdef";
const RUN = freshDir(join(ROOT, "demo/run"));
const VAULT = join(RUN, "vault");
seedVault(VAULT, TZ);
const tg = await startMockTelegram({ port: 3951, token: TOKEN, botUsername: "omnicore_bot" });
tg.addFile("rackphoto", "photos/file_7.jpg", PNG);
const srv = await startServer({
  port: 3950,
  logFile: join(RUN, "server.log"),
  env: {
    VAULT_PATH: VAULT, DATABASE_PATH: join(RUN, "app.db"), TIMEZONE: TZ, API_TOKEN, TRUST_PROXY: "true",
    TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_ALLOWED_USER_IDS: String(ME), TELEGRAM_API_ROOT: tg.url,
    NAG_TICK_SECONDS: "15", NAG_QUIET_HOURS: "", NAG_DEFAULT_DUE_TIME: "00:00", REINDEX_INTERVAL_MINUTES: "0", DIGEST_TIME: "",
  },
});
const api = client(srv.base, API_TOKEN, { "cf-connecting-ip": "10.0.0.1" });
const events = []; // user-side events
const me = (text, extra) => { const u = tg.inject(textUpdate(tg, ME, text, extra)); events.push({ kind: "user", chat: ME, at: Date.now(), text, id: u.message.message_id, reply_to: extra?.reply_to_message?.message_id }); return u; };
const tap = (data, messageId, label) => { tg.inject(callbackUpdate(tg, ME, data, { message_id: messageId, text: "x" })); events.push({ kind: "tap", chat: ME, at: Date.now(), data, label, messageId }); };
const botMsg = (pred, since) => tg.waitFor("sendMessage", (c) => Number(c.payload.chat_id) === ME && pred(c), 30000, since);
const btn = (call, re) => call.payload.reply_markup.inline_keyboard.flat().find((b) => re.test(b.text) || re.test(b.callback_data));

let m = tg.mark(); me("/start"); await botMsg(() => true, m); await sleep(400);
m = tg.mark(); me("/todo Replace UPS battery !p1 @today 18:00 #project/homelab"); const ups = await botMsg(() => true, m); await sleep(400);
m = tg.mark(); me("+ Call ISP about fibre repair @tomorrow 10:00"); await botMsg(() => true, m); await sleep(400);
me("Router rebooted after power blip, all VLANs back up"); await sleep(900);
{ const u = tg.inject(mediaUpdate(tg, ME, "photo", "rackphoto", "Rack before cleanup")); events.push({ kind: "user", chat: ME, at: Date.now(), photo: true, text: "Rack before cleanup", id: u.message.message_id }); }
await sleep(1200);
m = tg.mark(); me("/note Rack Layout\nTop: patch panel, then switch\n- [ ] Buy blanking plates"); await botMsg(() => true, m); await sleep(400);

// Wait for the nag engine's first tick (reminders for seeded overdue / partial / blocked tasks)
await tg.waitFor("sendMessage", (c) => /Still in progress|Blocked|Overdue/.test(c.payload.text), 30000, 0);
await sleep(1500);
const reminders = tg.calls.filter((c) => c.method === "sendMessage" && /Still in progress|Blocked|Overdue/.test(c.payload.text));
const core = reminders.find((c) => c.payload.text.includes("Replace core switch"));
const vlan = reminders.find((c) => c.payload.text.includes("Migrate VLANs"));
const ipplan = reminders.find((c) => c.payload.text.includes("Document IP plan"));
await sleep(800);
if (core) { tap(`t:menu:${btn(core, /Partial/).callback_data.split(":")[2]}`, core.result.message_id, "🌗 Partial"); await sleep(900);
  tap(`t:p50:${btn(core, /Partial/).callback_data.split(":")[2]}`, core.result.message_id, "50%"); await sleep(900); }
if (vlan) { m = tg.mark(); tap(btn(vlan, /Remark/).callback_data, vlan.result.message_id, "💬 Remark");
  const prompt = await botMsg((c) => c.payload.reply_markup?.force_reply, m); await sleep(600);
  m = tg.mark(); me("Waiting for change-window approval from ops", { reply_to_message: { message_id: prompt.result.message_id, date: 0, chat: { id: ME, type: "private" } } });
  await botMsg(() => true, m); await sleep(500); }
if (ipplan) { tap(btn(ipplan, /\+1h/).callback_data, ipplan.result.message_id, "⏱ +1h"); await sleep(900); }

// Overdue reminder for the task created from Telegram (due 18:00 today, now later)
await tg.waitFor("sendMessage", (c) => c.payload.text.startsWith("⏰") && c.payload.text.includes("Replace UPS battery"), 30000, 0).catch(() => {});
await sleep(800);
m = tg.mark(); me("/today"); const today = await botMsg(() => true, m); await sleep(700);
const done = btn(today, /Call ISP about outage/); if (done) { tap(done.callback_data, today.result.message_id, done.text); await sleep(1200); }
m = tg.mark(); me("/project homelab"); await botMsg(() => true, m); await sleep(400);
m = tg.mark(); me("/search vlan"); await botMsg(() => true, m); await sleep(400);
// a stranger
tg.inject(textUpdate(tg, STRANGER, "/todo let me in")); events.push({ kind: "user", chat: STRANGER, at: Date.now(), text: "/todo let me in" });
await sleep(1200);

// --- API + security responses
const show = async (label, method, path, body, headers, c = api) => {
  const r = await c.raw(method, path, body, headers);
  return { label, method, path, status: r.status, headers: Object.fromEntries([...r.headers].filter(([k]) => /content-type|x-frame|x-content|referrer|cache-control|content-security/.test(k))), body: r.json ?? r.text };
};
const anon = client(srv.base, undefined, { "cf-connecting-ip": "203.0.113.7" });
const apiShots = [
  await show("Today view", "GET", "/api/today"),
  await show("Blocked tasks", "GET", "/api/tasks?status=blocked"),
  await show("Quick-add task", "POST", "/api/tasks", { text: "Order spare PSU !p2 @tomorrow #project/homelab" }),
  await show("Note graph", "GET", "/api/graph"),
];
const secShots = [
  await show("No token", "GET", "/api/today", undefined, {}, anon),
  await show("Path traversal", "POST", "/api/tasks", { text: "x", notePath: "../../etc/evil.md" }),
  await show("Protected folder", "POST", "/api/tasks", { text: "x", notePath: ".obsidian/evil.md" }),
  await show("Prototype pollution", "POST", "/api/tasks", '{"text":"x","__proto__":{"polluted":true}}'),
];
const bf = [];
for (let i = 1; i <= 11; i++) bf.push((await anon.get("/api/today", { authorization: `Bearer guess-${i}` })).status);
secShots.push({ label: "Brute force (11 wrong tokens)", method: "GET", path: "/api/today × 11", status: bf.at(-1), body: { statuses: bf } });
secShots.push(await show("Correct token while locked out", "GET", "/api/today", undefined, { authorization: `Bearer ${API_TOKEN}` }, anon));
secShots.push(await show("CORS from evil origin", "GET", "/api/today", undefined, { origin: "https://evil.example" }));
secShots[secShots.length - 1].headers["access-control-allow-origin"] = "(not set)";

await srv.stop();
await tg.close();
const vault = {};
for (const rel of ["projects/homelab.md", `daily/${localDate(TZ, 0)}.md`, "inbox/rack-layout.md", "projects/website.md"]) vault[rel] = readFileSync(join(VAULT, rel), "utf8");
const att = readdirSync(join(VAULT, "attachments"), { recursive: true });
writeFileSync(join(ROOT, "demo/out/session.json"), JSON.stringify({ calls: tg.calls, events, apiShots, secShots, vault, attachments: att, today: localDate(TZ, 0) }, null, 2));
console.log("calls", tg.calls.length, "events", events.length, "reminders", reminders.length);
