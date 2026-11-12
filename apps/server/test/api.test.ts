import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { signInitData, signSession, validateInitData, verifySession } from "../src/auth.js";
import { loadConfig } from "../src/config.js";
import { createContext } from "../src/context.js";
import { buildHttp } from "../src/http.js";

const BOT = "4242:UNIT-TEST-BOT";
const ME = 111;
const API_TOKEN = "unit-test-api-token-0123456789";

function localDate(offset = 0) {
  const d = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(new Date());
  const [y, m, dd] = d.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, dd + offset)).toISOString().slice(0, 10);
}

async function setup(extra: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "omnicore-api-"));
  const vault = join(dir, "vault");
  mkdirSync(join(vault, "projects"), { recursive: true });
  writeFileSync(
    join(vault, "projects/homelab.md"),
    `---\nproject: Homelab\n---\n# Homelab\nSee [[Network Map]].\n\n- [ ] Replace core switch !p1 📅 ${localDate(0)} 00:01\n  - [x] Compare vendors\n  - [ ] Order SFPs\n- [!] Migrate VLANs 📅 ${localDate(0)} 00:01\n- [ ] Renew certs 📅 ${localDate(3)}\n- [ ] Someday idea\n`,
  );
  writeFileSync(join(vault, "Network Map.md"), "# Network Map\nBack to [[homelab]]\n");
  const webDist = join(dir, "web");
  mkdirSync(join(webDist, "assets"), { recursive: true });
  writeFileSync(join(webDist, "index.html"), "<!doctype html><title>OmniCore</title><div id=root></div>");
  writeFileSync(join(webDist, "assets/app-abc123.js"), "console.log(1)");
  const config = loadConfig({
    VAULT_PATH: vault,
    DATABASE_PATH: join(dir, "app.db"),
    TIMEZONE: "Asia/Riyadh",
    API_TOKEN,
    TELEGRAM_BOT_TOKEN: BOT,
    TELEGRAM_ALLOWED_USER_IDS: String(ME),
    NAG_QUIET_HOURS: "",
    WEB_DIST: webDist,
    ...extra,
  });
  const ctx = createContext(config);
  await ctx.indexer.fullScan();
  const app = await buildHttp(ctx, { logger: false });
  return { app, ctx, config, vault };
}

let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => {
  await cleanup?.();
  cleanup = undefined;
});
const bearer = { authorization: `Bearer ${API_TOKEN}` };

describe("Telegram initData validation", () => {
  it("accepts a correctly signed, fresh initData", () => {
    expect(validateInitData(signInitData(BOT, { id: ME, first_name: "S" }), BOT)).toMatchObject({ id: ME });
  });
  it("rejects tampering, wrong bot token, stale auth_date, junk", () => {
    const good = signInitData(BOT, { id: ME });
    const tampered = good.replace(encodeURIComponent(`"id":${ME}`), encodeURIComponent(`"id":999`));
    expect(validateInitData(tampered, BOT)).toBeNull();
    expect(validateInitData(good, "4242:OTHER")).toBeNull();
    expect(validateInitData(signInitData(BOT, { id: ME }, Math.floor(Date.now() / 1000) - 2 * 86400), BOT)).toBeNull();
    expect(validateInitData("hash=zz&user=%7B%7D", BOT)).toBeNull();
    expect(validateInitData("", BOT)).toBeNull();
  });
});

