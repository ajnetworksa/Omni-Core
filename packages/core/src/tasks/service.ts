import { eq } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { notes, tasks, type Remark, type Task, type TaskStatus } from "../db/schema.js";
import { detectEol, splitLines } from "../markdown/parse.js";
import {
  appendAnchor,
  charFromStatus,
  parseQuickAdd,
  parseTaskText,
  removeAnchor,
  removeDoneToken,
  renderTaskLine,
  setDoneToken,
  setLineCheckbox,
  singleLine,
  TASK_LINE_RE,
} from "../markdown/tasks.js";
import { anchorId, sha256, slugify } from "../util/hash.js";
import { localTimeHHMM, todayInTz } from "../util/time.js";
import type { VaultIndexer } from "../vault/indexer.js";
import { nextOccurrence, parseRecurrence } from "./recurrence.js";

export class TaskNotFoundError extends Error {}
/** A note was changed on disk since the client loaded it (optimistic concurrency). */
export class NoteConflictError extends Error {
  constructor(readonly currentChecksum: string) {
    super("Note changed on disk since it was loaded");
  }
}
/** The task's line could not be located in its file (file was edited externally). */
export class TaskLineConflictError extends Error {}

export interface TaskPatch {
  status?: TaskStatus;
  title?: string;
  priority?: number;
  dueDate?: string | null;
  dueTime?: string | null;
  pinned?: boolean;
  rolloverCount?: number;
  progress?: number;
  snoozedUntil?: string | null;
  lastActionAt?: string | null;
}

export interface CreateTaskInput {
  /** Quick-add text, e.g. "Replace UPS battery !p1 @today #homelab". */
  text: string;
  /** Vault-relative note path. Defaults to today's daily note. */
  notePath?: string;
  projectSlug?: string;
  status?: TaskStatus;
}

export interface TaskServiceOptions {
  timeZone: string;
  /** Write Obsidian-Tasks `✅ YYYY-MM-DD` when a task is completed. Default true. */
  writeDoneDate?: boolean;
  /** Weekday indices (0=Sun) treated as weekend by "every weekday". Default Fri+Sat. */
  weekendDays?: number[];
}

/** Fields that live in the markdown line; changing any of them rewrites the line text. */
const LINE_FIELDS = ["title", "priority", "dueDate", "dueTime"] as const;

export class TaskService {
  readonly timeZone: string;
  private writeDoneDate: boolean;
  private weekendDays: number[];

  constructor(
    private db: DB,
    readonly indexer: VaultIndexer,
    opts: TaskServiceOptions | string,
  ) {
    const o = typeof opts === "string" ? { timeZone: opts } : opts;
    this.timeZone = o.timeZone;
    this.writeDoneDate = o.writeDoneDate ?? true;
    this.weekendDays = o.weekendDays ?? [5, 6];
  }

  get(id: string): Task {
    const t = this.db.select().from(tasks).where(eq(tasks.id, id)).get();
    if (!t) throw new TaskNotFoundError(id);
    return t;
  }

  children(id: string): Task[] {
    return this.db.select().from(tasks).where(eq(tasks.parentTaskId, id)).all();
  }

