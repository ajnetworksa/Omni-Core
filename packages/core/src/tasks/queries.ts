import { and, asc, desc, eq, inArray, lte, or, sql, type SQL } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { noteLinks, notes, projects, tasks, type TaskStatus } from "../db/schema.js";
import { addDays, todayInTz } from "../util/time.js";

const OPEN: TaskStatus[] = ["backlog", "ready", "in_progress", "blocked"];

export interface TaskFilter {
  status?: TaskStatus[];
  projectSlug?: string;
  tag?: string;
  dueBefore?: string;
  minRollover?: number;
  limit?: number;
}

export function listTasks(db: DB, f: TaskFilter = {}) {
  const where: SQL[] = [];
  if (f.status?.length) where.push(inArray(tasks.status, f.status));
  if (f.dueBefore) where.push(lte(tasks.dueDate, f.dueBefore));
  if (f.minRollover) where.push(sql`${tasks.rolloverCount} >= ${f.minRollover}`);
  if (f.tag) where.push(sql`exists (select 1 from json_each(${tasks.tags}) where value = ${f.tag})`);
  if (f.projectSlug) {
    where.push(sql`${tasks.projectId} = (select id from ${projects} where slug = ${f.projectSlug})`);
  }
  return db
    .select()
    .from(tasks)
    .where(where.length ? and(...where) : undefined)
    .orderBy(asc(tasks.priority), sql`${tasks.dueDate} is null`, asc(tasks.dueDate), desc(tasks.rolloverCount))
    .limit(f.limit ?? 500)
    .all();
}

/** The "Today" view: due today/overdue + pinned (open), plus anything completed today. */
export function todayView(db: DB, timeZone: string, now = new Date()) {
  const today = todayInTz(timeZone, now);
  const open = db
    .select()
    .from(tasks)
    .where(and(inArray(tasks.status, OPEN), or(lte(tasks.dueDate, today), eq(tasks.pinned, true))))
    .orderBy(desc(tasks.rolloverCount), asc(tasks.priority), asc(tasks.dueTime))
    .all();
  // completedAt is UTC; "today" is local. Pre-filter loosely in SQL, then compare local dates.
  const completed = db
    .select()
    .from(tasks)
    .where(and(eq(tasks.status, "done"), sql`substr(${tasks.completedAt}, 1, 10) >= ${addDays(today, -1)}`))
    .all()
    .filter((t) => t.completedAt && todayInTz(timeZone, new Date(t.completedAt)) === today);
  return {
    date: today,
    dailyNotePath: `daily/${today}.md`,
    overdue: open.filter((t) => t.dueDate && t.dueDate < today),
    dueToday: open.filter((t) => t.dueDate === today),
    pinned: open.filter((t) => t.pinned && (!t.dueDate || t.dueDate > today)),
    completed,
  };
}

export function graph(db: DB) {
  const nodes = db.select({ id: notes.id, title: notes.title, path: notes.path }).from(notes).all();
  const edges = db
    .select({ source: noteLinks.sourceNoteId, target: noteLinks.targetNoteId, targetTitle: noteLinks.targetTitle })
    .from(noteLinks)
    .all();
  const linked = new Set(edges.flatMap((e) => [e.source, e.target]).filter(Boolean));
  return {
    nodes: nodes.map((n) => ({ ...n, orphan: !linked.has(n.id) })),
    edges: edges.filter((e) => e.target),
    dangling: edges.filter((e) => !e.target),
  };
}

export { OPEN as OPEN_STATUSES };
