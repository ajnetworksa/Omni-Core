import { addDays } from "../util/time.js";

/**
 * Recurrence rules, compatible with the common subset of the Obsidian Tasks plugin:
 *   every day | every 3 days | every week | every 2 weeks | every month | every year
 *   every weekday                      (skips the configured weekend, default Fri+Sat)
 *   every monday, thursday             (named days, comma / "and" separated)
 *   ... when done                      (next date counts from completion, not from the due date)
 */
const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
export type Weekday = (typeof DAYS)[number];

export interface RecurrenceRule {
  kind: "interval" | "weekday" | "days";
  unit?: "day" | "week" | "month" | "year";
  n?: number;
  days?: number[];
  whenDone: boolean;
}

export function parseWeekdays(list: string): number[] {
  return list
    .split(/[\s,]+|\band\b/i)
    .map((s) => s.trim().toLowerCase().slice(0, 3))
    .filter(Boolean)
    .map((s) => DAYS.indexOf(s as Weekday))
    .filter((i) => i >= 0);
}

export function parseRecurrence(input: string): RecurrenceRule | null {
  let text = input.trim().toLowerCase();
  const whenDone = /\bwhen done$/.test(text);
  text = text.replace(/\s*when done$/, "");
  if (!text.startsWith("every")) return null;
  const rest = text.slice(5).trim();

  const m = rest.match(/^(?:(\d+)\s+)?(day|week|month|year)s?$/);
  if (m) return { kind: "interval", n: Math.max(1, Number(m[1] ?? 1)), unit: m[2] as RecurrenceRule["unit"], whenDone };
  if (rest === "weekday" || rest === "weekdays") return { kind: "weekday", whenDone };
  const days = parseWeekdays(rest);
  if (days.length && /^[a-z,\s]+$/.test(rest)) return { kind: "days", days: [...new Set(days)].sort(), whenDone };
  return null;
}

function weekday(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function addMonths(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + n, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

/**
 * Next occurrence date.
 * @param dueDate   the completed instance's due date (null if it had none)
 * @param doneDate  the local date it was completed
 * @param weekend   weekday indices treated as weekend for "every weekday" (0=Sun)
 */
export function nextOccurrence(rule: RecurrenceRule, dueDate: string | null, doneDate: string, weekend: number[] = [5, 6]): string {
  const base = rule.whenDone || !dueDate ? doneDate : dueDate;
  switch (rule.kind) {
    case "interval": {
      const n = rule.n ?? 1;
      if (rule.unit === "day") return addDays(base, n);
      if (rule.unit === "week") return addDays(base, 7 * n);
      if (rule.unit === "month") return addMonths(base, n);
      return addMonths(base, 12 * n);
    }
    case "weekday": {
      let d = addDays(base, 1);
      while (weekend.includes(weekday(d))) d = addDays(d, 1);
      return d;
    }
    case "days": {
      let d = addDays(base, 1);
      for (let i = 0; i < 7 && !rule.days!.includes(weekday(d)); i++) d = addDays(d, 1);
      return d;
    }
  }
}
