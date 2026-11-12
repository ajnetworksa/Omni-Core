// Security tests against a running server + mock Telegram.  Run: npm run test:security
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { assert, Checks, client, eq, freshDir, ROOT, sleep, startServer } from "./lib/harness.mjs";
import { callbackUpdate, mediaUpdate, startMockTelegram, textUpdate } from "./lib/mock-telegram.mjs";
import { seedVault } from "./lib/seed.mjs";

const TZ = "Asia/Riyadh";
const ME = 111, STRANGER = 999;
const BOT_TOKEN = "4242:SEC-TEST-BOT-TOKEN-abcdef";
const API_TOKEN = "sec-" + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
const PORT = 3940, TG_PORT = 3941;
const RUN = freshDir(join(ROOT, "tests/.run/security"));
const VAULT = join(RUN, "vault");
const OUTSIDE = freshDir(join(RUN, "outside"));

const c = new Checks("Security tests");
const until = async (fn, ms = 6000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const v = await fn();
      if (v) return v;
    } catch {}
    await sleep(150);
  }
  throw new Error("timeout");
};
const read = (rel) => readFileSync(join(VAULT, rel), "utf8");
const walk = (dir) => readdirSync(dir, { withFileTypes: true, recursive: true }).filter((e) => e.isFile()).map((e) => join(e.parentPath ?? e.path, e.name));

seedVault(VAULT, TZ);
const tg = await startMockTelegram({ port: TG_PORT, token: BOT_TOKEN });
const env = {
  VAULT_PATH: VAULT,
  DATABASE_PATH: join(RUN, "data/app.db"),
  TIMEZONE: TZ,
  API_TOKEN,
  TELEGRAM_BOT_TOKEN: BOT_TOKEN,
  TELEGRAM_ALLOWED_USER_IDS: String(ME),
  TELEGRAM_API_ROOT: tg.url,
  NAG_ENABLED: "false",
  REINDEX_INTERVAL_MINUTES: "0",
  DIGEST_TIME: "",
  NODE_ENV: "production",
  TRUST_PROXY: "true", // clients identified by CF-Connecting-IP, as behind Cloudflare Tunnel
  // HOST deliberately unset: we test the default bind address.
};
const srv = await startServer({ env, port: PORT, logFile: join(RUN, "server.log") });
const randomIp = () => `198.51.100.${Math.floor(Math.random() * 250) + 1}`;
const anon = client(srv.base, undefined, () => ({ "cf-connecting-ip": randomIp() }));
const api = client(srv.base, API_TOKEN, { "cf-connecting-ip": "10.0.0.1" });
const all = async () => (await api.get("/api/tasks?limit=2000")).json;
const anyTask = (await all())[0];

