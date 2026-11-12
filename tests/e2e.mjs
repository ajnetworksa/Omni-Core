// End-to-end feature tests against a running server + mock Telegram.  Run: npm run test:e2e
import { existsSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync, cpSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { assert, Checks, client, eq, freshDir, localDate, localHHMM, ROOT, sleep, startServer } from "./lib/harness.mjs";
import { callbackUpdate, mediaUpdate, startMockTelegram, textUpdate } from "./lib/mock-telegram.mjs";
import { seedVault } from "./lib/seed.mjs";

const TZ = "Asia/Riyadh";
const ME = 111;
const STRANGER = 999;
const TOKEN = "4242:E2E-TEST-TOKEN";
const API_TOKEN = "e2e-" + Math.random().toString(36).slice(2);
const PORT = 3930, TG_PORT = 3931, HOOK_PORT = 3932;
const RUN = freshDir(join(ROOT, "tests/.run/e2e"));
const VAULT = join(RUN, "vault");
const DB = join(RUN, "data/app.db");

const c = new Checks("E2E feature tests");
const until = async (fn, ms = 6000, step = 150) => {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < ms) {
    try {
      const v = await fn();
      if (v) return v;
    } catch (e) {
      last = e;
    }
    await sleep(step);
  }
  throw new Error(`condition not met in ${ms}ms${last ? `: ${last.message}` : ""}`);
};
const read = (rel) => readFileSync(join(VAULT, rel), "utf8");
const write = (rel, s) => writeFileSync(join(VAULT, rel), s);
const db = () => new DatabaseSync(DB, { readOnly: true });

const seed = seedVault(VAULT, TZ);
const { today, plus1 } = seed;
const tg = await startMockTelegram({ port: TG_PORT, token: TOKEN });
tg.addFile("photo1", "photos/file_1.jpg");
tg.addFile("voice1", "voice/file_2.oga");
tg.addFile("doc1", "documents/file_3.pdf");

const env = {
  VAULT_PATH: VAULT,
  DATABASE_PATH: DB,
  TIMEZONE: TZ,
  API_TOKEN,
  TELEGRAM_BOT_TOKEN: TOKEN,
  TELEGRAM_ALLOWED_USER_IDS: String(ME),
  TELEGRAM_API_ROOT: tg.url,
  NAG_TICK_SECONDS: "15",
  NAG_QUIET_HOURS: "",
  NAG_DEFAULT_DUE_TIME: "00:00",
  REINDEX_INTERVAL_MINUTES: "0",
  DIGEST_TIME: "",
};
let srv = await startServer({ env, port: PORT, logFile: join(RUN, "server-1.log") });
const api = client(srv.base, API_TOKEN);
const all = async () => (await api.get("/api/tasks?limit=2000")).json;
const byTitle = async (t) => (await all()).find((x) => x.title === t);
const say = (text, extra) => tg.inject(textUpdate(tg, ME, text, extra));
const lastReplyTo = (since) => tg.waitFor("sendMessage", (x) => Number(x.payload.chat_id) === ME, 8000, since);

