import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`;

export const TASK_STATUSES = ["backlog", "ready", "in_progress", "blocked", "done", "cancelled"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export type Remark = { at: string; text: string; source: "web" | "telegram" | "markdown" | "system" };

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  slug: text("slug").notNull().unique(),
  status: text("status").notNull().default("active"),
  createdAt: text("created_at").notNull().default(now),
});

export const milestones = sqliteTable(
  "milestones",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    targetDate: text("target_date"),
    status: text("status").notNull().default("open"),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [index("milestones_project_idx").on(t.projectId)],
);

export const notes = sqliteTable("notes", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  /** Vault-relative POSIX path, e.g. `daily/2026-11-11.md`. */
  path: text("path").notNull().unique(),
  frontmatter: text("frontmatter", { mode: "json" }).$type<Record<string, unknown>>().notNull().default({}),
  content: text("content").notNull(),
  checksum: text("checksum").notNull(),
  updatedAt: text("updated_at").notNull().default(now),
});

export const tasks = sqliteTable(
  "tasks",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").references(() => projects.id, { onDelete: "set null" }),
    milestoneId: text("milestone_id").references(() => milestones.id, { onDelete: "set null" }),
    noteId: text("note_id").references(() => notes.id, { onDelete: "cascade" }),
    parentTaskId: text("parent_task_id"),
    title: text("title").notNull(),
    status: text("status").$type<TaskStatus>().notNull().default("ready"),
    /** 1 (highest) … 4 (lowest). */
    priority: integer("priority").notNull().default(4),
    /** YYYY-MM-DD, local to the configured TIMEZONE. */
    dueDate: text("due_date"),
    /** HH:mm, optional. */
    dueTime: text("due_time"),
    tags: text("tags", { mode: "json" }).$type<string[]>().notNull().default([]),
    rolloverCount: integer("rollover_cnt").notNull().default(0),
    remarks: text("remarks", { mode: "json" }).$type<Remark[]>().notNull().default([]),
    pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
    /** 0–100, set via "Partial" actions. Subtask completion is computed separately. */
    progress: integer("progress").notNull().default(0),
    /** Nagging is suppressed until this instant (ISO). */
    snoozedUntil: text("snoozed_until"),
    /** Last explicit user action (remark, partial, snooze…) — resets the nag timer. */
    lastActionAt: text("last_action_at"),
    /** Obsidian-Tasks style rule, e.g. "every week", "every weekday", "every 2 days when done". */
    recurrence: text("recurrence"),
    // --- markdown sync bookkeeping ---
    /** Obsidian block id (without the ^), stable identity across edits. */
    anchor: text("anchor"),
    /** 0-based line index at last index. A hint only; anchor/rawLine are authoritative. */
    lineNumber: integer("line_number"),
    /** Exact source line at last sync, used to locate the line when no anchor exists. */
    rawLine: text("raw_line"),
    /** Order of this task within its note, used for anchor-less matching. */
    ordinal: integer("ordinal"),
    completedAt: text("completed_at"),
    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at").notNull().default(now),
  },
  (t) => [
    index("tasks_note_idx").on(t.noteId),
    index("tasks_project_idx").on(t.projectId),
    index("tasks_status_due_idx").on(t.status, t.dueDate),
    uniqueIndex("tasks_anchor_uq").on(t.anchor),
  ],
);

export const noteLinks = sqliteTable(
  "note_links",
  {
    id: text("id").primaryKey(),
    sourceNoteId: text("source_note_id").notNull().references(() => notes.id, { onDelete: "cascade" }),
    targetTitle: text("target_title").notNull(),
    heading: text("heading"),
    /** Null when the link is dangling (target note doesn't exist yet). */
    targetNoteId: text("target_note_id").references(() => notes.id, { onDelete: "set null" }),
  },
  (t) => [index("links_source_idx").on(t.sourceNoteId), index("links_target_idx").on(t.targetNoteId)],
);

export const remindersLog = sqliteTable(
  "reminders_log",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
    channel: text("channel").notNull(),
    stateSent: text("state_sent").notNull(),
    ackAt: text("ack_at"),
    chatId: text("chat_id"),
    messageId: integer("message_id"),
    sentAt: text("sent_at").notNull().default(now),
  },
  (t) => [index("reminders_task_idx").on(t.taskId)],
);

export type Project = typeof projects.$inferSelect;
export type Note = typeof notes.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
export type ReminderLog = typeof remindersLog.$inferSelect;