// ---------------------------------------------------------------- auth
c.group("Authentication & access control");
const routes = [
  ["GET", "/api/today"], ["GET", "/api/tasks"], ["GET", `/api/tasks/${anyTask.id}`], ["GET", "/api/notes"],
  ["GET", `/api/notes/${anyTask.noteId}`], ["GET", "/api/projects"], ["GET", "/api/graph"],
  ["POST", "/api/tasks"], ["PATCH", `/api/tasks/${anyTask.id}`], ["POST", `/api/tasks/${anyTask.id}/actions/done`],
  ["POST", `/api/tasks/${anyTask.id}/remarks`], ["POST", "/api/vault/reindex"],
];
await c.run("[High] every /api route rejects missing, wrong, lowercase-scheme and query-string tokens", async () => {
  for (const [m, p] of routes) {
    const body = m === "GET" ? undefined : { text: "x", status: "done" };
    for (const h of [{}, { authorization: "Bearer wrong" }, { authorization: `bearer ${API_TOKEN}x` }, { authorization: API_TOKEN }]) {
      const r = await anon.raw(m, p, body, h);
      eq(r.status, 401, `${m} ${p} ${JSON.stringify(h)}`);
    }
    eq((await anon.raw(m, `${p}?token=${API_TOKEN}`, body)).status, 401, `${m} ${p} ?token`);
  }
  eq((await all()).find((t) => t.id === anyTask.id).status, anyTask.status, "state changed by rejected request");
  return `${routes.length} routes × 5 variants`;
});
await c.run("[Low] /health is public but reveals nothing sensitive (version only to local callers)", async () => {
  for (const h of [{ "cf-connecting-ip": "203.0.113.9" }, { "x-forwarded-for": "203.0.113.9" }]) {
    const r = await client(srv.base, undefined, h).get("/health");
    eq(Object.keys(r.json).sort(), ["ok", "telegram", "time"], JSON.stringify(h));
  }
  const local = await client(srv.base).get("/health");
  eq(Object.keys(local.json).sort(), ["ok", "sha", "telegram", "time", "version"], "local caller");
  return "tunnel/proxy callers: ok, time, telegram · local: + version, sha";
});
// ---------------------------------------------------------------- filesystem
c.group("Filesystem safety (vault boundary)");
await c.run("[High] notePath traversal / absolute / hidden-dir targets are refused with 400", async () => {
  const bad = ["../escape.md", "../../etc/passwd.md", "/tmp/abs.md", "C:\\\\Windows\\\\x.md", "daily/../../x.md", "..\\\\win.md", ".obsidian/plugin.md", ".git/hooks.md", "a\u0000b.md", "%2e%2e/enc.md"];
  const results = [];
  for (const notePath of bad) {
    const r = await api.post("/api/tasks", { text: "pwn", notePath });
    results.push(`${notePath}→${r.status}`);
    assert(r.status === 400, `${notePath} → ${r.status} ${r.text.slice(0, 80)}`);
  }
  const escaped = walk(RUN).filter((f) => !f.startsWith(VAULT) && /escape|passwd|abs|x\.md|win|enc/.test(f) && !f.includes("/data/") && !f.endsWith(".log"));
  eq(escaped, [], "files written outside vault");
  assert(!existsSync(join(VAULT, ".obsidian/plugin.md")), ".obsidian written");
});
await c.run("[High] a symlink inside the vault can't be used to write outside it", async () => {
  symlinkSync(OUTSIDE, join(VAULT, "linked"), "dir");
  const r = await api.post("/api/tasks", { text: "via symlink", notePath: "linked/owned.md" });
  assert(!existsSync(join(OUTSIDE, "owned.md")), `wrote through symlink (status ${r.status})`);
  eq(r.status, 400);
});
await c.run("[High] Telegram attachment paths from the API can't escape attachments/", async () => {
  tg.addFile("evil1", "../../../../outside/evil.sh");
  tg.addFile("evil2", "documents/evil.sh%2F..%2F..%2F..%2F..%2Foutside%2Fevil2");
  const before = new Set(walk(RUN));
  tg.inject(mediaUpdate(tg, ME, "document", "evil1"));
  tg.inject(mediaUpdate(tg, ME, "photo", "evil2"));
  await sleep(2500);
  const created = walk(RUN).filter((f) => !before.has(f) && !f.endsWith(".log") && !f.includes("/data/"));
  for (const f of created) {
    if (f.includes("/vault/daily/")) continue;
    assert(f.startsWith(join(VAULT, "attachments")), `outside attachments: ${f}`);
    assert(/^[\w-]+\.[a-z0-9]{1,8}$/.test(f.split("/").pop()), `unsafe file name: ${f}`);
  }
  assert(!existsSync(join(OUTSIDE, "evil.sh")) && !existsSync(join(OUTSIDE, "evil2")), "escaped");
  return created.map((f) => f.slice(VAULT.length + 1)).join(", ") || "nothing saved";
});