  /**
   * Update a task and mirror the change onto its exact markdown line.
   * Status-only changes flip the checkbox (and the ✅ date); metadata changes re-render the text.
   * Completing a recurring task inserts the next occurrence above it, like Obsidian Tasks.
   */
  async update(id: string, patch: TaskPatch): Promise<Task> {
    if (patch.title !== undefined) {
      patch = { ...patch, title: singleLine(patch.title) };
      if (!patch.title) throw new Error("Task title is empty");
    }
    const task = this.get(id);
    const note = task.noteId ? this.db.select().from(notes).where(eq(notes.id, task.noteId)).get() : undefined;
    const nowIso = new Date().toISOString();
    const statusChanged = patch.status !== undefined && patch.status !== task.status;

    const dbOnly = {
      ...(patch.pinned !== undefined && { pinned: patch.pinned }),
      ...(patch.rolloverCount !== undefined && { rolloverCount: patch.rolloverCount }),
      ...(patch.progress !== undefined && { progress: Math.max(0, Math.min(100, Math.round(patch.progress))) }),
      ...(patch.snoozedUntil !== undefined && { snoozedUntil: patch.snoozedUntil }),
      ...(patch.lastActionAt !== undefined && { lastActionAt: patch.lastActionAt }),
      ...(patch.status !== undefined && {
        status: patch.status,
        completedAt: patch.status === "done" ? (task.completedAt ?? nowIso) : null,
      }),
      ...(patch.dueDate !== undefined && { snoozedUntil: patch.snoozedUntil ?? null }), // rescheduling clears snooze
    };

    if (!note) {
      this.db.update(tasks).set({ ...patch, ...dbOnly, updatedAt: nowIso }).where(eq(tasks.id, id)).run();
      return this.get(id);
    }

    const touchesLine = patch.status !== undefined || LINE_FIELDS.some((f) => patch[f] !== undefined);
    if (!touchesLine) {
      this.db.update(tasks).set({ ...dbOnly, updatedAt: nowIso }).where(eq(tasks.id, id)).run();
      return this.get(id);
    }

    return this.indexer.lock.run(note.path, async () => {
      const raw = await this.indexer.vault.read(note.path);
      const lines = splitLines(raw);
      const idx = locateLine(lines, task);
      if (idx < 0) {
        // File drifted; bring DB in line with disk and let the caller retry.
        await this.indexer.indexFileUnlocked(note.path);
        throw new TaskLineConflictError(`Could not locate line for task ${id} in ${note.path}`);
      }
      const original = lines[idx]!;
      let line = original;
      const m = line.match(TASK_LINE_RE)!;
      const current = parseTaskText(m[4]!);

      if (LINE_FIELDS.some((f) => patch[f] !== undefined)) {
        line = `${m[1]}${m[2]} [${m[3]}] ${renderTaskLine({
          title: patch.title ?? current.title,
          priority: patch.priority ?? current.priority,
          dueDate: patch.dueDate === undefined ? current.dueDate : patch.dueDate,
          dueTime: patch.dueTime === undefined ? current.dueTime : patch.dueTime,
          recurrence: current.recurrence,
          doneDate: current.doneDate,
          tags: current.tags,
          anchor: current.anchor ?? task.anchor,
        }).replace(/^- \[.\] /, "")}`;
      }

      let nextOccurrenceLine: string | undefined;
      if (patch.status !== undefined) {
        line = setLineCheckbox(line, charFromStatus(patch.status));
        const today = todayInTz(this.timeZone);
        if (patch.status === "done" && statusChanged) {
          if (this.writeDoneDate) line = setDoneToken(line, today);
          const rule = current.recurrence ? parseRecurrence(current.recurrence) : null;
          if (rule) {
            const nextDue = nextOccurrence(rule, current.dueDate ?? null, today, this.weekendDays);
            nextOccurrenceLine = `${m[1]}${m[2]} [ ] ${renderTaskLine({
              title: current.title,
              priority: current.priority,
              recurrence: current.recurrence,
              dueDate: nextDue,
              dueTime: current.dueTime,
              tags: current.tags,
              anchor: anchorId(),
            }).replace(/^- \[.\] /, "")}`;
          }
        } else if (patch.status !== "done") {
          line = removeDoneToken(line);
        }
      }
      lines[idx] = line;
      if (nextOccurrenceLine) lines.splice(idx, 0, nextOccurrenceLine);

      await this.indexer.vault.writeAtomic(note.path, lines.join(detectEol(raw)));
      // DB-only fields first so the reindex's status reconciliation sees the new fine-grained status.
      this.db.update(tasks).set({ ...dbOnly, updatedAt: nowIso }).where(eq(tasks.id, id)).run();
      await this.indexer.indexFileUnlocked(note.path);
      return this.get(id);
    });
  }

