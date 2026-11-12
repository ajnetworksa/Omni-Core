import type { TaskCard } from "./types";
import { lateBy, rel } from "./format";

/** One short line describing what the nag engine is doing about a task. */
export function nagLine(t: TaskCard, now = Date.now()): { text: string; tone: "warn" | "muted" } | null {
  const n = t.nag;
  if (!n) return null;
  const due = new Date(n.dueAt).getTime();
  if (due > now) return null;
  if (n.snoozedUntil && new Date(n.snoozedUntil).getTime() > now) {
    return { text: `Snoozed · back ${rel(n.snoozedUntil, now)}`, tone: "muted" };
  }
  const next = n.nextAt ? rel(n.nextAt, now) : "";
  const nextTxt = next && !next.endsWith("ago") ? `next ${next}` : "next nudge now";
  if (n.state === "remark") return { text: `Follow-up ${next && !next.endsWith("ago") ? next : "due"}`, tone: "warn" };
  if (n.sent > 0) return { text: `Nudged ${n.sent}× · ${nextTxt}`, tone: "warn" };
  return { text: `Overdue ${lateBy(n.dueAt, now)} · nudging every ${n.intervalMin} min`, tone: "warn" };
}

export function progressOf(t: TaskCard): number {
  if (t.sub.total > 0) return Math.round(Math.max(t.progress, (t.sub.done / t.sub.total) * 100));
  return t.progress;
}