// ---------------------------------------------------------------- injection
c.group("Injection");
await c.run("[High] newlines in task text can't inject extra markdown lines/tasks", async () => {
  const before = (await all()).length;
  const r = await api.post("/api/tasks", { text: "Harmless\n- [x] INJECTED done task\n---\nproject: pwn", notePath: "inbox/inject.md" });
  const file = read("inbox/inject.md");
  assert(!/^- \[x\] INJECTED/m.test(file), "injected task line written");
  assert(!/^project: pwn/m.test(file), "frontmatter-ish line written");
  eq((await all()).length, before + 1, "task count");
  const p = await api.patch(`/api/tasks/${r.json.id}`, { title: "Renamed\n- [ ] INJECTED2" });
  assert(!/^- \[ \] INJECTED2/m.test(read("inbox/inject.md")), `PATCH title injected (status ${p.status})`);
});
await c.run("[High] a spoofed ^anchor in user text can't hijack an existing task", async () => {
  const victim = (await all()).find((t) => t.title === "Replace core switch");
  const r = await api.post("/api/tasks", { text: `Hijack attempt ^${victim.anchor}` });
  assert(r.status === 201, r.text);
  assert(r.json.anchor !== victim.anchor, "reused victim anchor");
  const v2 = (await api.get(`/api/tasks/${victim.id}`)).json;
  eq([v2.title, v2.noteId], [victim.title, victim.noteId], "victim modified");
});
await c.run("[Med] /note title can't inject YAML frontmatter keys", async () => {
  tg.inject(textUpdate(tg, ME, '/note Evil" \nproject: pwned\nbody'));
  tg.inject(textUpdate(tg, ME, "/note Sneaky: title\nproject: pwned2\n---\nmore"));
  await until(() => existsSync(join(VAULT, "inbox/evil.md")) && existsSync(join(VAULT, "inbox/sneaky-title.md")));
  await sleep(500);
  const notes = (await api.get("/api/notes")).json;
  for (const path of ["inbox/evil.md", "inbox/sneaky-title.md"]) {
    const n = (await api.get(`/api/notes/${notes.find((x) => x.path === path).id}`)).json;
    assert(!("project" in n.frontmatter), `${path} frontmatter: ${JSON.stringify(n.frontmatter)}`);
  }
  assert(!(await api.get("/api/projects")).json.some((p) => p.slug.startsWith("pwned")), "project created");
});
await c.run("[Med] HTML in task titles is escaped in Telegram messages", async () => {
  const since = tg.mark();
  tg.inject(textUpdate(tg, ME, `/todo <b>x</b><a href="tg://resolve?domain=evil">click</a> & co`));
  const m = await tg.waitFor("sendMessage", (x) => Number(x.payload.chat_id) === ME, 8000, since);
  assert(m.payload.text.includes("&lt;b&gt;x&lt;/b&gt;&lt;a href=") && m.payload.text.includes("&amp; co"), m.payload.text);
  assert(!m.payload.text.includes('<a href="tg://'), "raw anchor tag");
});
await c.run("[High] SQL injection attempts in filters/search return nothing extra", async () => {
  const total = (await all()).length;
  for (const q of ["project=x'%20OR%20'1'='1", "tag=%27%20OR%201%3D1%20--", "dueBefore=2026-01-01'%20OR%201=1--", "project=%25"]) {
    const r = await api.get(`/api/tasks?${q}`);
    assert(r.status === 400 || (Array.isArray(r.json) && r.json.length < total), `${q} → ${r.status} ${r.json?.length}`);
  }
  eq((await api.get("/api/tasks?status=ready'--")).status, 400);
  const since = tg.mark();
  tg.inject(textUpdate(tg, ME, "/search %%"));
  const m = await tg.waitFor("sendMessage", (x) => Number(x.payload.chat_id) === ME, 8000, since);
  assert(!m.payload.text.startsWith("🔎"), `wildcard search matched everything: ${m.payload.text.slice(0, 60)}`);
});
await c.run("[Med] prototype pollution payloads are rejected", async () => {
  const r = await api.raw("POST", "/api/tasks", '{"text":"x","__proto__":{"polluted":true}}');
  eq(r.status, 400);
  const r2 = await api.raw("POST", "/api/tasks", '{"text":"x","constructor":{"prototype":{"polluted":true}}}');
  assert(r2.status === 400 || r2.status === 201, String(r2.status));
});

