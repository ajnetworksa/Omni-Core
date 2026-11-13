import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { DB } from "@omnicore/core";

/**
 * Settings you can change in the app. Stored in the `settings` table; they override .env.
 * "live" ones apply at once; "restart" ones are read when the app starts (reminder timers,
 * time zone…), so the Settings page offers "Apply now", which restarts the app (Docker brings it
 * straight back). Every label and help text here is shown to the user as-is: keep it plain.
 */
export type SettingType = "text" | "time" | "optional-time" | "timezone" | "select" | "minutes" | "quiet-hours" | "weekdays";
export interface SettingDef {
  key: string;
  group: "profile" | "reminders" | "summaries" | "appearance";
  label: string;
  help: string;
  type: SettingType;
  options?: { value: string; label: string }[];
  /** The .env variable this overrides, if any. */
  env?: string;
  /** Read only at start-up. */
  restart?: boolean;
  default: string;
}

const WEEK = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
export const SETTINGS: SettingDef[] = [
  // Profile & time
  { key: "name", group: "profile", label: "Your name", help: "Used to greet you in Telegram and the app.", type: "text", default: "" },
  { key: "timezone", group: "profile", label: "Time zone", help: "Decides what “today” is, when reminders fire and when the day rolls over at midnight.", type: "timezone", env: "TIMEZONE", restart: true, default: "Asia/Riyadh" },
  { key: "weekStart", group: "profile", label: "Week starts on", help: "First day in the Upcoming view.", type: "select", options: [{ value: "sat", label: "Saturday" }, { value: "sun", label: "Sunday" }, { value: "mon", label: "Monday" }], default: "sun" },
  { key: "weekend", group: "profile", label: "Weekend days", help: "Skipped by tasks that repeat “every weekday”.", type: "weekdays", env: "WEEKEND_DAYS", restart: true, default: "fri,sat" },
  { key: "timeFormat", group: "profile", label: "Clock", help: "How times are shown.", type: "select", options: [{ value: "24h", label: "24-hour (18:00)" }, { value: "12h", label: "12-hour (6:00 pm)" }], default: "24h" },
  // Reminders
  { key: "defaultTime", group: "reminders", label: "Remind me at", help: "For tasks that have a date but no time: when the first reminder comes.", type: "time", env: "NAG_DEFAULT_DUE_TIME", restart: true, default: "09:00" },
  { key: "everyOverdue", group: "reminders", label: "Not started yet: remind every", help: "After a task's time has passed and you haven't touched it.", type: "minutes", restart: true, default: "30" },
  { key: "everyPartial", group: "reminders", label: "Partly done: remind every", help: "After you mark a task partly done (e.g. 50%) but not finished.", type: "minutes", restart: true, default: "60" },
  { key: "everyUpdate", group: "reminders", label: "After an update: check back every", help: "After you add an update like “waiting for parts”, I ask how it's going this often.", type: "minutes", restart: true, default: "120" },
  { key: "quietHours", group: "reminders", label: "Quiet hours", help: "No reminders in this window; they wait until it ends.", type: "quiet-hours", env: "NAG_QUIET_HOURS", restart: true, default: "23:00-07:00" },
  { key: "tomorrowTime", group: "reminders", label: "“Tomorrow” means", help: "The time a task moves to when you tap 🌅 Tomorrow.", type: "time", env: "TOMORROW_TIME", default: "08:00" },
  // Daily summaries
  { key: "morning", group: "summaries", label: "Morning summary", help: "What you finished yesterday and what's on today, sent to Telegram and saved in the day's note.", type: "optional-time", env: "DIGEST_TIME", restart: true, default: "08:00" },
  { key: "evening", group: "summaries", label: "Evening review", help: "What got done today and what's still open.", type: "optional-time", env: "RETRO_TIME", restart: true, default: "21:00" },
  // Appearance
  { key: "theme", group: "appearance", label: "Theme", help: "Light, dark, or follow your phone / computer.", type: "select", options: [{ value: "light", label: "Light" }, { value: "dark", label: "Dark" }, { value: "auto", label: "Automatic" }], default: "light" },
  { key: "accent", group: "appearance", label: "Accent colour", help: "Buttons and highlights.", type: "select", options: [{ value: "blue", label: "Blue" }, { value: "teal", label: "Teal" }, { value: "violet", label: "Violet" }, { value: "pink", label: "Pink" }], default: "blue" },
  { key: "startScreen", group: "appearance", label: "Open the app on", help: "The screen you see first.", type: "select", options: [{ value: "today", label: "Today" }, { value: "upcoming", label: "Upcoming" }, { value: "projects", label: "Projects" }], default: "today" },
];
export const GROUPS = [
  { id: "profile", title: "You & your time" },
  { id: "reminders", title: "Reminders" },
  { id: "summaries", title: "Daily summaries" },
  { id: "appearance", title: "Look" },
] as const;