describe("sessions", () => {
  it("signed cookies verify; tampered, expired or foreign ones do not", async () => {
    const { config } = await setup();
    const s = signSession(config, { k: "web", exp: Math.floor(Date.now() / 1000) + 60 });
    expect(verifySession(config, s)).toMatchObject({ k: "web" });
    expect(verifySession(config, s.slice(0, -2) + "xx")).toBeNull();
    expect(verifySession(config, signSession(config, { k: "web", exp: 1 }))).toBeNull();
    const other = loadConfig({ ...process.env, API_TOKEN: "different", TELEGRAM_BOT_TOKEN: BOT });
    expect(verifySession(other, s)).toBeNull();
    // A Mini App session for a user who was removed from the allow-list stops working
    expect(verifySession(config, signSession(config, { k: "tg", u: 555, exp: Math.floor(Date.now() / 1000) + 60 }))).toBeNull();
  });

  it("token login sets an HttpOnly cookie that unlocks the API; writes need the CSRF header", async () => {
    const { app } = await setup();
    cleanup = () => app.close();
    expect((await app.inject({ url: "/api/today/board" })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/api/session", payload: { token: "nope" } })).statusCode).toBe(401);
    const login = await app.inject({ method: "POST", url: "/api/session", payload: { token: API_TOKEN } });
    expect(login.statusCode).toBe(200);
    const setCookie = String(login.headers["set-cookie"]);
    expect(setCookie).toMatch(/^oc_session=[\w-]+\.[\w-]+; Path=\/; HttpOnly; SameSite=Strict; Max-Age=\d+$/);
    const cookie = setCookie.split(";")[0]!;
    expect((await app.inject({ url: "/api/me", headers: { cookie } })).json()).toMatchObject({ authenticated: true, mode: "web" });
    expect((await app.inject({ url: "/api/today/board", headers: { cookie } })).statusCode).toBe(200);
    const noCsrf = await app.inject({ method: "POST", url: "/api/log", headers: { cookie }, payload: { text: "x" } });
    expect(noCsrf.statusCode).toBe(403);
    const ok = await app.inject({ method: "POST", url: "/api/log", headers: { cookie, "x-omnicore": "1" }, payload: { text: "x" } });
    expect(ok.statusCode).toBe(200);
    const out = await app.inject({ method: "POST", url: "/api/logout" });
    expect(String(out.headers["set-cookie"])).toContain("Max-Age=0");
  });

  it("Mini App login: valid initData from an allow-listed user only", async () => {
    const { app } = await setup();
    cleanup = () => app.close();
    const stranger = await app.inject({ method: "POST", url: "/api/session/telegram", payload: { initData: signInitData(BOT, { id: 999 }) } });
    expect(stranger.statusCode).toBe(401);
    const forged = await app.inject({ method: "POST", url: "/api/session/telegram", payload: { initData: signInitData("4242:FAKE", { id: ME }) } });
    expect(forged.statusCode).toBe(401);
    const ok = await app.inject({ method: "POST", url: "/api/session/telegram", payload: { initData: signInitData(BOT, { id: ME, first_name: "Sabbir" }) } });
    expect(ok.json()).toMatchObject({ ok: true, mode: "tg", user: { id: ME, firstName: "Sabbir" } });
    const cookie = String(ok.headers["set-cookie"]).split(";")[0]!;
    expect((await app.inject({ url: "/api/today/board", headers: { cookie } })).statusCode).toBe(200);
  });
});

describe("UI endpoints", () => {
  it("today board: attention (overdue/blocked) with nag info, sub-task counts, project names", async () => {
    const { app } = await setup();
    cleanup = () => app.close();
    const b = (await app.inject({ url: "/api/today/board", headers: bearer })).json();
    expect(b.date).toBe(localDate(0));
    const titles = b.attention.map((t: { title: string }) => t.title);
    expect(titles).toEqual(["Replace core switch", "Migrate VLANs"]);
    const core = b.attention[0];
    expect(core).toMatchObject({ projectTitle: "Homelab", notePath: "projects/homelab.md", sub: { done: 1, total: 2 } });
    expect(core.nag).toMatchObject({ state: "partial", sent: 0, intervalMin: 30 });
    expect(b.attention[1].nag.state).toBe("remark");
  });

  it("detail, upcoming, inbox, board, projects, search, parse", async () => {
    const { app } = await setup();
    cleanup = () => app.close();
    const get = async (url: string) => (await app.inject({ url, headers: bearer })).json();
    const core = (await get("/api/today/board")).attention[0];
    const d = await get(`/api/tasks/${core.id}/detail`);
    expect(d.children.map((c: { title: string }) => c.title)).toEqual(["Compare vendors", "Order SFPs"]);
    expect(d.sourceLine).toBe(7);
    expect((await get("/api/upcoming?days=7"))[0]).toMatchObject({ date: localDate(3), tasks: [{ title: "Renew certs" }] });
    expect((await get("/api/inbox")).tasks.map((t: { title: string }) => t.title)).toEqual(["Someday idea"]);
    const board = await get("/api/board");
    expect(board.blocked.map((t: { title: string }) => t.title)).toEqual(["Migrate VLANs"]);
    expect(board.ready.some((t: { title: string }) => t.title === "Order SFPs")).toBe(false); // subtasks stay inside their parent
    expect((await get("/api/projects"))[0]).toMatchObject({ slug: "homelab", total: 6, done: 1, blocked: 1, percent: 17 });
    const s = await get("/api/search?q=vlan");
    expect(s.tasks[0].title).toBe("Migrate VLANs");
    const p = (await app.inject({ method: "POST", url: "/api/parse", headers: bearer, payload: { text: "Order PSU !p2 @tomorrow 10:00 #project/homelab #shop" } })).json();
    expect(p).toMatchObject({ title: "Order PSU", priority: 2, dueDate: localDate(1), dueTime: "10:00", project: "homelab", tags: ["shop"] });
  });

  it("notes: detail with backlinks; edits are checksum-guarded; create note", async () => {
    const { app, vault } = await setup();
    cleanup = () => app.close();
    const list = (await app.inject({ url: "/api/notes", headers: bearer })).json();
    const map = list.find((n: { path: string }) => n.path === "Network Map.md");
    const homelab = list.find((n: { path: string }) => n.path === "projects/homelab.md");
    const d = (await app.inject({ url: `/api/notes/${map.id}`, headers: bearer })).json();
    expect(d.backlinks.map((b: { path: string }) => b.path)).toEqual(["projects/homelab.md"]);
    const h = (await app.inject({ url: `/api/notes/${homelab.id}`, headers: bearer })).json();
    expect(h.tasks).toHaveLength(6);

    const edited = d.content + "- [ ] Label the patch panel\n";
    const put = await app.inject({ method: "PUT", url: `/api/notes/${map.id}`, headers: bearer, payload: { content: edited, checksum: d.checksum } });
    expect(put.statusCode).toBe(200);
    expect(put.json().tasks.map((t: { title: string }) => t.title)).toEqual(["Label the patch panel"]);
    expect(readFileSync(join(vault, "Network Map.md"), "utf8")).toMatch(/- \[ \] Label the patch panel \^oc-/);
    // Stale checksum → 409, file untouched
    const stale = await app.inject({ method: "PUT", url: `/api/notes/${map.id}`, headers: bearer, payload: { content: "overwrite", checksum: d.checksum } });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error).toBe("note_conflict");
    expect(readFileSync(join(vault, "Network Map.md"), "utf8")).toContain("Label the patch panel");

    const created = await app.inject({ method: "POST", url: "/api/notes", headers: bearer, payload: { title: "Rack Plan", content: "- [ ] Buy rails" } });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ path: "inbox/rack-plan.md", tasks: [{ title: "Buy rails" }] });
  });
});