// ---------------------------------------------------------------- DoS-ish
c.group("Resource limits & ReDoS");
await c.run("[Med] oversized bodies are rejected (413)", async () => {
  let status;
  try {
    status = (await api.raw("POST", "/api/tasks", JSON.stringify({ text: "x".repeat(2_000_000) }))).status;
  } catch {
    status = "connection closed by server";
  }
  assert(status === 413 || status === "connection closed by server", `got ${status}`);
  eq((await anon.get("/health")).status, 200, "server unhealthy after big body");
  eq((await api.post("/api/tasks", { text: "x".repeat(2001) })).status, 400);
});
await c.run("[Med] adversarial task text parses in linear time (API + vault file)", async () => {
  const payloads = [
    "a 🔁 every" + " x,".repeat(600),
    "#".repeat(1990),
    "!p1 ".repeat(490),
    "📅 2026-11-11 ".repeat(140),
    "🔁 every" + " monday".repeat(280) + " #",
  ];
  let worst = 0;
  for (const text of payloads) {
    const t0 = Date.now();
    const r = await api.post("/api/tasks", { text: text.slice(0, 2000), notePath: "inbox/redos.md" });
    worst = Math.max(worst, Date.now() - t0);
    assert(r.status < 500, `status ${r.status}`);
  }
  const big = "- [ ] " + "🔁 every" + " a,".repeat(150_000) + "\n" + "- [ ] " + "#a ".repeat(100_000) + "\n";
  writeFileSync(join(VAULT, "inbox/huge.md"), big);
  const t0 = Date.now();
  const r = await api.post("/api/vault/reindex");
  const ms = Date.now() - t0;
  assert(r.status === 200 && ms < 5000, `reindex of ${(big.length / 1e6).toFixed(1)} MB took ${ms} ms`);
  return `API worst ${worst} ms, ${(big.length / 1e6).toFixed(1)} MB line indexed in ${ms} ms`;
});

// ---------------------------------------------------------------- HTTP hardening
c.group("HTTP hardening");
await c.run("[Med] CORS does not reflect arbitrary origins", async () => {
  const r = await api.get("/api/today", { origin: "https://evil.example" });
  const acao = r.headers.get("access-control-allow-origin");
  assert(!acao || (acao !== "*" && acao !== "https://evil.example"), `ACAO: ${acao}`);
  const pre = await anon.raw("OPTIONS", "/api/today", undefined, { origin: "https://evil.example", "access-control-request-method": "PATCH" });
  assert(pre.headers.get("access-control-allow-origin") !== "https://evil.example", "preflight allowed");
});
await c.run("[Low] security headers set (nosniff, frame-deny, no-referrer, no-store)", async () => {
  const r = await api.get("/api/today");
  eq(r.headers.get("x-content-type-options"), "nosniff");
  eq(r.headers.get("x-frame-options"), "DENY");
  assert(r.headers.get("referrer-policy"), "referrer-policy");
  assert(/no-store/.test(r.headers.get("cache-control") ?? ""), "cache-control");
});
await c.run("[Low] errors don't leak stack traces or filesystem paths", async () => {
  const bodies = [await api.raw("POST", "/api/tasks", "{not json"), await api.get("/api/notes/does-not-exist"), await api.get("/nope")];
  for (const r of bodies) assert(!/\bat \w+ \(|\/sessions\/|node_modules|[A-Z]:\\\\/.test(r.text), r.text.slice(0, 200));
});
await c.run("[High] default bind address is loopback (not 0.0.0.0)", async () => {
  const m = srv.log.join("").match(/bound to ([^"\s:]+(?::[^"\s:]+)*):\d+/);
  assert(m && /^(127\.0\.0\.1|::1|localhost)$/.test(m[1]), `bound to ${m?.[1] ?? "unknown (0.0.0.0 default)"}`);
});