// ---------------------------------------------------------------- A
c.group("A. Deploy & initial indexing (demo vault)");
await c.run("server healthy, Telegram running", async () => {
  const h = await client(srv.base).get("/health");
  eq(h.status, 200);
  eq(h.json.telegram, "running", "telegram status");
});
await c.run("indexes 6 notes and ignores .obsidian/", async () => {
  const n = (await api.get("/api/notes")).json;
  eq(n.length, seed.expectedNotes, "note count");
  assert(!n.some((x) => x.path.startsWith(".obsidian")), ".obsidian indexed");
});
await c.run("indexes 14 tasks; code-fence example is not a task", async () => {
  const t = await all();
  eq(t.length, seed.expectedTasks, "task count");
  assert(!t.some((x) => x.title.includes("code fence")), "fenced example indexed");
});
await c.run("block anchors written to every task line", async () => {
  for (const f of ["projects/homelab.md", "projects/website.md", "inbox/ideas.md"]) {
    const lines = read(f).split(/\r?\n/).filter((l) => /^\s*[-*+] \[.\] /.test(l) && !l.includes("inside a code fence"));
    assert(lines.every((l) => /\^oc-[a-z0-9]{8}$/.test(l)), `missing anchor in ${f}`);
  }
  assert(read("projects/homelab.md").includes("- [ ] this is an example inside a code fence, not a task\n"), "fence modified");
});
await c.run("catch-up rollover moved 3 overdue tasks to today (+1 rollover, written to file)", async () => {
  for (const t of ["Migrate VLANs", "Call ISP about outage", "Draft homepage copy"]) {
    const x = await byTitle(t);
    eq([x.dueDate, x.rolloverCount], [today, 1], t);
  }
  assert(read("projects/website.md").includes(`Draft homepage copy !p2 📅 ${today}`), "file not updated");
});
await c.run("statuses, subtasks and projects parsed", async () => {
  const t = await all();
  const get = (n) => t.find((x) => x.title === n);
  eq(get("Migrate VLANs").status, "blocked");
  eq(get("Document IP plan").status, "in_progress");
  eq(get("Old landing page idea").status, "cancelled");
  eq(get("Install UPS").status, "done");
  eq(get("Order SFP modules").parentTaskId, get("Replace core switch").id, "subtask parent");
  const p = (await api.get("/api/projects")).json.map((x) => x.slug).sort();
  eq(p, ["homelab", "website-redesign"]);
});
await c.run("CRLF note indexed and kept CRLF after anchoring", async () => {
  const s = read("inbox/ideas.md");
  assert(s.includes("\r\n") && !/[^\r]\n/.test(s), "line endings changed");
});
await c.run("graph: links resolved, dangling link reported", async () => {
  const g = (await api.get("/api/graph")).json;
  const title = Object.fromEntries(g.nodes.map((n) => [n.id, n.title]));
  const edges = g.edges.map((e) => `${title[e.source]}→${title[e.target]}`).sort();
  for (const e of ["homelab→Network Map", "homelab→Vendors", "Network Map→homelab"]) assert(edges.includes(e), `missing ${e}`);
  eq(g.dangling.map((d) => d.targetTitle), ["Missing Page"]);
});
await c.run("/api/today buckets + pinning", async () => {
  const v = (await api.get("/api/today")).json;
  eq(v.date, today);
  assert(v.dueToday.length >= 6, `dueToday=${v.dueToday.length}`);
  const palette = await byTitle("Pick colour palette");
  await api.patch(`/api/tasks/${palette.id}`, { pinned: true });
  const v2 = (await api.get("/api/today")).json;
  eq(v2.pinned.map((x) => x.title), ["Pick colour palette"]);
});
await c.run("list filters: status, project, tag, minRollover", async () => {
  eq((await api.get("/api/tasks?status=blocked")).json.map((x) => x.title), ["Migrate VLANs"]);
  eq((await api.get("/api/tasks?project=website-redesign")).json.length, 3);
  assert((await api.get("/api/tasks?tag=network")).json.length === 2, "tag filter");
  eq((await api.get("/api/tasks?minRollover=1")).json.length, 3);
});