describe("web app serving", () => {
  it("serves the SPA with an app CSP, deep links fall back to index.html, API keeps strict headers", async () => {
    const { app } = await setup();
    cleanup = () => app.close();
    for (const url of ["/", "/today", "/tg", "/tg/task/abc", "/notes/x"]) {
      const r = await app.inject({ url });
      expect(r.statusCode, url).toBe(200);
      expect(r.headers["content-type"]).toContain("text/html");
      expect(r.headers["content-security-policy"]).toContain("frame-ancestors 'self' https://web.telegram.org");
      expect(r.headers["x-frame-options"]).toBeUndefined();
    }
    // Revalidations (304, no content-type) must keep the page CSP, or reloads render a blank app.
    const first = await app.inject({ url: "/" });
    const reval = await app.inject({ url: "/", headers: { "if-modified-since": String(first.headers["last-modified"]) } });
    expect(reval.statusCode).toBe(304);
    expect(reval.headers["content-security-policy"]).toContain("script-src 'self'");
    const asset = await app.inject({ url: "/assets/app-abc123.js" });
    expect(asset.headers["cache-control"]).toContain("immutable");
    expect((await app.inject({ url: "/assets/missing.js" })).statusCode).toBe(404);
    expect((await app.inject({ url: "/api/nope", headers: bearer })).statusCode).toBe(404);
    const api = await app.inject({ url: "/api/me" });
    expect(api.headers["x-frame-options"]).toBe("DENY");
    expect(api.headers["content-security-policy"]).toBe("default-src 'none'; frame-ancestors 'none'");
  });
});