  /**
   * Write subtasks as indented checkboxes right under the task's line (after any existing
   * children), so Obsidian shows them nested and the indexer links them as children.
   */
  async addSubtasks(id: string, titles: string[]): Promise<Task[]> {
    const clean = titles.map((t) => singleLine(t)).filter(Boolean).slice(0, 20);
    if (!clean.length) throw new Error("No subtasks given");
    const task = this.get(id);
    const note = task.noteId ? this.db.select().from(notes).where(eq(notes.id, task.noteId)).get() : undefined;
    if (!note) throw new Error("This task isn't in a note, so it can't have subtasks");
    const anchors = clean.map(() => anchorId());
    await this.indexer.lock.run(note.path, async () => {
      const raw = await this.indexer.vault.read(note.path);
      const lines = splitLines(raw);
      const idx = locateLine(lines, task);
      if (idx < 0) {
        await this.indexer.indexFileUnlocked(note.path);
        throw new TaskLineConflictError(`Could not locate line for task ${id} in ${note.path}`);
      }
      const m = lines[idx]!.match(TASK_LINE_RE)!;
      const indentOf = (l: string) => l.match(/^[ \t]*/)![0].replace(/\t/g, "    ").length;
      const base = indentOf(lines[idx]!);
      let end = idx + 1;
      let childIndent: string | undefined;
      while (end < lines.length) {
        const l = lines[end]!;
        if (l.trim() && indentOf(l) <= base) break;
        if (!childIndent && l.trim() && TASK_LINE_RE.test(l)) childIndent = l.match(/^[ \t]*/)![0];
        end++;
      }
      while (end > idx + 1 && !lines[end - 1]!.trim()) end--; // keep blank lines after the block
      const indent = childIndent ?? `${m[1]}${m[1]!.includes("\t") ? "\t" : "    "}`;
      const newLines = clean.map((title, i) => renderTaskLine({ title, anchor: anchors[i], indent }).replace(/^(\s*)- /, `$1${/\d/.test(m[2]!) ? "-" : m[2]} `));
      lines.splice(end, 0, ...newLines);
      await this.indexer.vault.writeAtomic(note.path, lines.join(detectEol(raw)));
      await this.indexer.indexFileUnlocked(note.path);
    });
    return anchors.map((a) => this.db.select().from(tasks).where(eq(tasks.anchor, a)).get()).filter((t): t is Task => !!t);
  }

  addRemark(id: string, text: string, source: Remark["source"]): Task {
    const task = this.get(id);
    const nowIso = new Date().toISOString();
    const remarks = [...task.remarks, { at: nowIso, text, source }];
    this.db.update(tasks).set({ remarks, lastActionAt: nowIso, updatedAt: nowIso }).where(eq(tasks.id, id)).run();
    return this.get(id);
  }

  /** Create a task by writing it into a note, then indexing — the file stays the source of truth. */
  async create(input: CreateTaskInput): Promise<Task> {
    const meta = parseQuickAdd(input.text, this.timeZone);
    if (!meta.title) throw new Error("Task title is empty");
    const today = todayInTz(this.timeZone);
    // A project with its own note (projects/<slug>.md) gets the task there; otherwise today's note + tag.
    const projectNote = input.projectSlug && !input.notePath ? `projects/${slugify(input.projectSlug)}.md` : undefined;
    const intoProjectNote = !!projectNote && (await this.indexer.vault.exists(projectNote));
    const path = input.notePath ?? (intoProjectNote ? projectNote! : `daily/${today}.md`);
    const anchor = anchorId();
    const tags = [...meta.tags];
    if (input.projectSlug && !intoProjectNote && !tags.some((t) => t.startsWith("project/"))) tags.push(`project/${slugify(input.projectSlug)}`);
    const line = renderTaskLine({ ...meta, tags, anchor, status: input.status });

    await this.withNote(path, today, (raw) => insertUnderHeading(raw, "Tasks", line));

    const created = this.db.select().from(tasks).where(eq(tasks.anchor, anchor)).get();
    if (!created) throw new Error("Task was written but not indexed");
    if (input.status && input.status !== created.status) {
      this.db.update(tasks).set({ status: input.status }).where(eq(tasks.id, created.id)).run();
    }
    return this.get(created.id);
  }