// ---------------------------------------------------------------- B
c.group("B. Write-back through the API");
await c.run("quick-add lands in today's daily note with project + metadata", async () => {
  const r = await api.post("/api/tasks", { text: "Buy label printer !p2 @tomorrow 10:00 #office #project/homelab" });
  eq(r.status, 201);
  eq([r.json.priority, r.json.dueDate, r.json.dueTime], [2, plus1, "10:00"]);
  const f = read(`daily/${today}.md`);
  assert(new RegExp(`## Tasks\\n- \\[ \\] Buy label printer !p2 📅 ${plus1} 10:00 #office #project/homelab \\^oc-`).test(f), f);
  const homelab = (await api.get("/api/projects")).json.find((p) => p.slug === "homelab");
  eq(r.json.projectId, homelab.id);
});
await c.run("done flips only the checkbox and adds ✅; reopening restores the file byte-for-byte", async () => {
  const t = await byTitle("Renew TLS certs");
  const before = read("projects/homelab.md");
  await api.patch(`/api/tasks/${t.id}`, { status: "done" });
  const after = read("projects/homelab.md");
  const diff = after.split("\n").filter((l, i) => l !== before.split("\n")[i]);
  eq(diff.length, 1, "lines changed");
  assert(new RegExp(`^- \\[x\\] Renew TLS certs 📅 \\S+ ✅ ${today} \\^oc-`).test(diff[0]), diff[0]);
  await api.patch(`/api/tasks/${t.id}`, { status: "ready" });
  eq(read("projects/homelab.md"), before, "reopen");
});
await c.run("due date / priority edit rewrites the line, keeps tags and anchor", async () => {
  const t = await byTitle("Pick colour palette");
  await api.patch(`/api/tasks/${t.id}`, { dueDate: localDate(TZ, 5), priority: 3 });
  const line = read("projects/website.md").split("\n").find((l) => l.includes("Pick colour palette"));
  assert(new RegExp(`^- \\[ \\] Pick colour palette !p3 📅 ${localDate(TZ, 5)} #design \\^${t.anchor}$`).test(line), line);
});
await c.run("CRLF file stays CRLF after a write-back", async () => {
  const t = await byTitle("Try Proxmox Backup Server");
  await api.patch(`/api/tasks/${t.id}`, { status: "done" });
  const s = read("inbox/ideas.md");
  assert(s.includes("- [x] Try Proxmox Backup Server") && !/[^\r]\n/.test(s), JSON.stringify(s));
});
await c.run("actions: p50 → [/] + 50%; remark stored", async () => {
  const t = await byTitle("Order SFP modules");
  const r = await api.post(`/api/tasks/${t.id}/actions/p50`);
  eq([r.json.task.status, r.json.task.progress], ["in_progress", 50]);
  assert(read("projects/homelab.md").includes("  - [/] Order SFP modules"), "file");
  const rm = await api.post(`/api/tasks/${t.id}/remarks`, { text: "Waiting for supplier quote" });
  eq(rm.json.remarks.at(-1).text, "Waiting for supplier quote");
});
await c.run("recurring task: completing inserts next week's occurrence above", async () => {
  const t = await byTitle("Backup NAS");
  await api.post(`/api/tasks/${t.id}/actions/done`);
  const lines = read("projects/homelab.md").split("\n");
  const i = lines.findIndex((l) => l.includes(`Backup NAS 🔁 every week 📅 ${localDate(TZ, 7)}`));
  assert(i >= 0 && lines[i].startsWith("- [ ]"), "next occurrence missing");
  assert(lines[i + 1].startsWith("- [x] Backup NAS") && lines[i + 1].includes(`✅ ${today}`), lines[i + 1]);
  eq((await all()).filter((x) => x.title === "Backup NAS").length, 2);
});
await c.run("validation & errors: 400 / 404 with no internals leaked", async () => {
  const t = await byTitle("Renew TLS certs");
  eq((await api.patch(`/api/tasks/${t.id}`, { priority: 9 })).status, 400);
  eq((await api.post(`/api/tasks/${t.id}/actions/explode`)).status, 400);
  const nf = await api.get("/api/tasks/00000000-0000-0000-0000-000000000000");
  eq([nf.status, nf.json], [404, { error: "not_found" }]);
});

