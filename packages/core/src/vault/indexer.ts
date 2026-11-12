import { and, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { noteLinks, notes, projects, tasks, type Task } from "../db/schema.js";
import { parseNote, splitLines, type ParsedNote, type ParsedTask } from "../markdown/parse.js";
import { appendAnchor, reconcileStatus, removeAnchor } from "../markdown/tasks.js";
import { anchorId, sha256, slugify, uuid } from "../util/hash.js";
import { KeyedLock } from "./lock.js";
import { Vault } from "./fs.js";

export interface IndexerOptions {
  /** Append `^oc-xxxx` block anchors to task lines that lack one. */
  writeAnchors: boolean;
  logger?: Pick<Console, "info" | "warn" | "error">;
}

export type IndexResult = "unchanged" | "indexed" | "removed" | "skipped";

const PROJECT_TAG = "project/";

/** How long a removed anchored task can be "resurrected" by its anchor reappearing (cut/paste, file rename). */
const GRAVEYARD_TTL_MS = 10 * 60_000;

export class VaultIndexer {
  /** One queue for the whole vault: see KeyedLock. Write-back and creation share it too. */
  readonly lock = new KeyedLock({ global: true });
  /** anchor → recently removed task row. In-memory on purpose: it only has to bridge seconds/minutes. */
  private graveyard = new Map<string, { task: Task; at: number }>();
  private log: Pick<Console, "info" | "warn" | "error">;

  constructor(
    readonly db: DB,
    readonly vault: Vault,
    readonly opts: IndexerOptions,
  ) {
    this.log = opts.logger ?? console;
  }

  /** Index every markdown file and drop DB notes whose files disappeared. */
  async fullScan(): Promise<{ indexed: number; removed: number }> {
    const files = await this.vault.listMarkdown();
    let indexed = 0;
    for (const rel of files) {
      if ((await this.indexFile(rel)) === "indexed") indexed++;
    }
    const present = new Set(files);
    const stale = this.db
      .select({ path: notes.path })
      .from(notes)
      .all()
      .filter((n) => !present.has(n.path));
    for (const n of stale) await this.removeFile(n.path);
    return { indexed, removed: stale.length };
  }

  async indexFile(rel: string): Promise<IndexResult> {
    if (!Vault.isMarkdown(rel)) return "skipped";
    return this.lock.run(rel, () => this.indexFileUnlocked(rel));
  }

  /** Caller must hold `lock` for `rel`. */
  async indexFileUnlocked(rel: string): Promise<IndexResult> {
    let raw: string;
    try {
      raw = await this.vault.read(rel);
    } catch {
      return this.removeFileUnlocked(rel);
    }
    let checksum = sha256(raw);
    const existingNote = this.db.select().from(notes).where(eq(notes.path, rel)).get();
    if (existingNote && existingNote.checksum === checksum) return "unchanged";

    let parsed = parseNote(rel, raw);
    const noteId = existingNote?.id ?? uuid();
    const existingTasks = existingNote
      ? this.db.select().from(tasks).where(eq(tasks.noteId, noteId)).all()
      : [];
    // Anchors must stay unique. Resolve duplicates (copy-paste) and tasks moved in from other notes.
    const { adopted, reanchor } = await this.resolveAnchorCollisions(parsed.tasks, noteId);
    const resurrected = this.takeFromGraveyard(parsed.tasks, [...existingTasks, ...adopted]);
    existingTasks.push(...adopted, ...resurrected);
    const matches = matchTasks(parsed.tasks, existingTasks);

    // Stamp anchors onto lines that lack them (or need a fresh one), then write the file back once.
    if (this.opts.writeAnchors && parsed.tasks.some((t) => !t.anchor)) {
      const lines = splitLines(raw);
      for (const t of parsed.tasks) {
        if (t.anchor) continue;
        const reuse = reanchor.has(t.ordinal) ? undefined : matches.get(t.ordinal)?.anchor;
        t.anchor = reuse ?? anchorId();
        lines[t.line] = appendAnchor(removeAnchor(lines[t.line]!), t.anchor);
        t.rawLine = lines[t.line]!;
      }
      const updated = lines.join(parsed.eol);
      // Only write if the file hasn't changed underneath us.
      if (sha256(await this.vault.read(rel)) === checksum) {
        await this.vault.writeAtomic(rel, updated);
        raw = updated;
        checksum = sha256(raw);
        parsed = parseNote(rel, raw);
        for (const t of parsed.tasks) if (reanchor.has(t.ordinal) && !this.opts.writeAnchors) t.anchor = undefined;
      } else {
        this.log.warn(`[indexer] ${rel} changed during anchoring; will retry on next event`);
        return "skipped";
      }
    }

    this.persist(rel, noteId, raw, checksum, parsed, existingTasks, !!existingNote, new Set(resurrected.map((t) => t.id)));
    return "indexed";
  }

  private bury(rows: Task[]): void {
    const now = Date.now();
    for (const [k, v] of this.graveyard) if (now - v.at > GRAVEYARD_TTL_MS) this.graveyard.delete(k);
    for (const t of rows) if (t.anchor) this.graveyard.set(t.anchor, { task: t, at: now });
  }

  /** Anchors in `parsed` that no live task owns but a recently removed one did. */
  private takeFromGraveyard(parsed: ParsedTask[], known: Task[]): Task[] {
    const knownAnchors = new Set(known.map((t) => t.anchor).filter(Boolean));
    const out: Task[] = [];
    for (const p of parsed) {
      if (!p.anchor || knownAnchors.has(p.anchor)) continue;
      const g = this.graveyard.get(p.anchor);
      if (!g || Date.now() - g.at > GRAVEYARD_TTL_MS) continue;
      const live = this.db.select({ id: tasks.id }).from(tasks).where(eq(tasks.anchor, p.anchor)).get();
      if (live) continue;
      this.graveyard.delete(p.anchor);
      out.push(g.task);
    }
    return out;
  }

  /**
   * - The same anchor twice in one file (copy-paste): later copies lose it and get a fresh one.
   * - An anchor owned by a task in another note:
   *     still present in that note's file → it's a copy → ours gets a fresh anchor;
   *     gone from that file → the line was moved here → adopt the task (keeps id, remarks, progress).
   * Mutates `parsed` (clears anchors that must be replaced).
   */
  private async resolveAnchorCollisions(parsed: ParsedTask[], noteId: string): Promise<{ adopted: Task[]; reanchor: Set<number> }> {
    const reanchor = new Set<number>();
    const seen = new Set<string>();
    for (const t of parsed) {
      if (!t.anchor) continue;
      if (seen.has(t.anchor)) {
        t.anchor = undefined;
        reanchor.add(t.ordinal);
      } else seen.add(t.anchor);
    }
    if (!seen.size) return { adopted: [], reanchor };
    const foreign = this.db
      .select()
      .from(tasks)
      .where(and(inArray(tasks.anchor, [...seen]), or(isNull(tasks.noteId), ne(tasks.noteId, noteId))))
      .all();
    const adopted: Task[] = [];
    for (const f of foreign) {
      const other = f.noteId ? this.db.select({ path: notes.path }).from(notes).where(eq(notes.id, f.noteId)).get() : undefined;
      let stillThere = false;
      if (other) {
        try {
          const re = new RegExp(`\\s\\^${f.anchor!.replace(/[^A-Za-z0-9-]/g, "")}\\s*$`, "m");
          stillThere = re.test(await this.vault.read(other.path));
        } catch {
          stillThere = false; // file gone → treat as moved
        }
      }
      const p = parsed.find((t) => t.anchor === f.anchor)!;
      if (stillThere) {
        p.anchor = undefined;
        reanchor.add(p.ordinal);
      } else {
        adopted.push(f);
      }
    }
    return { adopted, reanchor };
  }

  async removeFile(rel: string): Promise<IndexResult> {
    return this.lock.run(rel, () => this.removeFileUnlocked(rel));
  }

  private async removeFileUnlocked(rel: string): Promise<IndexResult> {
    const n = this.db.select({ id: notes.id }).from(notes).where(eq(notes.path, rel)).get();
    if (!n) return "unchanged";
    this.bury(this.db.select().from(tasks).where(eq(tasks.noteId, n.id)).all());
    this.db.delete(notes).where(eq(notes.id, n.id)).run(); // cascades tasks + outgoing links
    return "removed";
  }

  private persist(
    rel: string,
    noteId: string,
    raw: string,
    checksum: string,
    parsed: ParsedNote,
    existingTasks: Task[],
    noteExists: boolean,
    resurrect: Set<string> = new Set(),
  ): void {
    const nowIso = new Date().toISOString();
    const matches = matchTasks(parsed.tasks, existingTasks);

    this.db.transaction((tx) => {
      // --- note ---
      const noteRow = {
        title: parsed.title,
        path: rel,
        frontmatter: parsed.frontmatter,
        content: raw,
        checksum,
        updatedAt: nowIso,
      };
      if (noteExists) tx.update(notes).set(noteRow).where(eq(notes.id, noteId)).run();
      else tx.insert(notes).values({ id: noteId, ...noteRow }).run();

      // --- project from frontmatter ---
      const fmProject = typeof parsed.frontmatter.project === "string" ? parsed.frontmatter.project : undefined;
      const noteProjectId = fmProject ? ensureProject(tx, fmProject) : null;

      // --- tasks ---
      const idByOrdinal = new Map<number, string>();
      for (const t of parsed.tasks) idByOrdinal.set(t.ordinal, matches.get(t.ordinal)?.id ?? uuid());

      const keep = new Set<string>();
      for (const t of parsed.tasks) {
        const prev = matches.get(t.ordinal);
        const id = idByOrdinal.get(t.ordinal)!;
        keep.add(id);
        const projectTag = t.tags.find((x) => x.startsWith(PROJECT_TAG));
        const projectId = projectTag ? ensureProject(tx, projectTag.slice(PROJECT_TAG.length)) : noteProjectId;
        const status = reconcileStatus(t.status, prev?.status);
        const completedAt =
          status === "done"
            ? (prev?.status === "done" && prev.completedAt) || (t.doneDate ? `${t.doneDate}T12:00:00.000Z` : nowIso)
            : null;
        const row = {
          noteId,
          projectId,
          parentTaskId: t.parentOrdinal !== undefined ? idByOrdinal.get(t.parentOrdinal)! : null,
          title: t.title || "(untitled)",
          status,
          priority: t.priority ?? 4,
          dueDate: t.dueDate ?? null,
          dueTime: t.dueTime ?? null,
          tags: t.tags,
          recurrence: t.recurrence ?? null,
          anchor: t.anchor ?? null,
          lineNumber: t.line,
          rawLine: t.rawLine,
          ordinal: t.ordinal,
          completedAt,
          updatedAt: nowIso,
        };
        if (prev && resurrect.has(id)) {
          // Re-insert a recently removed task with its id and DB-only state.
          const { id: _i, noteId: _n, ...state } = prev;
          tx.insert(tasks).values({ ...state, id, ...row }).run();
        } else if (prev) tx.update(tasks).set(row).where(eq(tasks.id, id)).run();
        else tx.insert(tasks).values({ id, ...row }).run();
      }
      const candidates = existingTasks.filter((t) => !keep.has(t.id) && !resurrect.has(t.id));
      if (candidates.length) {
        // Defence in depth: only delete rows that (still) belong to this note.
        const removedRows = tx
          .select()
          .from(tasks)
          .where(and(inArray(tasks.id, candidates.map((t) => t.id)), eq(tasks.noteId, noteId)))
          .all();
        if (removedRows.length) {
          this.bury(removedRows);
          tx.delete(tasks).where(inArray(tasks.id, removedRows.map((t) => t.id))).run();
        }
      }

      // --- links ---
      tx.delete(noteLinks).where(eq(noteLinks.sourceNoteId, noteId)).run();
      for (const l of parsed.links) {
        const target = tx
          .select({ id: notes.id })
          .from(notes)
          .where(sql`lower(${notes.title}) = lower(${l.target})`)
          .get();
        tx.insert(noteLinks)
          .values({ id: uuid(), sourceNoteId: noteId, targetTitle: l.target, heading: l.heading ?? null, targetNoteId: target?.id ?? null })
          .run();
      }
      // Resolve dangling links elsewhere that point at this note's title.
      tx.update(noteLinks)
        .set({ targetNoteId: noteId })
        .where(and(isNull(noteLinks.targetNoteId), sql`lower(${noteLinks.targetTitle}) = lower(${parsed.title})`))
        .run();
    });
  }
}

type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];

