import type { Task } from "../db/schema.js";
import { localMinutes, zonedToInstant } from "../util/time.js";

/**
 * Nag & escalation FSM (spec §3.3), evaluated statelessly on every tick:
 *
 *   not due ──(due window reached)──► overdue  ── ping every `overdue` min
 *                                    partial  ── progress / subtasks / [/]  → ping every `partial` min
 *                                    remark   ── remark added or [!] blocked → ping every `remark` min
 *   done / cancelled / backlog / snoozed / muted ──► silent
 *
 * Being stateless (derived from task + reminders_log) means restarts, file edits and
 * missed ticks can never leave a stuck or duplicate reminder.
 */
export type NagState = "overdue" | "partial" | "remark";

export interface NagConfig {
  timeZone: string;
  /** Used when a task has a due date but no time. */
  defaultDueTime: string;
  intervalsMin: Record<NagState, number>;
  /** Minutes since local midnight; window may wrap midnight (e.g. 23:00 → 07:00). */
  quietHours: { start: number; end: number } | null;
  maxPerTick: number;
}

export const DEFAULT_NAG_CONFIG: Omit<NagConfig, "timeZone"> = {
  defaultDueTime: "09:00",
  intervalsMin: { overdue: 30, partial: 60, remark: 120 },
  quietHours: { start: 23 * 60, end: 7 * 60 },
  maxPerTick: 5,
};

export interface NagDecision {
  state: NagState;
  dueAt: Date;
  nextAt: Date;
  intervalMin: number;
  send: boolean;
}

export interface SubtaskStats {
  done: number;
  total: number;
}

const NAGGABLE = new Set(["ready", "in_progress", "blocked"]);

export function nagStateOf(task: Task, sub: SubtaskStats): NagState {
  if (task.status === "blocked" || task.remarks.length > 0) return "remark";
  if (task.status === "in_progress" || task.progress > 0 || sub.done > 0) return "partial";
  return "overdue";
}

export function intervalFor(task: Task, state: NagState, cfg: NagConfig): number {
  let m = cfg.intervalsMin[state];
  if (task.priority === 1) m /= 2; // p1 escalates twice as fast
  if (task.rolloverCount >= 3) m /= 2; // chronic slippage escalates too
  return Math.max(10, Math.round(m));
}

export function parseHHMMRange(spec: string | undefined): { start: number; end: number } | null {
  if (!spec) return null;
  const m = spec.match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return { start: +m[1]! * 60 + +m[2]!, end: +m[3]! * 60 + +m[4]! };
}

export function inQuietHours(now: Date, cfg: NagConfig): boolean {
  if (!cfg.quietHours) return false;
  const { start, end } = cfg.quietHours;
  const t = localMinutes(cfg.timeZone, now);
  return start <= end ? t >= start && t < end : t >= start || t < end;
}

const max = (...ds: (Date | null | undefined)[]) =>
  ds.filter((d): d is Date => !!d).reduce<Date | null>((a, b) => (!a || b > a ? b : a), null);

export function evaluateNag(
  task: Task,
  sub: SubtaskStats,
  lastSentAt: Date | null,
  now: Date,
  cfg: NagConfig,
): NagDecision | null {
  if (!task.dueDate || !NAGGABLE.has(task.status)) return null;
  const dueAt = zonedToInstant(task.dueDate, task.dueTime ?? cfg.defaultDueTime, cfg.timeZone);
  if (now < dueAt) return null;

  const state = nagStateOf(task, sub);
  const intervalMin = intervalFor(task, state, cfg);
  const snoozed = task.snoozedUntil ? new Date(task.snoozedUntil) : null;
  const lastAction = task.lastActionAt ? new Date(task.lastActionAt) : null;

  // Only activity since the task became due counts; a reschedule therefore starts fresh.
  const anchor = max(lastSentAt && lastSentAt >= dueAt ? lastSentAt : null, lastAction && lastAction >= dueAt ? lastAction : null);
  let nextAt = anchor ? new Date(anchor.getTime() + intervalMin * 60_000) : dueAt;
  // When a snooze ends, ping right away rather than waiting another interval.
  if (snoozed && (!anchor || snoozed > anchor)) nextAt = snoozed > dueAt ? snoozed : nextAt;

  const send = now >= nextAt && !(snoozed && snoozed > now) && !inQuietHours(now, cfg);
  return { state, dueAt, nextAt, intervalMin, send };
}
