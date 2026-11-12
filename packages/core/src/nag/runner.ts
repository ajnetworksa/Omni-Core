import { and, inArray, isNotNull, lte, sql } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { notes, projects, remindersLog, tasks, type Remark, type Task } from "../db/schema.js";
import { uuid } from "../util/hash.js";
import { todayInTz } from "../util/time.js";
import { evaluateNag, type NagConfig, type NagDecision, type NagState, type SubtaskStats } from "./engine.js";

export interface ReminderPayload {
  task: Task;
  state: NagState;
  decision: NagDecision;
  subtasks: SubtaskStats;
  lastRemark?: Remark;
  notePath?: string;
  projectTitle?: string;
  /** How many reminders have already gone out for this task since it became due. */
  reminderCount: number;
  /** The tick's evaluation time (use this, not the wall clock, for "late by"). */
  now: Date;
}

export interface SentRef {
  chatId: string;
  messageId: number;
}

export interface Notifier {
  readonly channel: string;
  sendReminder(p: ReminderPayload): Promise<SentRef[]>;
}

export interface NagTickResult {
  evaluated: number;
  due: number;
  sent: number;
  errors: number;
}

/** One tick of the nag engine: evaluate all due-ish tasks, send what's due, log it. */
export async function runNagTick(db: DB, notifier: Notifier, cfg: NagConfig, now = new Date()): Promise<NagTickResult> {
  const today = todayInTz(cfg.timeZone, now);
  const candidates = db
    .select()
    .from(tasks)
    .where(and(inArray(tasks.status, ["ready", "in_progress", "blocked"]), isNotNull(tasks.dueDate), lte(tasks.dueDate, today)))
    .all();
  if (!candidates.length) return { evaluated: 0, due: 0, sent: 0, errors: 0 };
  const ids = candidates.map((t) => t.id);

  const subRows = db
    .select({
      parent: tasks.parentTaskId,
      done: sql<number>`sum(case when ${tasks.status} = 'done' then 1 else 0 end)`,
      total: sql<number>`count(*)`,
    })
    .from(tasks)
    .where(inArray(tasks.parentTaskId, ids))
    .groupBy(tasks.parentTaskId)
    .all();
  const subs = new Map(subRows.map((r) => [r.parent!, { done: Number(r.done), total: Number(r.total) }]));

  const logRows = db
    .select({ taskId: remindersLog.taskId, sentAt: remindersLog.sentAt })
    .from(remindersLog)
    .where(inArray(remindersLog.taskId, ids))
    .all();
  const logsByTask = new Map<string, Date[]>();
  for (const r of logRows) {
    const arr = logsByTask.get(r.taskId) ?? [];
    arr.push(new Date(r.sentAt));
    logsByTask.set(r.taskId, arr);
  }

  const due: { task: Task; decision: NagDecision; sub: SubtaskStats; sentSinceDue: number }[] = [];
  for (const task of candidates) {
    const sub = subs.get(task.id) ?? { done: 0, total: 0 };
    const sent = logsByTask.get(task.id) ?? [];
    const last = sent.reduce<Date | null>((a, b) => (!a || b > a ? b : a), null);
    const decision = evaluateNag(task, sub, last, now, cfg);
    if (decision?.send) {
      due.push({ task, decision, sub, sentSinceDue: sent.filter((d) => d >= decision.dueAt).length });
    }
  }

  // Most urgent first: priority, then how many times it has slipped, then how late it is.
  due.sort(
    (a, b) =>
      a.task.priority - b.task.priority ||
      b.task.rolloverCount - a.task.rolloverCount ||
      a.decision.dueAt.getTime() - b.decision.dueAt.getTime(),
  );

  let sent = 0;
  let errors = 0;
  for (const d of due.slice(0, cfg.maxPerTick)) {
    const note = d.task.noteId ? db.select({ path: notes.path }).from(notes).where(sql`${notes.id} = ${d.task.noteId}`).get() : undefined;
    const project = d.task.projectId
      ? db.select({ title: projects.title }).from(projects).where(sql`${projects.id} = ${d.task.projectId}`).get()
      : undefined;
    try {
      const refs = await notifier.sendReminder({
        task: d.task,
        state: d.decision.state,
        decision: d.decision,
        subtasks: d.sub,
        lastRemark: d.task.remarks.at(-1),
        notePath: note?.path,
        projectTitle: project?.title,
        reminderCount: d.sentSinceDue,
        now,
      });
      const sentAt = now.toISOString();
      for (const ref of refs.length ? refs : [{ chatId: null, messageId: null }]) {
        db.insert(remindersLog)
          .values({
            id: uuid(),
            taskId: d.task.id,
            channel: notifier.channel,
            stateSent: d.decision.state,
            sentAt,
            chatId: ref.chatId,
            messageId: ref.messageId,
          })
          .run();
      }
      sent++;
    } catch (err) {
      errors++;
      console.error(`[nag] failed to send reminder for ${d.task.id}`, err);
    }
  }
  return { evaluated: candidates.length, due: due.length, sent, errors };
}

/** Mark the reminder message the user responded to as acknowledged. */
export function acknowledgeReminder(db: DB, chatId: string, messageId: number, at = new Date()): void {
  db.update(remindersLog)
    .set({ ackAt: at.toISOString() })
    .where(and(sql`${remindersLog.chatId} = ${chatId}`, sql`${remindersLog.messageId} = ${messageId}`))
    .run();
}