// ---------------------------------------------------------------- Telegram
c.group("Telegram");
await c.run("[High] strangers can't act via callbacks, media, or text", async () => {
  const target = (await all()).find((t) => t.title === "Renew TLS certs");
  tg.inject(callbackUpdate(tg, STRANGER, `t:done:${target.id}`));
  tg.inject(callbackUpdate(tg, STRANGER, `td:${target.id}`));
  tg.addFile("strangerphoto", "photos/stranger.jpg");
  tg.inject(mediaUpdate(tg, STRANGER, "photo", "strangerphoto"));
  tg.inject(textUpdate(tg, STRANGER, "+ stranger task"));
  await sleep(1500);
  eq((await api.get(`/api/tasks/${target.id}`)).json.status, target.status, "task changed");
  assert(!(await all()).some((t) => t.title === "stranger task"), "task created");
  const att = join(VAULT, "attachments");
  assert(!existsSync(att) || !walk(att).some((f) => f.includes("stranger")), "media saved");
  assert(!tg.calls.some((x) => x.method === "getFile" && x.payload.file_id === "strangerphoto"), "stranger file downloaded");
});
await c.run("[Low] strangers in group chats get no reply (no spam / info leak)", async () => {
  const since = tg.mark();
  tg.inject({ message: { message_id: tg.nextMessageId(), date: 0, chat: { id: -100123, type: "supergroup", title: "G" }, from: { id: 31337, is_bot: false, first_name: "G" }, text: "/today", entities: [{ type: "bot_command", offset: 0, length: 6 }] } });
  await sleep(1200);
  assert(!tg.calls.slice(since).some((x) => x.method === "sendMessage" && Number(x.payload.chat_id) === -100123), "replied in group");
});
await c.run("[Med] tampered callback data is handled safely", async () => {
  const target = (await all()).find((t) => t.title === "Renew TLS certs");
  for (const data of [`t:p99:${target.id}`, "t:done:../../etc/passwd", "t:done:' OR 1=1 --", `t:done:${"x".repeat(60)}`]) {
    const since = tg.mark();
    tg.inject(callbackUpdate(tg, ME, data));
    await tg.waitFor("answerCallbackQuery", () => true, 8000, since);
  }
  eq((await api.get(`/api/tasks/${target.id}`)).json.status, target.status);
  eq((await anon.get("/health")).status, 200);
});
await c.run("[Low] oversized Telegram files are refused before download", async () => {
  const since = tg.mark();
  const u = mediaUpdate(tg, ME, "document", "big");
  u.message.document.file_size = 50 * 1024 * 1024;
  tg.inject(u);
  const m = await tg.waitFor("sendMessage", (x) => Number(x.payload.chat_id) === ME, 8000, since);
  assert(m.payload.text.includes("20 MB"), m.payload.text);
  assert(!tg.calls.slice(since).some((x) => x.method === "getFile"), "getFile was called");
});

c.group("Brute force");
await c.run("[Med] brute-forcing the API token gets throttled (429), incl. a correct guess while locked", async () => {
  const attacker = client(srv.base, undefined, { "cf-connecting-ip": "203.0.113.7" });
  let first429 = 0;
  for (let i = 1; i <= 40; i++) {
    if ((await attacker.get("/api/today", { authorization: `Bearer guess${i}` })).status === 429) {
      first429 = i;
      break;
    }
  }
  assert(first429 > 0 && first429 <= 11, `throttled after ${first429 || ">40"} attempts`);
  eq((await attacker.get("/api/today", { authorization: `Bearer ${API_TOKEN}` })).status, 429, "a correct token while locked must not be an oracle");
  eq((await api.get("/api/today")).status, 200, "other clients must not be locked out");
  return `locked after ${first429 - 1} failures; other IPs unaffected`;
});

// ---------------------------------------------------------------- secrets & deps
c.group("Secrets & dependencies");
await srv.stop();
await c.run("[High] bot token and API token never appear in logs", async () => {
  const log = readFileSync(join(RUN, "server.log"), "utf8");
  assert(!log.includes(BOT_TOKEN) && !log.includes(BOT_TOKEN.split(":")[1]), "bot token in log");
  assert(!log.includes(API_TOKEN), "API token in log");
});
await c.run("[Med] webhook mode without an explicit secret still generates a random one", async () => {
  const s2 = await startServer({ env: { ...env, DATABASE_PATH: join(RUN, "data/hook.db"), TELEGRAM_WEBHOOK_URL: "http://127.0.0.1:3942/telegram/webhook" }, port: 3942, logFile: join(RUN, "server-hook.log") });
  const set = [...tg.calls].reverse().find((x) => x.method === "setWebhook");
  assert(set && set.payload.secret_token && set.payload.secret_token.length >= 32, JSON.stringify(set?.payload));
  eq((await client(s2.base).post("/telegram/webhook", { update_id: 1 })).status, 401);
  await s2.stop();
});
await c.run("[Med] npm audit (production deps): no known vulnerabilities", async () => {
  let out;
  try {
    out = execSync("npm audit --omit=dev --json", { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch (e) {
    out = e.stdout;
  }
  const v = JSON.parse(out).metadata?.vulnerabilities ?? {};
  const total = Object.values(v).reduce((a, b) => a + b, 0);
  eq(total, 0, `vulnerabilities ${JSON.stringify(v)}`);
});
await c.run("[Low] .env and runtime data are git-ignored", async () => {
  const gi = readFileSync(join(ROOT, ".gitignore"), "utf8");
  for (const p of [".env", "data/", "redis-data/", "tests/.run/"]) assert(gi.includes(p.replace(/\/$/, "")), p);
});

await tg.close();
process.exitCode = c.summary(join(RUN, "security-results.json")) ? 1 : 0;
