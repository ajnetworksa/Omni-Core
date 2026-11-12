import { and, inArray, lte } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { tasks, type TaskStatus } from "../db/schema.js";
import { addDays, todayInTz } from "../util/time.js";
import type { TaskService } from "./service.js";

const OPEN: TaskStatus[] = ["backlog", "ready", "in_progress", "blocked"];

export interface RolloverResult {
  toDate: string;
  migrated: string[];
  conflicts: string[];
}

/**
 * Moves every open task due on or before `fromDate` to `toDate` and bumps its rollover count.
 * The new due date is written into the markdown line too, so a re-index can't undo it.
 *
 * Scheduled at 23:59:59 local with fromDate=today, toDate=tomorrow. On startup it runs once with
 * fromDate=yesterday, toDate=today to catch up after downtime.
 */
export async function rollover(
  db: DB,
  service: TaskService,
  opts: { fromDate: string; toDate: string },
): Promise<RolloverResult> {
  const due = db
    .select({ id: tasks.id, rolloverCount: tasks.rolloverCount })
    .from(tasks)
    .where(and(inArray(tasks.status, OPEN), lte(tasks.dueDate, opts.fromDate)))
    .all();
  const migrated: string[] = [];
  const conflicts: string[] = [];
  for (const t of due) {
    try {
      await service.update(t.id, { dueDate: opts.toDate, rolloverCount: t.rolloverCount + 1 });
      migrated.push(t.id);
    } catch {
      conflicts.push(t.id);
    }
  }
  return { toDate: opts.toDate, migrated, conflicts };
}

export function nightlyRolloverWindow(timeZone: string, now = new Date()) {
  const today = todayInTz(timeZone, now);
  return { fromDate: today, toDate: addDays(today, 1) };
}

export function catchUpRolloverWindow(timeZone: string, now = new Date()) {
  const today = todayInTz(timeZone, now);
  return { fromDate: addDays(today, -1), toDate: today };
}
