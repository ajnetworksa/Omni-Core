import { and, desc, eq, gte, inArray, isNull, like, lte, or, sql } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { noteLinks, notes, projects, remindersLog, tasks, type Remark, type Task, type TaskStatus } from "../db/schema.js";
import { evaluateNag, intervalFor, nagStateOf, type NagConfig, type NagState } from "../nag/engine.js";
import { parseQuickAdd, splitTaskList } from "../markdown/tasks.js";
import { addDays, todayInTz, zonedToInstant } from "../util/time.js";

/**
 * Read models for the web app and Mini App. Everything the UI shows about a task is computed
 * here so both clients (and the bot) stay consistent.
 */

const OPEN: TaskStatus[] = ["backlog", "ready", "in_progress", "blocked"];

export interface NagInfo {
  state: NagState;
  /** Instant the task became due (date + time, or the default due time). */
  dueAt: string;
  /** When the next reminder goes out (null when silent, e.g. snoozed beyond today). */
  nextAt: string | null;
  intervalMin: number;
  /** Reminders sent since the task became due. */
  sent: number;
  snoozedUntil: string | null;
}

export interface TaskCard extends Task {
  projectTitle: string | null;
  projectSlug: string | null;
  notePath: string | null;
  sub: { done: number; total: number };
  lastRemark: Remark | null;
  nag: NagInfo | null;
}

/** Enrich tasks with project, note, subtask, remark and nag info, in a handful of queries. */
export function toCards(db: DB, rows: Task[], cfg: NagConfig, now = new Date()): TaskCard[] {
  if (!rows.length) return [];
  const ids = rows.map((t) => t.id);
  const projectIds = [...new Set(rows.map((t) => t.projectId).filter(Boolean))] as string[];
  const noteIds = [...new Set(rows.map((t) => t.noteId).filter(Boolean))] as string[];
  const projectMap = new Map(
    (projectIds.length ? db.select().from(projects).where(inArray(projects.id, projectIds)).all() : []).map((p) => [p.id, p]),
  );
  const noteMap = new Map(
    (noteIds.length ? db.select({ id: notes.id, path: notes.path }).from(notes).where(inArray(notes.id, noteIds)).all() : []).map((n) => [n.id, n.path]),
  );
  const subs = new Map(
    db
      .select({
        parent: tasks.parentTaskId,
        done: sql<number>`sum(case when ${tasks.status} = 'done' then 1 else 0 end)`,
        total: sql<number>`count(*)`,
      })
      .from(tasks)
      .where(inArray(tasks.parentTaskId, ids))
      .groupBy(tasks.parentTaskId)
      .all()
      .map((r) => [r.parent!, { done: Number(r.done), total: Number(r.total) }]),
  );
  const logs = new Map<string, Date[]>();
  for (const r of db.select({ taskId: remindersLog.taskId, sentAt: remindersLog.sentAt }).from(remindersLog).where(inArray(remindersLog.taskId, ids)).all()) {
    const arr = logs.get(r.taskId) ?? [];
    arr.push(new Date(r.sentAt));
    logs.set(r.taskId, arr);
  }

  return rows.map((t) => {
    const sub = subs.get(t.id) ?? { done: 0, total: 0 };
    const sent = logs.get(t.id) ?? [];
    const last = sent.reduce<Date | null>((a, b) => (!a || b > a ? b : a), null);
    const p = t.projectId ? projectMap.get(t.projectId) : undefined;
    return {
      ...t,
      projectTitle: p?.title ?? null,
      projectSlug: p?.slug ?? null,
      notePath: t.noteId ? (noteMap.get(t.noteId) ?? null) : null,
      sub,
      lastRemark: t.remarks.at(-1) ?? null,
      nag: nagInfo(t, sub, last, sent, cfg, now),
    };
  });
}

function nagInfo(t: Task, sub: { done: number; total: number }, last: Date | null, sent: Date[], cfg: NagConfig, now: Date): NagInfo | null {
  if (!t.dueDate || !["ready", "in_progress", "blocked"].includes(t.status)) return null;
  const dueAt = zonedToInstant(t.dueDate, t.dueTime ?? cfg.defaultDueTime, cfg.timeZone);
  const state = nagStateOf(t, sub);
  const d = evaluateNag(t, sub, last, now, cfg);
  return {
    state,
    dueAt: dueAt.toISOString(),
    nextAt: d ? d.nextAt.toISOString() : dueAt > now ? dueAt.toISOString() : null,
    intervalMin: intervalFor(t, state, cfg),
    sent: sent.filter((s) => s >= dueAt).length,
    snoozedUntil: t.snoozedUntil,
  };
}

export interface TodayBoard {
  date: string;
  dailyNotePath: string;
  /** Overdue, blocked, partially done past due, or rolled over: what the nag engine is chasing. */
  attention: TaskCard[];
  /** Due later today. */
  later: TaskCard[];
  pinned: TaskCard[];
  done: TaskCard[];
  counts: { open: number; done: number };
}