const byKey = new Map(SETTINGS.map((s) => [s.key, s]));
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Check one value; returns it normalised, or throws a plain-language error. */
export function validate(key: string, raw: unknown): string {
  const def = byKey.get(key);
  if (!def) throw new SettingError(`Unknown setting “${key}”`);
  const v = String(raw ?? "").trim();
  const bad = (msg: string): never => {
    throw new SettingError(`${def.label}: ${msg}`);
  };
  switch (def.type) {
    case "text":
      if (v.length > 60) bad("keep it under 60 characters");
      return v;
    case "time":
      return HHMM.test(v) ? v : bad("use a time like 09:00");
    case "optional-time":
      return v === "" || HHMM.test(v) ? v : bad("use a time like 08:00, or turn it off");
    case "timezone":
      try {
        new Intl.DateTimeFormat("en", { timeZone: v });
        return v;
      } catch {
        return bad(`“${v}” isn't a time zone (e.g. Asia/Riyadh)`);
      }
    case "select":
      return def.options!.some((o) => o.value === v) ? v : bad("pick one of the options");
    case "minutes": {
      const n = Number(v);
      return Number.isInteger(n) && n >= 5 && n <= 24 * 60 ? String(n) : bad("between 5 and 1440 minutes");
    }
    case "quiet-hours": {
      if (v === "") return v;
      const [a, b] = v.split("-");
      return a && b && HHMM.test(a) && HHMM.test(b) && a !== b ? `${a}-${b}` : bad("use a range like 23:00-07:00, or turn it off");
    }
    case "weekdays": {
      const days = [...new Set(v.split(",").map((d) => d.trim().toLowerCase().slice(0, 3)).filter(Boolean))];
      if (days.some((d) => !WEEK.includes(d))) bad("use day names like fri,sat");
      if (days.length > 3) bad("at most 3 weekend days");
      return days.sort((x, y) => WEEK.indexOf(x) - WEEK.indexOf(y)).join(",");
    }
  }
}
export class SettingError extends Error {}

/** Stored settings → the .env variables they override (reminder intervals merge into NAG_INTERVALS). */
export function toEnv(stored: Record<string, string>, env: NodeJS.ProcessEnv = {}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(stored)) {
    const def = byKey.get(k);
    if (def?.env) out[def.env] = v;
  }
  if (stored.everyOverdue || stored.everyPartial || stored.everyUpdate) {
    const cur = Object.fromEntries((env.NAG_INTERVALS ?? "").split(",").map((p) => p.split("=").map((s) => s.trim())).filter((p) => p.length === 2)) as Record<string, string>;
    out.NAG_INTERVALS = `overdue=${stored.everyOverdue ?? cur.overdue ?? 30},partial=${stored.everyPartial ?? cur.partial ?? 60},remark=${stored.everyUpdate ?? cur.remark ?? 120}`;
  }
  return out;
}

/**
 * At start-up, before the config is parsed: read the settings table straight from the database
 * file (read-only) and lay them over the environment. A missing file or table just means none.
 */
export async function withStoredSettings(env: NodeJS.ProcessEnv): Promise<NodeJS.ProcessEnv> {
  const path = resolve(env.DATABASE_PATH ?? "./data/app.db");
  if (!existsSync(path)) return env;
  try {
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(path, { readOnly: true });
    try {
      const rows = db.prepare("SELECT key, value FROM settings").all() as { key: string; value: string }[];
      const stored: Record<string, string> = {};
      for (const r of rows) {
        try {
          stored[r.key] = validate(r.key, r.value);
        } catch {
          /* a setting from a newer/older version: ignore */
        }
      }
      return { ...env, ...toEnv(stored, env) };
    } finally {
      db.close();
    }
  } catch {
    return env; // no settings table yet (first start)
  }
}

