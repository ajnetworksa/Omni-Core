import type { TaskStatus } from "../lib/types";

/**
 * Every word the app shows for a task's state, in plain language. The files and the API keep
 * their technical names (backlog, ready, blocked…); only what people read changes.
 */
export const STATUS: Record<TaskStatus, { word: string; help: string }> = {
  backlog: { word: "Someday", help: "No plan yet. It won't remind you." },
  ready: { word: "To do", help: "Ready to start." },
  in_progress: { word: "Doing", help: "Started or partly done." },
  blocked: { word: "Waiting", help: "Stuck on something; you added an update saying why." },
  done: { word: "Done", help: "Finished." },
  cancelled: { word: "Dropped", help: "Not doing it." },
};

export const PRIORITY: Record<number, { word: string; mark: string }> = {
  1: { word: "Urgent", mark: "!!!" },
  2: { word: "High", mark: "!!" },
  3: { word: "Medium", mark: "!" },
  4: { word: "No priority", mark: "" },
};

/** The reminder rhythm, explained with the user's own numbers (tasks, Settings, the guide). */
export function howRemindersWork(r: { overdue: string; partial: string; update: string; quiet: string; defaultTime: string }) {
  return [
    `When a task's time comes (${r.defaultTime} if it only has a date), I send a Telegram message with buttons.`,
    `If you don't respond, I remind you again every ${r.overdue} minutes.`,
    `✅ Done stops it. 🌗 Partly done slows it to every ${r.partial} minutes; 💬 Update (e.g. “waiting for parts”) to every ${r.update}.`,
    `⏱ In 1 hour, 🌅 Tomorrow and 🔕 Quiet today push the next reminder later.${r.quiet ? ` Nothing comes between ${r.quiet.replace("-", " and ")}.` : ""}`,
    "Anything still open at midnight moves to the next day, so nothing is forgotten.",
  ];
}