export function todayBoard(db: DB, cfg: NagConfig, now = new Date()): TodayBoard {
  const today = todayInTz(cfg.timeZone, now);
  const open = db
    .select()
    .from(tasks)
    .where(and(inArray(tasks.status, OPEN), or(lte(tasks.dueDate, today), eq(tasks.pinned, true))))
    .all();
  const doneRows = db
    .select()
    .from(tasks)
    .where(and(eq(tasks.status, "done"), sql`substr(${tasks.completedAt}, 1, 10) >= ${addDays(today, -1)}`))
    .all()
    .filter((t) => !t.parentTaskId && t.completedAt && todayInTz(cfg.timeZone, new Date(t.completedAt)) === today);
  const cards = toCards(db, open, cfg, now);
  const urgency = (c: TaskCard) =>
    (c.priority - 1) * 10 - Math.min(c.rolloverCount, 5) * 3 - (c.nag?.sent ?? 0) + (c.status === "blocked" ? 2 : 0);
  const attention: TaskCard[] = [];
  const later: TaskCard[] = [];
  const pinned: TaskCard[] = [];
  for (const c of cards) {
    const dueToday = c.dueDate && c.dueDate <= today;
    if (!dueToday) pinned.push(c);
    else if (c.status === "blocked" || c.rolloverCount > 0 || (c.nag && new Date(c.nag.dueAt) <= now)) attention.push(c);
    else later.push(c);
  }
  attention.sort((a, b) => urgency(a) - urgency(b));
  later.sort((a, b) => (a.nag?.dueAt ?? "").localeCompare(b.nag?.dueAt ?? "") || a.priority - b.priority);
  const done = toCards(db, doneRows, cfg, now).sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""));
  return {
    date: today,
    dailyNotePath: `daily/${today}.md`,
    attention,
    later,
    pinned,
    done,
    counts: { open: attention.length + later.length + pinned.length, done: done.length },
  };
}

export function upcoming(db: DB, cfg: NagConfig, days = 14, now = new Date()) {
  const today = todayInTz(cfg.timeZone, now);
  const rows = db
    .select()
    .from(tasks)
    .where(and(inArray(tasks.status, OPEN), sql`${tasks.dueDate} > ${today}`, lte(tasks.dueDate, addDays(today, days))))
    .all();
  const cards = toCards(db, rows, cfg, now);
  const byDate = new Map<string, TaskCard[]>();
  for (const c of cards) {
    const arr = byDate.get(c.dueDate!) ?? [];
    arr.push(c);
    byDate.set(c.dueDate!, arr);
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, list]) => ({ date, tasks: list.sort((a, b) => (a.dueTime ?? "99").localeCompare(b.dueTime ?? "99") || a.priority - b.priority) }));
}

/** Open tasks with no date, plus notes in inbox/. */
export function inbox(db: DB, cfg: NagConfig, now = new Date()) {
  const rows = db
    .select()
    .from(tasks)
    .where(and(inArray(tasks.status, ["backlog", "ready", "in_progress", "blocked"]), isNull(tasks.dueDate), isNull(tasks.parentTaskId)))
    .orderBy(tasks.priority)
    .limit(300)
    .all();
  const inboxNotes = db
    .select({ id: notes.id, title: notes.title, path: notes.path, updatedAt: notes.updatedAt })
    .from(notes)
    .where(like(notes.path, "inbox/%"))
    .orderBy(desc(notes.updatedAt))
    .all();
  return { tasks: toCards(db, rows, cfg, now), notes: inboxNotes };
}

export function board(db: DB, cfg: NagConfig, now = new Date()) {
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const rows = db
    .select()
    .from(tasks)
    .where(and(isNull(tasks.parentTaskId), or(inArray(tasks.status, OPEN), and(eq(tasks.status, "done"), gte(tasks.completedAt, weekAgo)))))
    .limit(1000)
    .all();
  const cards = toCards(db, rows, cfg, now);
  const cols: Record<"backlog" | "ready" | "in_progress" | "blocked" | "done", TaskCard[]> = {
    backlog: [],
    ready: [],
    in_progress: [],
    blocked: [],
    done: [],
  };
  for (const c of cards) if (c.status in cols) cols[c.status as keyof typeof cols].push(c);
  for (const list of Object.values(cols)) list.sort((a, b) => a.priority - b.priority || (a.dueDate ?? "9").localeCompare(b.dueDate ?? "9"));
  return cols;
}