  /** Journal-style capture (Telejournal / Telegram Vault Bot idea): `- HH:mm text` under ## Log. */
  async appendLog(text: string, now = new Date()): Promise<string> {
    const today = todayInTz(this.timeZone, now);
    const path = `daily/${today}.md`;
    const body = singleLine(text.trim().replace(/\r?\n/g, " ↩ "));
    await this.withNote(path, today, (raw) => insertUnderHeading(raw, "Log", `- ${localTimeHHMM(this.timeZone, now)} ${body}`));
    return path;
  }

  /** Replace (or add) a `## Heading` section of a note, e.g. the daily Standup / Retro. */
  async writeSection(path: string, heading: string, body: string, now = new Date()): Promise<void> {
    const today = todayInTz(this.timeZone, now);
    await this.withNote(path, today, (raw) => replaceSection(raw, heading, body));
  }

  /**
   * New project → `projects/<slug>.md` with `project:` frontmatter (that's what makes it a project
   * in the index) and an empty `## Tasks` section. Returns the existing file if there is one.
   */
  async createProject(rawName: string, now = new Date()): Promise<{ slug: string; path: string; created: boolean }> {
    const name = singleLine(rawName).replace(/^#?project\//i, "").trim();
    const slug = slugify(name);
    if (!slug) throw new Error("Project name is empty");
    const path = `projects/${slug}.md`;
    const today = todayInTz(this.timeZone, now);
    let created = false;
    await this.indexer.lock.run(path, async () => {
      const vault = this.indexer.vault;
      if (!(await vault.exists(path))) {
        await vault.writeAtomic(path, `---\nproject: ${JSON.stringify(name)}\ntitle: ${JSON.stringify(name)}\ncreated: ${today}\ntags: [project]\n---\n\n# ${name}\n\n## Tasks\n`);
        created = true;
      }
      await this.indexer.indexFileUnlocked(path);
    });
    return { slug, path, created };
  }

  /** `/note Title\ncontent` → inbox/<slug>.md (append with a timestamp if it already exists). */
  async captureNote(rawTitle: string, content: string, now = new Date()): Promise<string> {
    const title = singleLine(rawTitle);
    const today = todayInTz(this.timeZone, now);
    const path = `inbox/${slugify(title) || `note-${Date.now()}`}.md`;
    await this.indexer.lock.run(path, async () => {
      const vault = this.indexer.vault;
      let raw: string;
      if (await vault.exists(path)) {
        const existing = await vault.read(path);
        const eol = detectEol(existing);
        raw = `${existing.replace(/\s+$/, "")}${eol}${eol}### ${today} ${localTimeHHMM(this.timeZone, now)}${eol}${content.trim()}${eol}`;
      } else {
        raw = `---\ntitle: ${JSON.stringify(title)}\ncreated: ${today}\ntags: [inbox]\n---\n\n# ${title}\n\n${content.trim()}\n`;
      }
      await vault.writeAtomic(path, raw);
      await this.indexer.indexFileUnlocked(path);
    });
    return path;
  }

  /**
   * Replace a note's whole content (web editor). Refuses with NoteConflictError when the file
   * on disk no longer matches `expectedChecksum`, so an Obsidian edit is never overwritten.
   */
  async writeNote(path: string, content: string, expectedChecksum: string): Promise<void> {
    await this.indexer.lock.run(path, async () => {
      const vault = this.indexer.vault;
      const current = await vault.read(path);
      const sum = sha256(current);
      if (sum !== expectedChecksum) throw new NoteConflictError(sum);
      // Keep the file's line-ending style.
      const eol = detectEol(current);
      const normalised = eol === "\r\n" ? content.replace(/\r?\n/g, "\r\n") : content.replace(/\r\n/g, "\n");
      await vault.writeAtomic(path, normalised);
      await this.indexer.indexFileUnlocked(path);
    });
  }

  private async withNote(path: string, today: string, edit: (raw: string) => string): Promise<void> {
    await this.indexer.lock.run(path, async () => {
      const vault = this.indexer.vault;
      const raw = (await vault.exists(path)) ? await vault.read(path) : newNoteTemplate(path, today);
      await vault.writeAtomic(path, edit(raw));
      await this.indexer.indexFileUnlocked(path);
    });
  }
}

/** Find a task's current line: anchor first, then the last-known line, then an exact text match. */
export function locateLine(lines: string[], task: Pick<Task, "anchor" | "lineNumber" | "rawLine">): number {
  if (task.anchor) {
    const re = new RegExp(`\\s\\^${escapeRe(task.anchor)}\\s*$`);
    const i = lines.findIndex((l) => TASK_LINE_RE.test(l) && re.test(l));
    if (i >= 0) return i;
  }
  if (task.lineNumber != null && task.rawLine != null && lines[task.lineNumber] === task.rawLine) {
    return task.lineNumber;
  }
  if (task.rawLine != null) {
    const hits = lines.flatMap((l, i) => (l === task.rawLine ? [i] : []));
    if (hits.length === 1) return hits[0]!;
  }
  return -1;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function newNoteTemplate(path: string, today: string): string {
  const isDaily = path.startsWith("daily/");
  const fm = isDaily ? `---\ncreated: ${today}\ntags: [daily]\n---\n` : `---\ncreated: ${today}\n---\n`;
  return isDaily ? `${fm}\n## Tasks\n\n## Log\n` : `${fm}\n## Tasks\n`;
}

/**
 * Insert `line` at the end of the section under `## <heading>` (after its last non-blank line),
 * creating the heading at the end of the file if it doesn't exist.
 */
export function insertUnderHeading(raw: string, heading: string, line: string): string {
  const eol = detectEol(raw);
  const lines = splitLines(raw);
  const re = new RegExp(`^#{1,6}\\s+${escapeRe(heading)}\\s*$`, "i");
  const h = lines.findIndex((l) => re.test(l));
  if (h < 0) {
    while (lines.length && lines[lines.length - 1] === "") lines.pop();
    lines.push("", `## ${heading}`, line, "");
    return lines.join(eol);
  }
  let insertAt = h + 1;
  for (let i = h + 1; i < lines.length; i++) {
    if (/^#{1,6}\s/.test(lines[i]!)) break;
    if (lines[i]!.trim() !== "") insertAt = i + 1;
  }
  lines.splice(insertAt, 0, line);
  // Keep a blank line before the next heading for readability.
  if (lines[insertAt + 1] !== undefined && /^#{1,6}\s/.test(lines[insertAt + 1]!)) lines.splice(insertAt + 1, 0, "");
  if (lines[lines.length - 1] !== "") lines.push("");
  return lines.join(eol);
}

/** @deprecated use insertUnderHeading(raw, "Tasks", line) */
/** Replace the body of `## heading` (up to the next level-1/2 heading), or append the section. */
export function replaceSection(raw: string, heading: string, body: string): string {
  const eol = detectEol(raw);
  const lines = splitLines(raw);
  const esc = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^##\\s+${esc}\\s*$`, "i");
  const bodyLines = body.replace(/\r/g, "").split("\n");
  const start = lines.findIndex((l) => re.test(l));
  if (start < 0) {
    while (lines.length && !lines[lines.length - 1]!.trim()) lines.pop();
    lines.push("", `## ${heading}`, ...bodyLines, "");
  } else {
    let end = start + 1;
    while (end < lines.length && !/^#{1,2}\s/.test(lines[end]!)) end++;
    lines.splice(start + 1, end - start - 1, ...bodyLines, "");
  }
  return lines.join(eol);
}

export const insertUnderTasksHeading = (raw: string, line: string) => insertUnderHeading(raw, "Tasks", line);

export { appendAnchor, removeAnchor };
