import { execFileSync, spawnSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { createContext } from "../src/context.js";
import { buildHttp, isPrivateAddress } from "../src/http.js";
import { checkForUpdate, newerThan, updateInfo, VERSION } from "../src/version.js";

const ROOT = resolve(import.meta.dirname, "../../..");

describe("version", () => {
  it("compares versions", () => {
    expect(newerThan("0.6.0", "0.5.0")).toBe(true);
    expect(newerThan("v0.5.10", "0.5.9")).toBe(true);
    expect(newerThan("0.5.0", "0.5.0")).toBe(false);
    expect(newerThan("0.4.9", "0.5.0")).toBe(false);
    expect(newerThan("1.0.0-rc.1", "0.9.9")).toBe(true);
  });

  it("knows its own version", () => {
    expect(VERSION.version).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe("isPrivateAddress", () => {
  it.each([["127.0.0.1", true], ["::ffff:172.18.0.1", true], ["10.1.2.3", true], ["192.168.1.9", true], ["100.100.1.1", true], ["::1", true], ["fd00::5", true],
    ["203.0.113.9", false], ["172.32.0.1", false], ["8.8.8.8", false], ["2001:db8::1", false]])("%s → %s", (ip, want) => expect(isPrivateAddress(ip)).toBe(want));
});

describe("GitHub update check", () => {
  let server: Server;
  let base = "";
  let mode: "release" | "tags" | "down" = "release";
  beforeAll(async () => {
    server = createServer((req, res) => {
      const send = (code: number, body: unknown) => {
        res.writeHead(code, { "content-type": "application/json" });
        res.end(JSON.stringify(body));
      };
      if (mode === "down") return send(500, { message: "boom" });
      if (req.url === "/repos/me/omnicore/releases/latest") {
        return mode === "release"
          ? send(200, { tag_name: "v9.1.0", html_url: "https://github.com/me/omnicore/releases/tag/v9.1.0", published_at: "2026-11-01T00:00:00Z", body: "notes" })
          : send(404, { message: "Not Found" });
      }
      if (req.url?.startsWith("/repos/me/omnicore/tags")) return send(200, [{ name: "v9.0.1" }, { name: "v9.2.0" }, { name: "nightly" }]);
      send(404, {});
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it("reads the latest release", async () => {
    mode = "release";
    const r = await checkForUpdate("me/omnicore", base);
    expect(r).toMatchObject({ version: "9.1.0", url: "https://github.com/me/omnicore/releases/tag/v9.1.0" });
    expect(updateInfo().updateAvailable).toBe(true);
  });

  it("falls back to the newest semver tag when there are no releases", async () => {
    mode = "tags";
    expect((await checkForUpdate("me/omnicore", base))?.version).toBe("9.2.0");
  });

  it("never throws when GitHub is down", async () => {
    mode = "down";
    expect(await checkForUpdate("me/omnicore", base)).toBeNull();
    expect(updateInfo().checkError).toMatch(/500/);
  });

  it("/health shows the version; /api/version needs auth", async () => {
    const dir = mkdtempSync(join(tmpdir(), "omnicore-ops-"));
    const ctx = createContext(loadConfig({ VAULT_PATH: join(dir, "vault"), DATABASE_PATH: join(dir, "app.db"), API_TOKEN: "test-token-0123456789", AI_PROVIDER: "none" }));
    const app = await buildHttp(ctx, { logger: false });
    const h = (await app.inject({ url: "/health" })).json();
    expect(h).toMatchObject({ ok: true, version: VERSION.version });
    const viaTunnel = (await app.inject({ url: "/health", headers: { "cf-connecting-ip": "203.0.113.9" } })).json();
    expect(Object.keys(viaTunnel).sort()).toEqual(["ok", "telegram", "time"]);
    expect((await app.inject({ url: "/api/version" })).statusCode).toBe(401);
    const v = (await app.inject({ url: "/api/version", headers: { authorization: "Bearer test-token-0123456789" } })).json();
    expect(v).toMatchObject({ version: VERSION.version, updateCommand: "scripts/update.sh" });
    await app.close();
  });

  it("rejects a malformed UPDATE_CHECK_REPO", () => {
    const run = spawnSync(process.execPath, ["-e", "import('./apps/server/dist/config.js').then(m=>m.loadConfig({UPDATE_CHECK_REPO:'not a repo'}))"], { cwd: ROOT, encoding: "utf8" });
    expect(run.status).not.toBe(0);
    expect(run.stderr + run.stdout).toMatch(/owner\/repo/);
  });
});

describe("backup CLI", () => {
  const cli = join(ROOT, "apps/server/dist/backup.js");
  it("snapshots a live database, prunes, lists and restores", () => {
    const dir = mkdtempSync(join(tmpdir(), "omnicore-bk-"));
    const dbPath = join(dir, "app.db");
    const live = new DatabaseSync(dbPath);
    live.exec("PRAGMA journal_mode=WAL; CREATE TABLE t(x); INSERT INTO t VALUES (1), (2);");
    const env = { ...process.env, DATABASE_PATH: dbPath };
    const run = (...a: string[]) => execFileSync(process.execPath, [cli, ...a], { env, encoding: "utf8", cwd: dir }).trim().split("\n");

    const first = run("--label", "pre-update-abc1234").at(-1)!;
    expect(first).toMatch(/backups\/app-.*-pre-update-abc1234\.db$/);
    for (let i = 0; i < 3; i++) run("--keep", "2");
    expect(readdirSync(join(dir, "backups"))).toHaveLength(2);
    expect(run("--list")).toHaveLength(2);

    // the snapshot has the data even though the writes are still in the WAL
    const latest = run("--keep", "5").at(-1)!;
    const snap = new DatabaseSync(latest, { readOnly: true });
    expect((snap.prepare("SELECT count(*) n FROM t").get() as { n: number }).n).toBe(2);
    snap.close();

    live.exec("DELETE FROM t");
    live.close();
    expect(run("--restore", latest).join("")).toMatch(/restored/);
    expect(existsSync(`${dbPath}-wal`)).toBe(false); // stale WAL from the old file removed
    const back = new DatabaseSync(dbPath, { readOnly: true });
    expect((back.prepare("SELECT count(*) n FROM t").get() as { n: number }).n).toBe(2);
    back.close();
  });

  it("refuses to restore a corrupt file", () => {
    const dir = mkdtempSync(join(tmpdir(), "omnicore-bk2-"));
    const bad = join(dir, "bad.db");
    execFileSync("bash", ["-c", `printf 'SQLite format 3\\000garbage%.0s' {1..300} > ${bad}`]);
    const r = spawnSync(process.execPath, [cli, "--restore", bad], { env: { ...process.env, DATABASE_PATH: join(dir, "app.db") }, encoding: "utf8" });
    expect(r.status).not.toBe(0);
  });
});