export function taskDetail(db: DB, id: string, cfg: NagConfig, now = new Date()) {
  const t = db.select().from(tasks).where(eq(tasks.id, id)).get();
  if (!t) return null;
  const [card] = toCards(db, [t], cfg, now);
  const children = toCards(db, db.select().from(tasks).where(eq(tasks.parentTaskId, id)).orderBy(tasks.ordinal).all(), cfg, now);
  const reminders = db
    .select({ sentAt: remindersLog.sentAt, state: remindersLog.stateSent, ackAt: remindersLog.ackAt, channel: remindersLog.channel })
    .from(remindersLog)
    .where(eq(remindersLog.taskId, id))
    .orderBy(desc(remindersLog.sentAt))
    .limit(50)
    .all();
  // collapse multi-chat sends of the same tick into one entry
  const seen = new Set<string>();
  const history = reminders.filter((r) => (seen.has(r.sentAt) ? false : (seen.add(r.sentAt), true)));
  const parent = t.parentTaskId ? db.select({ id: tasks.id, title: tasks.title }).from(tasks).where(eq(tasks.id, t.parentTaskId)).get() : null;
  return { ...card!, children, reminders: history, parent: parent ?? null, sourceLine: t.lineNumber != null ? t.lineNumber + 1 : null, rawLine: t.rawLine };
}

export function projectStats(db: DB, cfg: NagConfig, now = new Date()) {
  const today = todayInTz(cfg.timeZone, now);
  const rows = db
    .select({
      id: projects.id,
      title: projects.title,
      slug: projects.slug,
      status: projects.status,
      total: sql<number>`count(${tasks.id}) filter (where ${tasks.status} != 'cancelled')`,
      done: sql<number>`count(${tasks.id}) filter (where ${tasks.status} = 'done')`,
      blocked: sql<number>`count(${tasks.id}) filter (where ${tasks.status} = 'blocked')`,
      overdue: sql<number>`count(${tasks.id}) filter (where ${tasks.status} in ('backlog','ready','in_progress','blocked') and ${tasks.dueDate} < ${today})`,
      dueToday: sql<number>`count(${tasks.id}) filter (where ${tasks.status} in ('backlog','ready','in_progress','blocked') and ${tasks.dueDate} = ${today})`,
    })
    .from(projects)
    .leftJoin(tasks, eq(tasks.projectId, projects.id))
    .groupBy(projects.id)
    .orderBy(projects.title)
    .all();
  return rows.map((r) => {
    const total = Number(r.total), done = Number(r.done);
    return { ...r, total, done, blocked: Number(r.blocked), overdue: Number(r.overdue), dueToday: Number(r.dueToday), percent: total ? Math.round((done / total) * 100) : 0 };
  });
}

export function noteDetail(db: DB, id: string, cfg: NagConfig, now = new Date()) {
  const n = db.select().from(notes).where(eq(notes.id, id)).get();
  if (!n) return null;
  const backlinks = db
    .select({ id: notes.id, title: notes.title, path: notes.path })
    .from(noteLinks)
    .innerJoin(notes, eq(notes.id, noteLinks.sourceNoteId))
    .where(eq(noteLinks.targetNoteId, id))
    .all()
    .filter((b, i, arr) => arr.findIndex((x) => x.id === b.id) === i);
  const outgoing = db
    .select({ title: noteLinks.targetTitle, heading: noteLinks.heading, targetId: noteLinks.targetNoteId })
    .from(noteLinks)
    .where(eq(noteLinks.sourceNoteId, id))
    .all();
  const noteTasks = toCards(db, db.select().from(tasks).where(eq(tasks.noteId, id)).orderBy(tasks.ordinal).all(), cfg, now);
  return { ...n, backlinks, outgoing, tasks: noteTasks };
}

export function search(db: DB, q: string, cfg: NagConfig, now = new Date()) {
  const clean = q.replace(/[%_\\]/g, "").trim();
  if (clean.length < 2) return { tasks: [], notes: [] };
  const pat = `%${clean}%`;
  const taskRows = db.select().from(tasks).where(like(tasks.title, pat)).limit(20).all();
  const noteRows = db
    .select({ id: notes.id, title: notes.title, path: notes.path, content: notes.content })
    .from(notes)
    .where(or(like(notes.title, pat), like(notes.content, pat)))
    .limit(12)
    .all();
  return {
    tasks: toCards(db, taskRows, cfg, now),
    notes: noteRows.map(({ content, ...n }) => {
      const i = content.toLowerCase().indexOf(clean.toLowerCase());
      const snippet = i >= 0 ? content.slice(Math.max(0, i - 50), i + 80).replace(/\s+/g, " ").replace(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/g, "") : "";
      return { ...n, snippet };
    }),
  };
}

/** Quick-add preview: what the parser understood (shown as chips while typing). */
export function parsePreview(text: string, timeZone: string, now = new Date()) {
  const list = splitTaskList(text);
  const m = parseQuickAdd(list.length > 1 ? list[0]! : text, timeZone, now);
  const projectTag = m.tags.find((t) => t.startsWith("project/"));
  return {
    title: m.title,
    priority: m.priority ?? null,
    dueDate: m.dueDate ?? null,
    dueTime: m.dueTime ?? null,
    recurrence: m.recurrence ?? null,
    project: projectTag ? projectTag.slice("project/".length) : null,
    tags: m.tags.filter((t) => !t.startsWith("project/")),
    /** Set when the text is a list: the title of each task that will be added. */
    items: list.length > 1 ? list.map((t) => parseQuickAdd(t, timeZone, now).title) : null,
  };
}
