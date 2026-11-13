import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { createContext } from "../src/context.js";
import { buildHttp } from "../src/http.js";
import { validate, withStoredSettings } from "../src/settings.js";

function app(extraEnv: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "oc-set-"));
  const env = { DATABASE_PATH: join(dir, "app.db"), VAULT_PATH: join(dir, "vault"), TIMEZONE: "Asia/Riyadh", AI_PROVIDER: "none", ...extraEnv };
  Object.assign(process.env, env);
  const ctx = createContext(loadConfig(env));
  return { ctx, env, dir };
}

describe("settings", () => {
  it("validates in plain words", () => {
    expect(validate("defaultTime", "9:00".padStart(5, "0"))).toBe("09:00");
    expect(() => validate("defaultTime", "25:00")).toThrow("Remind me at: use a time like 09:00");
    expect(validate("quietHours", "")).toBe("");
    expect(validate("weekend", "Sat, fri")).toBe("fri,sat");
    expect(() => validate("timezone", "Mars/Base")).toThrow(/isn't a time zone/);
    expect(() => validate("everyOverdue", "1")).toThrow(/between 5 and 1440/);
  });

  it("saves through the API, survives a restart and overrides .env", async () => {
    const { ctx, env } = app({ NAG_DEFAULT_DUE_TIME: "10:00" });
    const http = await buildHttp(ctx);
    const get = async () => (await http.inject({ method: "GET", url: "/api/settings" })).json();
    const item = (g: any, key: string) => g.groups.flatMap((x: any) => x.items).find((i: any) => i.key === key);

    expect(item(await get(), "defaultTime")).toMatchObject({ value: "10:00", source: "env", restart: true, pending: false });
    const r = await http.inject({ method: "PUT", url: "/api/settings", payload: { values: { defaultTime: "07:30", everyOverdue: "15", theme: "dark", name: "Sabbir" } } });
    expect(r.statusCode).toBe(200);
    expect(r.json().restart.sort()).toEqual(["defaultTime", "everyOverdue"]);
    expect(item(await get(), "defaultTime")).toMatchObject({ value: "07:30", source: "app", pending: true });
    expect((await http.inject({ method: "GET", url: "/api/prefs" })).json()).toMatchObject({ theme: "dark", name: "Sabbir" });

    const bad = await http.inject({ method: "PUT", url: "/api/settings", payload: { values: { quietHours: "late" } } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().message).toMatch(/^Quiet hours:/);
    await http.close();

    // "restart": the next start reads them before the config
    const cfg = loadConfig(await withStoredSettings(env));
    expect(cfg.NAG_DEFAULT_DUE_TIME).toBe("07:30");
    expect(cfg.NAG_INTERVALS).toEqual({ overdue: 15, partial: 60, remark: 120 });

    // reset → back to .env
    ctx.settings.set({ defaultTime: null });
    expect(loadConfig(await withStoredSettings(env)).NAG_DEFAULT_DUE_TIME).toBe("10:00");
  });

  it("pause stops reminders until a time; backup now writes a snapshot", async () => {
    const { ctx } = app();
    const http = await buildHttp(ctx);
    const p = (await http.inject({ method: "POST", url: "/api/reminders/pause", payload: { minutes: 60 } })).json();
    expect(Date.parse(p.pausedUntil) - Date.now()).toBeGreaterThan(59 * 60_000);
    expect((await http.inject({ method: "POST", url: "/api/reminders/pause", payload: { minutes: 0 } })).json().pausedUntil).toBeNull();
    const b = (await http.inject({ method: "POST", url: "/api/backup" })).json();
    expect(b.name).toMatch(/^app-.*-manual\.db$/);
    const sys = (await http.inject({ method: "GET", url: "/api/system" })).json();
    expect(sys.backups[0].name).toBe(b.name);
    expect(sys.version.version).toBeTruthy();
    await http.close();
  });
});