/** Current value of every setting and where it came from. */
export class SettingsStore {
  constructor(
    private readonly db: DB,
    private readonly env: NodeJS.ProcessEnv,
  ) {}

  stored(): Record<string, string> {
    const rows = this.db.$client.prepare("SELECT key, value FROM settings").all() as { key: string; value: string }[];
    return Object.fromEntries(rows.filter((r) => byKey.has(r.key)).map((r) => [r.key, r.value]));
  }

  /** What .env (or the built-in default) says, for "reset" and for showing the source. */
  fromEnv(def: SettingDef): string | undefined {
    const intervals = Object.fromEntries((this.env.NAG_INTERVALS ?? "").split(",").map((p) => p.split("=").map((s) => s.trim())).filter((p) => p.length === 2));
    const v =
      def.key === "everyOverdue" ? intervals.overdue : def.key === "everyPartial" ? intervals.partial : def.key === "everyUpdate" ? intervals.remark : def.env ? this.env[def.env] : undefined;
    return v === undefined ? undefined : String(v);
  }

  get(key: string): string {
    const def = byKey.get(key)!;
    return this.stored()[key] ?? this.fromEnv(def) ?? def.default;
  }

  /** Everything the Settings page needs. `pending` = saved but waiting for a restart. */
  describe(applied: Record<string, string>) {
    const stored = this.stored();
    return GROUPS.map((g) => ({
      ...g,
      items: SETTINGS.filter((s) => s.group === g.id).map((s) => {
        const value = stored[s.key] ?? this.fromEnv(s) ?? s.default;
        return {
          key: s.key,
          label: s.label,
          help: s.help,
          type: s.type,
          options: s.options,
          value,
          source: stored[s.key] !== undefined ? "app" : this.fromEnv(s) !== undefined ? "env" : "default",
          restart: !!s.restart,
          pending: !!s.restart && applied[s.key] !== undefined && applied[s.key] !== value,
        };
      }),
    }));
  }

  /** Save some values (validated); null resets a setting to .env / default. Returns the keys that need a restart. */
  set(values: Record<string, unknown>): { changed: string[]; restart: string[] } {
    const now = new Date().toISOString();
    const changed: string[] = [];
    const tx = this.db.$client;
    const upsert = tx.prepare("INSERT INTO settings(key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at");
    const del = tx.prepare("DELETE FROM settings WHERE key = ?");
    const clean = Object.entries(values).map(([k, v]) => [k, v === null ? null : validate(k, v)] as const);
    for (const [k, v] of clean) {
      if (v === null) del.run(k);
      else upsert.run(k, v, now);
      changed.push(k);
    }
    return { changed, restart: changed.filter((k) => byKey.get(k)?.restart) };
  }

  /** Settings the web and Mini App use for display (name, theme, accent…). */
  prefs() {
    return {
      name: this.get("name"),
      theme: this.get("theme") as "light" | "dark" | "auto",
      accent: this.get("accent") as "blue" | "teal" | "violet" | "pink",
      startScreen: this.get("startScreen") as "today" | "upcoming" | "projects",
      weekStart: this.get("weekStart") as "sat" | "sun" | "mon",
      timeFormat: this.get("timeFormat") as "24h" | "12h",
      pausedUntil: this.pausedUntil(),
    };
  }

  /** "Pause all reminders" (live; checked on every reminder round). */
  pausedUntil(): string | null {
    const row = this.db.$client.prepare("SELECT value FROM settings WHERE key = 'pausedUntil'").get() as { value: string } | undefined;
    return row && Date.parse(row.value) > Date.now() ? row.value : null;
  }
  pause(until: Date | null) {
    if (!until) this.db.$client.prepare("DELETE FROM settings WHERE key = 'pausedUntil'").run();
    else this.db.$client.prepare("INSERT INTO settings(key, value, updated_at) VALUES ('pausedUntil', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at").run(until.toISOString(), new Date().toISOString());
  }
}