// ---------------------------------------------------------------- C
c.group("C. External edits (Obsidian simulation)");
await c.run("ticking a box on disk updates the DB", async () => {
  write("projects/website.md", read("projects/website.md").replace("- [ ] Draft homepage copy", "- [x] Draft homepage copy"));
  await until(async () => (await byTitle("Draft homepage copy")).status === "done");
});
await c.run("a new line typed in Obsidian becomes a task with an anchor", async () => {
  write("Vendors.md", read("Vendors.md") + "- [ ] Ask Juniper for EOL dates 📅 " + plus1 + "\n");
  const t = await until(() => byTitle("Ask Juniper for EOL dates"));
  await until(() => /Ask Juniper for EOL dates 📅 \S+ \^oc-/.test(read("Vendors.md")));
  return `id ${t.id.slice(0, 8)}`;
});
await c.run("renaming keeps the same task id (anchor identity) and DB-only state", async () => {
  const t = await byTitle("Order SFP modules");
  write("projects/homelab.md", read("projects/homelab.md").replace("Order SFP modules", "Order 4x SFP+ modules"));
  const r = await until(async () => (await all()).find((x) => x.id === t.id && x.title === "Order 4x SFP+ modules"));
  eq([r.progress, r.remarks.length], [50, 1], "state kept");
});
await c.run("cut + paste a task line into another note keeps its id (move)", async () => {
  const t = await byTitle("Ask Juniper for EOL dates");
  const line = read("Vendors.md").split("\n").find((l) => l.includes("Ask Juniper"));
  write("Vendors.md", read("Vendors.md").replace(line + "\n", "")); // cut
  write("projects/homelab.md", read("projects/homelab.md").trimEnd() + "\n" + line + "\n"); // paste
  const notesNow = async () => (await api.get("/api/notes")).json;
  let seen = "";
  const hits = await until(async () => {
    const h = (await all()).filter((x) => x.title === "Ask Juniper for EOL dates");
    const n = await notesNow();
    seen = JSON.stringify(h.map((x) => [x.id.slice(0, 8), n.find((y) => y.id === x.noteId)?.path]));
    return h.length === 1 && n.find((x) => x.id === h[0].noteId)?.path === "projects/homelab.md" ? h : null;
  }, 8000).catch((e) => {
    throw new Error(`${e.message}; last seen ${seen}; homelab has line: ${read("projects/homelab.md").includes(line)}; Vendors has line: ${read("Vendors.md").includes(line)}`);
  });
  eq(hits.length, 1, "copies");
  const notes = (await api.get("/api/notes")).json;
  eq(notes.find((n) => n.id === hits[0].noteId)?.path, "projects/homelab.md", "note");
  eq(hits[0].id, t.id, "id");
});
await c.run("copy-pasting a task into another note creates a second task (no index failure)", async () => {
  const line = read("projects/website.md").split("\n").find((l) => l.includes("Pick colour palette"));
  write("inbox/ideas.md", read("inbox/ideas.md") + line + "\r\n");
  await until(async () => (await all()).filter((x) => x.title === "Pick colour palette").length === 2);
  const anchors = (await all()).filter((x) => x.title === "Pick colour palette").map((x) => x.anchor);
  assert(anchors[0] !== anchors[1], "duplicate anchors");
});
await c.run("deleting a line removes the task; deleting a file removes the note", async () => {
  write("projects/website.md", read("projects/website.md").split("\n").filter((l) => !l.includes("Old landing")).join("\n"));
  await until(async () => !(await byTitle("Old landing page idea")));
  unlinkSync(join(VAULT, "Vendors.md"));
  await until(async () => !(await api.get("/api/notes")).json.some((n) => n.path === "Vendors.md"));
});
await c.run("creating the missing page resolves the dangling link", async () => {
  write("Missing Page.md", "# Missing Page\n\nNow it exists.\n");
  await until(async () => !(await api.get("/api/graph")).json.dangling.some((d) => d.targetTitle === "Missing Page"));
});
await c.run("broken YAML frontmatter is indexed without crashing", async () => {
  write("inbox/broken.md", "---\ntags: [unclosed\n---\n- [ ] Still a task\n");
  await until(() => byTitle("Still a task"));
  eq((await client(srv.base).get("/health")).status, 200);
});
await c.run("edit-vs-API race never corrupts the file", async () => {
  const t = await byTitle("Renew TLS certs");
  const src = read("projects/homelab.md");
  write("projects/homelab.md", src.replace("Renew TLS certs", "Renew TLS certificates"));
  const r = await api.patch(`/api/tasks/${t.id}`, { status: "done" });
  await sleep(800);
  const f = read("projects/homelab.md");
  const lines = f.split("\n").filter((l) => l.includes("Renew TLS"));
  eq(lines.length, 1, "duplicate/missing line");
  assert(lines[0].includes("Renew TLS certificates"), "external edit lost");
  return `API answered ${r.status}`;
});

