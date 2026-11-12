import type { Task } from "../db/schema.js";
import { addDays, endOfLocalDay, todayInTz } from "../util/time.js";
import type { TaskService } from "./service.js";

/** One-tap actions shared by Telegram inline keyboards and the web UI. */
export const TASK_ACTIONS = ["done", "start", "p25", "p50", "p75", "snooze1h", "tomorrow", "mute", "reopen"] as const;
export type TaskAction = (typeof TASK_ACTIONS)[number];

export interface ActionResult {
  task: Task;
  /** Short human summary, e.g. "Snoozed until 14:30". */
  summary: string;
}

export async function applyTaskAction(
  service: TaskService,
  id: string,
  action: TaskAction,
  opts: { now?: Date; tomorrowTime?: string } = {},
): Promise<ActionResult> {
  const now = opts.now ?? new Date();
  const at = now.toISOString();
  const tz = service.timeZone;
  switch (action) {
    case "done":
      return { task: await service.update(id, { status: "done", lastActionAt: at }), summary: "✅ Done" };
    case "reopen":
      return { task: await service.update(id, { status: "ready", progress: 0, lastActionAt: at }), summary: "↩️ Reopened" };
    case "start":
      return { task: await service.update(id, { status: "in_progress", lastActionAt: at }), summary: "▶️ Started" };
    case "p25":
    case "p50":
    case "p75": {
      const pct = Number(action.slice(1));
      return {
        task: await service.update(id, { status: "in_progress", progress: pct, lastActionAt: at }),
        summary: `🌗 ${pct}% done`,
      };
    }
    case "snooze1h": {
      const until = new Date(now.getTime() + 3_600_000);
      return { task: await service.update(id, { snoozedUntil: until.toISOString(), lastActionAt: at }), summary: "⏱ Snoozed 1h" };
    }
    case "tomorrow": {
      const time = opts.tomorrowTime ?? "08:00";
      const task = await service.update(id, { dueDate: addDays(todayInTz(tz, now), 1), dueTime: time, lastActionAt: at });
      return { task, summary: `🌅 Moved to tomorrow ${time}` };
    }
    case "mute":
      return {
        task: await service.update(id, { snoozedUntil: endOfLocalDay(tz, now).toISOString(), lastActionAt: at }),
        summary: "🔕 Muted for today",
      };
  }
}