function ensureProject(tx: Tx, nameOrSlug: string): string {
  const slug = slugify(nameOrSlug);
  const found = tx.select({ id: projects.id }).from(projects).where(eq(projects.slug, slug)).get();
  if (found) return found.id;
  const id = uuid();
  tx.insert(projects).values({ id, slug, title: nameOrSlug }).run();
  return id;
}

/**
 * Match freshly parsed tasks to existing DB rows so IDs (and DB-only state like
 * remarks and rollover counts) survive edits. Priority: anchor → exact line → title.
 */
export function matchTasks(parsed: ParsedTask[], existing: Task[]): Map<number, Task> {
  const result = new Map<number, Task>();
  const pool = new Set(existing);
  const take = (t: Task | undefined, ordinal: number) => {
    if (!t) return;
    result.set(ordinal, t);
    pool.delete(t);
  };

  const byAnchor = new Map(existing.filter((t) => t.anchor).map((t) => [t.anchor!, t]));
  for (const p of parsed) if (p.anchor) take(byAnchor.get(p.anchor), p.ordinal);

  for (const p of parsed) {
    if (result.has(p.ordinal)) continue;
    take([...pool].find((t) => t.rawLine === p.rawLine), p.ordinal);
  }
  for (const p of parsed) {
    if (result.has(p.ordinal) || p.anchor) continue;
    const candidates = [...pool].filter((t) => !t.anchor && t.title === p.title);
    candidates.sort((a, b) => Math.abs((a.ordinal ?? 0) - p.ordinal) - Math.abs((b.ordinal ?? 0) - p.ordinal));
    take(candidates[0], p.ordinal);
  }
  return result;
}