// ---------------------------------------------------------------- D
c.group("D. Telegram bot (real grammY polling against mock Bot API)");
await c.run("startup: getMe, deleteWebhook, setMyCommands", async () => {
  for (const m of ["getMe", "deleteWebhook", "setMyCommands"]) assert(tg.calls.some((x) => x.method === m), m);
  eq(tg.calls.find((x) => x.method === "setMyCommands").payload.commands.map((x) => x.command), ["menu", "new", "todo", "today", "note", "project", "search", "ask", "standup", "retro", "log", "help"]);
});
await c.run("stranger is told their id and can't create tasks", async () => {
  const since = tg.mark();
  const before = (await all()).length;
  tg.inject(textUpdate(tg, STRANGER, "/todo sneaky task"));
  const m = await tg.waitFor("sendMessage", (x) => Number(x.payload.chat_id) === STRANGER, 8000, since);
  assert(m.payload.text.includes(`<code>${STRANGER}</code>`), m.payload.text);
  await sleep(300);
  eq((await all()).length, before);
});
await c.run("/help", async () => {
  const since = tg.mark();
  say("/help");
  assert((await lastReplyTo(since)).payload.text.includes("Reminders keep coming"), "help text");
});
let tgTask;
await c.run("/todo creates the task and replies with 6 action buttons", async () => {
  const since = tg.mark();
  say("/todo Flash router firmware !p1 @today 00:01 #project/homelab");
  const m = await lastReplyTo(since);
  tgTask = await byTitle("Flash router firmware");
  assert(tgTask && tgTask.priority === 1, "task");
  const btns = m.payload.reply_markup.inline_keyboard.flat();
  eq(btns.map((b) => b.text), ["✅ Done", "🌗 Partial", "💬 Remark", "⏱ +1h", "🌅 Tomorrow", "🔕 Today"]);
  assert(btns.every((b) => Buffer.byteLength(b.callback_data) <= 64), "callback_data > 64 bytes");
});
await c.run("'+ text' quick task", async () => {
  say("+ Label patch panel @tomorrow");
  const t = await until(() => byTitle("Label patch panel"));
  eq(t.dueDate, plus1);
});
await c.run("plain text → timestamped daily log line + ✍ reaction", async () => {
  const since = tg.mark();
  say("ISP confirmed fibre repair at 4pm");
  await tg.waitFor("setMessageReaction", () => true, 8000, since);
  assert(/## Log\n(- \d\d:\d\d .*\n)*- \d\d:\d\d ISP confirmed fibre repair at 4pm/.test(read(`daily/${today}.md`)), "log");
});
await c.run("/log", async () => {
  say("/log Rebooted switch stack");
  await until(() => read(`daily/${today}.md`).includes("Rebooted switch stack"));
});
await c.run("/note (multi-line) → inbox note, tasks inside are indexed", async () => {
  const since = tg.mark();
  say("/note Rack Layout\nTop: patch panel\n- [ ] Buy blanking plates");
  assert((await lastReplyTo(since)).payload.text.includes("inbox/rack-layout.md"), "reply");
  assert(read("inbox/rack-layout.md").includes("# Rack Layout\n\nTop: patch panel\n- [ ] Buy blanking plates"), "file");
  await until(() => byTitle("Buy blanking plates"));
});
await c.run("/today lists tasks with one-tap ✅; tapping completes and refreshes", async () => {
  const since = tg.mark();
  say("/today");
  const m = await lastReplyTo(since);
  assert(m.payload.text.includes(`Today · ${today}`), "header");
  const btn = m.payload.reply_markup.inline_keyboard.flat().find((b) => b.text.includes("Call ISP"));
  assert(btn, "no Call ISP button");
  const s2 = tg.mark();
  tg.inject(callbackUpdate(tg, ME, btn.callback_data, { message_id: m.result.message_id, text: "list" }));
  await tg.waitFor("editMessageText", (x) => x.payload.text.includes("done today"), 8000, s2);
  eq((await byTitle("Call ISP about outage")).status, "done");
});
await c.run("/project homelab shows progress, blockers with remarks, next up", async () => {
  const since = tg.mark();
  say("/project homelab");
  const t = (await lastReplyTo(since)).payload.text;
  assert(/📁 Homelab<\/b>\n[▰▱]{10} \d+% · \d+\/\d+ done/.test(t), t);
  assert(t.includes("Blockers") && t.includes("Migrate VLANs") && t.includes("Waiting for supplier quote"), t);
});
await c.run("/project (no args) lists projects", async () => {
  const since = tg.mark();
  say("/project");
  const m = await lastReplyTo(since);
  const labels = m.payload.reply_markup.inline_keyboard.flat().map((b) => b.text).join("|");
  assert(/📁 Homelab/i.test(labels) && /website/i.test(labels) && labels.includes("➕ New project"), labels);
});
await c.run("/search finds notes and tasks", async () => {
  const since = tg.mark();
  say("/search vlan");
  const t = (await lastReplyTo(since)).payload.text;
  assert(t.includes("Migrate VLANs") && t.includes("homelab"), t);
});
await c.run("reminder buttons: Partial menu → 25%", async () => {
  const since = tg.mark();
  tg.inject(callbackUpdate(tg, ME, `t:menu:${tgTask.id}`, { message_id: 77, text: "r" }));
  const kb = await tg.waitFor("editMessageReplyMarkup", () => true, 8000, since);
  eq(kb.payload.reply_markup.inline_keyboard.flat().map((b) => b.text), ["25%", "50%", "75%", "▶️ Just started", "⬅️ Back"]);
  tg.inject(callbackUpdate(tg, ME, `t:p25:${tgTask.id}`, { message_id: 77, text: "r" }));
  await until(async () => (await byTitle("Flash router firmware")).progress === 25);
});
await c.run("💬 Remark → force-reply prompt → reply saves remark", async () => {
  const since = tg.mark();
  tg.inject(callbackUpdate(tg, ME, `t:rem:${tgTask.id}`, { message_id: 77, text: "r" }));
  const prompt = await tg.waitFor("sendMessage", (x) => x.payload.reply_markup?.force_reply, 8000, since);
  say("Need console cable first", { reply_to_message: { message_id: prompt.result.message_id, date: 0, chat: { id: ME, type: "private" } } });
  await until(async () => (await byTitle("Flash router firmware")).remarks.at(-1)?.text === "Need console cable first");
});
await c.run("⏱ +1h, 🔕 Today, 🌅 Tomorrow, ✅ Done", async () => {
  const s = await api.post("/api/tasks", { text: "Snooze target @tomorrow" });
  const id = s.json.id;
  const tap = async (a) => {
    const since = tg.mark();
    tg.inject(callbackUpdate(tg, ME, `t:${a}:${id}`, { message_id: 88, text: "r" }));
    return (await tg.waitFor("answerCallbackQuery", () => true, 8000, since)).payload.text;
  };
  eq(await tap("snooze1h"), "⏱ Snoozed 1h");
  const t1 = (await api.get(`/api/tasks/${id}`)).json;
  assert(Math.abs(new Date(t1.snoozedUntil) - Date.now() - 3600e3) < 60e3, "snooze time");
  eq(await tap("mute"), "🔕 Muted for today");
  assert((await tap("tomorrow")).startsWith("🌅 Moved to tomorrow"), "tomorrow");
  const t2 = (await api.get(`/api/tasks/${id}`)).json;
  eq([t2.dueDate, t2.dueTime, t2.snoozedUntil], [plus1, "08:00", null]);
  eq(await tap("done"), "✅ Done");
  eq((await api.get(`/api/tasks/${id}`)).json.status, "done");
});
await c.run("photo with caption → vault/attachments + embedded in log", async () => {
  tg.inject(mediaUpdate(tg, ME, "photo", "photo1", "Rack before cleanup"));
  const line = await until(() => read(`daily/${today}.md`).split("\n").find((l) => l.includes("📷 ![[attachments/")));
  const rel = line.match(/!\[\[(.+?)\]\]/)[1];
  assert(existsSync(join(VAULT, rel)) && line.endsWith("Rack before cleanup"), line);
  eq(readFileSync(join(VAULT, rel)).subarray(1, 4).toString(), "PNG");
});
await c.run("voice note and document saved", async () => {
  tg.inject(mediaUpdate(tg, ME, "voice", "voice1"));
  tg.inject(mediaUpdate(tg, ME, "document", "doc1"));
  await until(() => read(`daily/${today}.md`).includes("🎤 ![[") && read(`daily/${today}.md`).includes("📎 ![["));
  const month = readdirSync(join(VAULT, "attachments"))[0];
  const files = readdirSync(join(VAULT, "attachments", month));
  assert(files.some((f) => f.endsWith(".oga")) && files.some((f) => f.endsWith(".pdf")), files.join(","));
});
await c.run("unknown command gets a hint", async () => {
  const since = tg.mark();
  say("/frobnicate");
  eq((await lastReplyTo(since)).payload.text, "Unknown command. Tap ☰ Menu or send /help.");
});

// ---------------------------------------------------------------- E
c.group("E. Nag engine (live ticks every 15 s)");
const reminders = () => tg.calls.filter((x) => x.method === "sendMessage" && /Overdue|Still in progress|Follow-up|Blocked/.test(x.payload.text));
await c.run("reminders arrive for due tasks, p1 first, ≤5 per tick", async () => {
  await until(() => reminders().length >= 1, 25000, 500);
  await sleep(500);
  const first = reminders();
  const firstBatch = first.filter((x) => x.at - first[0].at < 2000);
  assert(firstBatch.length <= 5, `batch ${firstBatch.length}`);
  assert(/Replace core switch|Flash router firmware/.test(firstBatch[0].payload.text), firstBatch[0].payload.text.split("\n")[1]);
  return `${firstBatch.length} in first tick`;
});
await c.run("overdue / partial (subtasks) / blocked messages have the right shape", async () => {
  await api.post("/api/tasks", { text: "Overdue probe !p2 @today 00:01" });
  const shapes = {
    overdue: (t) => t.startsWith("⏰ <b>Overdue</b> by") && t.includes("Overdue probe") && t.includes("🟠 p2"),
    partial: (t) => t.startsWith("🌗 <b>Still in progress</b> — 1/3 subtasks") && t.includes("Replace core switch") && t.includes("🔴 p1"),
    blocked: (t) => t.startsWith("🧱 <b>Blocked</b>") && t.includes("Migrate VLANs") && t.includes("↻ rolled over 1×"),
  };
  await until(() => Object.values(shapes).every((f) => reminders().some((x) => f(x.payload.text))), 40000, 500);
});
await c.run("user actions reset the timer (just-remarked / partial tasks aren't pinged)", async () => {
  const titles = reminders().map((x) => x.payload.text.split("\n")[1]);
  assert(!titles.some((t) => t.includes("Flash router firmware")), "Flash router pinged right after user action");
});
await c.run("no duplicates, and done/snoozed/future tasks stay silent", async () => {
  const titles = reminders().map((x) => x.payload.text.split("\n")[1]);
  const counts = titles.reduce((m, t) => ((m[t] = (m[t] ?? 0) + 1), m), {});
  const dup = Object.entries(counts).filter(([, n]) => n > 1);
  eq(dup, [], "duplicate reminders within interval");
  for (const quiet of ["Snooze target", "Flash router firmware", "Install UPS", "Label patch panel", "Renew TLS certificates", "Buy label printer", "Pick colour palette"]) {
    assert(!titles.some((t) => t.includes(quiet)), `${quiet} was nagged`);
  }
  return `${titles.length} reminders, ${Object.keys(counts).length} distinct tasks`;
});
await c.run("reminders_log records chat + message ids; tapping a reminder acknowledges it", async () => {
  const r = reminders()[0];
  const id = r.payload.reply_markup.inline_keyboard[0][0].callback_data.split(":")[2];
  const since = tg.mark();
  tg.inject(callbackUpdate(tg, ME, `t:back:${id}`, { message_id: r.result.message_id, text: r.payload.text }));
  await tg.waitFor("editMessageReplyMarkup", () => true, 8000, since);
  const row = db().prepare("SELECT chat_id, message_id, ack_at FROM reminders_log WHERE message_id = ?").get(r.result.message_id);
  eq(row.chat_id, String(ME));
  assert(row.ack_at, "not acknowledged");
});

// ---------------------------------------------------------------- F
c.group("F. Restart, persistence, morning digest");
const countBefore = (await all()).length;
const remindersBefore = reminders().length;
const flash = await byTitle("Flash router firmware");
await srv.stop();
// Time travel: pretend the last remark / action on "Flash router firmware" happened 3 h ago.
{
  const w = new DatabaseSync(DB);
  const threeH = new Date(Date.now() - 3 * 3600e3).toISOString();
  const remarks = JSON.parse(w.prepare("SELECT remarks FROM tasks WHERE id = ?").get(flash.id).remarks).map((r) => ({ ...r, at: threeH }));
  w.prepare("UPDATE tasks SET remarks = ?, last_action_at = ?, status = 'ready', progress = 0 WHERE id = ?").run(JSON.stringify(remarks), threeH, flash.id);
  w.close();
}
const restartMark = tg.mark();
// Schedule the digest ~1 minute out so we can observe it.
const digestAt = localHHMM(TZ, new Date(Date.now() + 60_000));
srv = await startServer({ env: { ...env, DIGEST_TIME: digestAt }, port: PORT, logFile: join(RUN, "server-2.log") });
await c.run("data survives restart (tasks, remarks, anchors)", async () => {
  eq((await all()).length, countBefore);
  const t = await byTitle("Flash router firmware");
  eq([t.remarks.length, t.anchor], [1, flash.anchor]);
});
await c.run("rollover catch-up is idempotent across restarts", async () => {
  eq((await byTitle("Migrate VLANs")).rolloverCount, 1);
});
await c.run("remark follow-up quotes the remark once its interval has passed", async () => {
  const m = await tg.waitFor("sendMessage", (x) => x.payload.text.startsWith("💬 <b>Follow-up</b>") && x.payload.text.includes("Flash router firmware"), 25000, restartMark);
  assert(m.payload.text.includes("📝 <i>Need console cable first</i> (3h ago)"), m.payload.text);
});
await c.run("no burst of duplicate reminders after restart", async () => {
  await sleep(2000);
  const fresh = reminders().slice(remindersBefore).map((x) => x.payload.text.split("\n")[1]);
  assert(!fresh.some((t) => /Document IP plan|Migrate VLANs|Overdue probe|Replace core switch/.test(t)), `re-sent: ${fresh.join(", ")}`);
  return `${fresh.length} new (only tasks whose interval elapsed)`;
});
await c.run(`morning digest fires at DIGEST_TIME (${digestAt})`, async () => {
  const m = await tg.waitFor("sendMessage", (x) => x.payload.text.startsWith("🌅 Good morning"), 125000, restartMark);
  assert(m.payload.reply_markup.inline_keyboard.flat().some((b) => b.text === "🔄 Refresh"), "keyboard");
});
await srv.stop();

// ---------------------------------------------------------------- H
c.group("H. Webhook mode");
const HOOK_SECRET = "hook-" + Math.random().toString(36).slice(2);
const hookRun = freshDir(join(RUN, "hook"));
cpSync(VAULT, join(hookRun, "vault"), { recursive: true });
const hook = await startServer({
  env: { ...env, VAULT_PATH: join(hookRun, "vault"), DATABASE_PATH: join(hookRun, "app.db"), TELEGRAM_WEBHOOK_URL: `http://127.0.0.1:${HOOK_PORT}/telegram/webhook`, TELEGRAM_WEBHOOK_SECRET: HOOK_SECRET, NAG_ENABLED: "false" },
  port: HOOK_PORT,
  logFile: join(RUN, "server-hook.log"),
});
await c.run("registers the webhook with its secret", async () => {
  const s = [...tg.calls].reverse().find((x) => x.method === "setWebhook");
  eq([s.payload.url, s.payload.secret_token], [`http://127.0.0.1:${HOOK_PORT}/telegram/webhook`, HOOK_SECRET]);
});
await c.run("webhook rejects missing/wrong secret, accepts the right one", async () => {
  const body = { update_id: 900001, ...textUpdate(tg, ME, "/help") };
  const h = client(hook.base);
  eq((await h.post("/telegram/webhook", body)).status, 401, "no secret");
  eq((await h.post("/telegram/webhook", body, { "x-telegram-bot-api-secret-token": "nope" })).status, 401, "wrong secret");
  const since = tg.mark();
  eq((await h.post("/telegram/webhook", { ...body, update_id: 900002 }, { "x-telegram-bot-api-secret-token": HOOK_SECRET })).status, 200);
  await tg.waitFor("sendMessage", (x) => x.payload.text.includes("Reminders keep coming"), 8000, since);
});
await hook.stop();
await tg.close();

process.exitCode = c.summary(join(RUN, "e2e-results.json")) ? 1 : 0;
