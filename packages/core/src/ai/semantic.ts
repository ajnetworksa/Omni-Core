/**
 * Semantic index over the vault: notes are split into heading-scoped chunks, tasks get one
 * chunk each (title, status, dates, project, remarks). Only notes/tasks whose content hash
 * changed are re-embedded, so the periodic sync is cheap.
 */
import { createRequire } from "node:module";
import { addDays, todayInTz, isoDateInTz } from "../util/time.js";
import { sha256 } from "../util/hash.js";
import { splitLines, frontmatterLineCount } from "../markdown/parse.js";
import type { DB } from "../db/client.js";
import type { AiClient } from "./client.js";

export interface Chunk {
  heading: string | null;
  text: string;
}

const MAX_CHARS = 900;
const TASK_TOKENS_RE = /\s(?:\^oc-[a-z0-9]+|\^[A-Za-z0-9-]+$)|(?:✅|📅|⏳|🛫|➕)\s\d{4}-\d{2}-\d{2}(?:\s\d{2}:\d{2})?/g;

/**
 * Split a note into heading-scoped chunks of at most ~900 characters. With `skipTasks`,
 * checkbox lines are left out: each task gets its own richer chunk in the index.
 */
export function chunkMarkdown(raw: string, opts: { skipTasks?: boolean } = {}): Chunk[] {
  const lines = splitLines(raw);
  const body = lines.slice(frontmatterLineCount(lines));
  const sections: { heading: string | null; level: number; lines: string[] }[] = [{ heading: null, level: 0, lines: [] }];
  let inFence = false;
  for (const line of body) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    const h = !inFence && line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (h) sections.push({ heading: h[2]!, level: h[1]!.length, lines: [] });
    else if (!(opts.skipTasks && !inFence && /^\s*(?:[-*+]|\d+[.)])\s+\[.\]\s/.test(line))) sections.at(-1)!.lines.push(line.replace(TASK_TOKENS_RE, ""));
  }
  const out: Chunk[] = [];
  for (const s of sections) {
    const paras = s.lines.join("\n").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
    let buf = "";
    const flush = () => {
      if (buf.trim()) out.push({ heading: s.heading, text: buf.trim() });
      buf = "";
    };
    for (let p of paras) {
      while (p.length > MAX_CHARS) {
        // Hard-split very long paragraphs at a sentence or word boundary.
        const cut = Math.max(p.lastIndexOf(". ", MAX_CHARS), p.lastIndexOf(" ", MAX_CHARS), MAX_CHARS / 2);
        flush();
        buf = p.slice(0, cut + 1);
        flush();
        p = p.slice(cut + 1).trim();
      }
      if (buf.length + p.length + 2 > MAX_CHARS) flush();
      buf += (buf ? "\n\n" : "") + p;
    }
    flush();
    // A heading with no body still says something ("## Decided: replace the core switch"),
    // but a note's # title (already in every chunk) and generic names like "Tasks" or "Log" don't.
    if (!paras.length && s.heading && s.level > 1 && !/^(tasks?|to-?dos?|log|notes?|inbox)$/i.test(s.heading.trim())) out.push({ heading: s.heading, text: s.heading });
  }
  return out;
}

export interface SemanticHit {
  chunkId: number;
  source: "note" | "task";
  noteId: string | null;
  taskId: string | null;
  heading: string | null;
  text: string;
  day: string | null;
  score: number;
}

export interface SearchFilter {
  since?: string;
  until?: string;
}

export interface SyncResult {
  embedded: number;
  removed: number;
  skipped: number;
  total: number;
}

type ChunkRow = { id: number; vector: Uint8Array };

/** Prefixes that nomic-embed-text / e5-style models expect; harmless for others. */
function prefixFor(model: string, kind: "query" | "doc"): string {
  if (/nomic/i.test(model)) return kind === "query" ? "search_query: " : "search_document: ";
  if (/\be5\b|multilingual-e5/i.test(model)) return kind === "query" ? "query: " : "passage: ";
  return "";
}

const toBlob = (v: Float32Array) => new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
const fromBlob = (b: Uint8Array) => new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));

export class SemanticIndex {
  /** "sqlite-vec" when the extension loaded, else "js". */
  readonly engine: "sqlite-vec" | "js";
  private cache?: { ids: number[]; vecs: Float32Array[] };
  private running?: Promise<SyncResult>;
  private dims?: number;
  lastSync?: { at: string; result?: SyncResult; error?: string };

  constructor(
    private db: DB,
    private ai: AiClient,
    private timeZone: string,
    opts: { vector?: "auto" | "js" } = {},
  ) {
    this.engine = opts.vector !== "js" && loadSqliteVec(db) ? "sqlite-vec" : "js";
    const d = this.meta("dims");
    if (d) this.dims = Number(d);
  }

  private get sql() {
    return this.db.$client;
  }
  private meta(key: string): string | undefined {
    return (this.sql.prepare("SELECT value FROM ai_meta WHERE key = ?").get(key) as { value: string } | undefined)?.value;
  }
  private setMeta(key: string, value: string) {
    this.sql.prepare("INSERT INTO ai_meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
  }

  stats() {
    const n = this.sql.prepare("SELECT count(*) c FROM ai_chunks").get() as { c: number };
    return { engine: this.engine, chunks: Number(n.c), model: this.meta("model") ?? null, dims: this.dims ?? null, lastSync: this.lastSync ?? null };
  }

  private ensureVecTable(dims: number) {
    if (this.engine !== "sqlite-vec") return;
    this.sql.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS vec_chunks USING vec0(embedding float[${dims}] distance_metric=cosine)`);
  }

  /** Wipe everything when the embedding model (or its dimensions) changes. */
  private reset() {
    this.sql.exec("DELETE FROM ai_chunks; DELETE FROM ai_sources; DELETE FROM ai_meta WHERE key IN ('model','dims');");
    if (this.engine === "sqlite-vec") this.sql.exec("DROP TABLE IF EXISTS vec_chunks");
    this.dims = undefined;
    this.cache = undefined;
  }

  /** Re-embed what changed since the last run. Concurrent calls share one run. */
  sync(): Promise<SyncResult> {
    if (!this.running) {
      this.running = this.doSync()
        .then((r) => {
          this.lastSync = { at: new Date().toISOString(), result: r };
          return r;
        })
        .catch((e: unknown) => {
          this.lastSync = { at: new Date().toISOString(), error: (e as Error).message };
          throw e;
        })
        .finally(() => (this.running = undefined));
    }
    return this.running;
  }

  private async doSync(): Promise<SyncResult> {
    const model = this.ai.settings.embedModel;
    if (this.meta("model") && this.meta("model") !== model) this.reset();

    const want = new Map<string, { hash: string; build: () => { chunks: Chunk[]; noteId?: string; taskId?: string; day: string | null; source: "note" | "task" } }>();

    const noteRows = this.sql.prepare("SELECT id, title, path, content, checksum, updated_at FROM notes").all() as {
      id: string; title: string; path: string; content: string; checksum: string; updated_at: string;
    }[];
    for (const n of noteRows) {
      const day = n.path.match(/(\d{4}-\d{2}-\d{2})/)?.[1] ?? isoDateInTz(new Date(n.updated_at), this.timeZone);
      want.set(`note:${n.id}`, {
        hash: sha256(`${model}\n${n.title}\n${n.checksum}`),
        build: () => ({
          source: "note",
          noteId: n.id,
          day,
          chunks: chunkMarkdown(n.content, { skipTasks: true }).map((c) => ({ heading: c.heading, text: `${n.title}${c.heading ? ` › ${c.heading}` : ""}\n${c.text}` })),
        }),
      });
    }

    const taskRows = this.sql
      .prepare(
        `SELECT t.id, t.title, t.status, t.due_date, t.completed_at, t.created_at, t.remarks, t.tags, t.note_id,
                p.title AS project, n.title AS note_title
           FROM tasks t LEFT JOIN projects p ON p.id = t.project_id LEFT JOIN notes n ON n.id = t.note_id`,
      )
      .all() as {
      id: string; title: string; status: string; due_date: string | null; completed_at: string | null; created_at: string;
      remarks: string; tags: string; note_id: string | null; project: string | null; note_title: string | null;
    }[];
    for (const t of taskRows) {
      const done = t.completed_at ? isoDateInTz(new Date(t.completed_at), this.timeZone) : null;
      const remarks = (JSON.parse(t.remarks || "[]") as { at: string; text: string }[]).map((r) => r.text);
      const lines = [
        `Task: ${t.title}`,
        `Status: ${t.status.replace("_", " ")}${done ? ` (completed ${done})` : t.due_date ? ` (due ${t.due_date})` : ""}`,
        t.project ? `Project: ${t.project}` : "",
        t.note_title ? `In note: ${t.note_title}` : "",
        remarks.length ? `Remarks: ${remarks.join(" · ")}` : "",
      ].filter(Boolean);
      const text = lines.join("\n");
      want.set(`task:${t.id}`, {
        hash: sha256(`${model}\n${text}`),
        build: () => ({ source: "task", taskId: t.id, noteId: t.note_id ?? undefined, day: done ?? t.due_date ?? isoDateInTz(new Date(t.created_at), this.timeZone), chunks: [{ heading: null, text }] }),
      });
    }

    const have = new Map((this.sql.prepare("SELECT key, hash FROM ai_sources").all() as { key: string; hash: string }[]).map((r) => [r.key, r.hash]));
    let removed = 0;
    for (const key of have.keys()) {
      if (!want.has(key)) {
        removed += this.dropSource(key);
        this.sql.prepare("DELETE FROM ai_sources WHERE key = ?").run(key);
      }
    }

    const todo = [...want].filter(([key, w]) => have.get(key) !== w.hash);
    let embedded = 0;
    const prefix = prefixFor(model, "doc");
    for (const [key, w] of todo) {
      const built = w.build();
      const vectors: Float32Array[] = [];
      for (let i = 0; i < built.chunks.length; i += 16) {
        vectors.push(...(await this.ai.embed(built.chunks.slice(i, i + 16).map((c) => prefix + c.text))));
      }
      if (vectors.length && !this.dims) {
        this.dims = vectors[0]!.length;
        this.setMeta("dims", String(this.dims));
        this.setMeta("model", model);
        this.ensureVecTable(this.dims);
      }
      if (vectors.some((v) => v.length !== this.dims)) {
        // The model changed dimensions under the same name; start over next run.
        this.reset();
        throw new Error("Embedding size changed; the index was cleared and will rebuild.");
      }
      this.sql.transaction(() => {
        this.dropSource(key);
        const ins = this.sql.prepare("INSERT INTO ai_chunks(source, note_id, task_id, heading, text, day, vector) VALUES (?, ?, ?, ?, ?, ?, ?)");
        const vec = this.engine === "sqlite-vec" ? this.sql.prepare("INSERT INTO vec_chunks(rowid, embedding) VALUES (?, ?)") : null;
        built.chunks.forEach((c, i) => {
          const r = ins.run(built.source, built.noteId ?? null, built.taskId ?? null, c.heading, c.text, built.day, toBlob(vectors[i]!));
          vec?.run(BigInt(r.lastInsertRowid), toBlob(vectors[i]!));
        });
        this.sql.prepare("INSERT INTO ai_sources(key, hash) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET hash = excluded.hash").run(key, w.hash);
      })();
      embedded++;
    }
    if (embedded || removed) this.cache = undefined;
    if (!this.meta("model") && want.size === 0) this.setMeta("model", model);
    return { embedded, removed, skipped: want.size - todo.length, total: want.size };
  }

  private dropSource(key: string): number {
    const [kind, id] = key.split(/:(.*)/s) as [string, string];
    const col = kind === "note" ? "note_id" : "task_id";
    const where = `source = '${kind === "note" ? "note" : "task"}' AND ${col} = ?`;
    const ids = (this.sql.prepare(`SELECT id FROM ai_chunks WHERE ${where}`).all(id) as { id: number }[]).map((r) => r.id);
    if (!ids.length) return 0;
    if (this.engine === "sqlite-vec") {
      const del = this.sql.prepare("DELETE FROM vec_chunks WHERE rowid = ?");
      for (const cid of ids) del.run(BigInt(cid));
    }
    this.sql.prepare(`DELETE FROM ai_chunks WHERE ${where}`).run(id);
    return ids.length;
  }

  async search(query: string, k = 10, filter: SearchFilter = {}): Promise<SemanticHit[]> {
    if (!this.dims) return [];
    const [q] = await this.ai.embed([prefixFor(this.ai.settings.embedModel, "query") + query], 20_000);
    if (!q || q.length !== this.dims) return [];
    const filtered = !!(filter.since || filter.until);
    let scored: { id: number; score: number }[];
    if (this.engine === "sqlite-vec") {
      const kk = Math.min(filtered ? Math.max(k * 20, 200) : k * 3, 4096);
      scored = (this.sql.prepare("SELECT rowid AS id, distance FROM vec_chunks WHERE embedding MATCH ? AND k = ? ORDER BY distance").all(toBlob(q), kk) as {
        id: number; distance: number;
      }[]).map((r) => ({ id: Number(r.id), score: 1 - r.distance }));
    } else {
      const c = this.loadCache();
      scored = c.ids.map((id, i) => {
        const v = c.vecs[i]!;
        let dot = 0;
        for (let j = 0; j < v.length; j++) dot += v[j]! * q[j]!;
        return { id, score: dot };
      });
      scored.sort((a, b) => b.score - a.score);
      scored = scored.slice(0, filtered ? 4096 : k * 3);
    }
    if (!scored.length) return [];
    const byId = new Map(scored.map((s) => [s.id, s.score]));
    const rows = this.sql
      .prepare(`SELECT id, source, note_id, task_id, heading, text, day FROM ai_chunks WHERE id IN (${scored.map(() => "?").join(",")})`)
      .all(...scored.map((s) => s.id)) as { id: number; source: "note" | "task"; note_id: string | null; task_id: string | null; heading: string | null; text: string; day: string | null }[];
    return rows
      .filter((r) => (!filter.since || (r.day ?? "") >= filter.since) && (!filter.until || (r.day ?? "9999") <= filter.until))
      .map((r) => ({ chunkId: Number(r.id), source: r.source, noteId: r.note_id, taskId: r.task_id, heading: r.heading, text: r.text, day: r.day, score: byId.get(Number(r.id)) ?? 0 }))
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }

  private loadCache() {
    if (!this.cache) {
      const rows = this.sql.prepare("SELECT id, vector FROM ai_chunks").all() as ChunkRow[];
      this.cache = { ids: rows.map((r) => Number(r.id)), vecs: rows.map((r) => fromBlob(r.vector)) };
    }
    return this.cache;
  }
}

/** Load sqlite-vec if it's installed for this platform, then turn extension loading off again. */
export function loadSqliteVec(db: DB): boolean {
  const native = db.$client.native as unknown as { loadExtension(p: string): void; enableLoadExtension?(on: boolean): void };
  try {
    const req = createRequire(import.meta.url);
    const sv = req("sqlite-vec") as { getLoadablePath(): string };
    native.loadExtension(sv.getLoadablePath());
    return true;
  } catch {
    return false;
  } finally {
    try {
      native.enableLoadExtension?.(false);
    } catch {
      /* opened without extension support */
    }
  }
}

/** "last quarter", "this week", "in March", "yesterday" → a date range, local to timeZone. */
export function parseTimeHint(q: string, timeZone: string, now = new Date()): (SearchFilter & { label: string }) | null {
  const today = todayInTz(timeZone, now);
  const [y, m] = today.split("-").map(Number) as [number, number];
  const ymd = (yy: number, mm: number, dd: number) => new Date(Date.UTC(yy, mm - 1, dd)).toISOString().slice(0, 10);
  const monthEnd = (yy: number, mm: number) => ymd(yy, mm + 1, 0);
  const s = q.toLowerCase();
  const dow = new Date(`${today}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  const weekStart = addDays(today, -((dow + 6) % 7)); // Monday
  if (/\btoday\b/.test(s)) return { since: today, until: today, label: "today" };
  if (/\byesterday\b/.test(s)) return { since: addDays(today, -1), until: addDays(today, -1), label: "yesterday" };
  if (/\bthis week\b/.test(s)) return { since: weekStart, until: today, label: "this week" };
  if (/\blast week\b/.test(s)) return { since: addDays(weekStart, -7), until: addDays(weekStart, -1), label: "last week" };
  if (/\bthis month\b/.test(s)) return { since: ymd(y, m, 1), until: today, label: "this month" };
  if (/\blast month\b/.test(s)) return { since: ymd(y, m - 1, 1), until: monthEnd(y, m - 1), label: "last month" };
  const q0 = Math.floor((m - 1) / 3) * 3 + 1;
  if (/\bthis quarter\b/.test(s)) return { since: ymd(y, q0, 1), until: today, label: "this quarter" };
  if (/\blast quarter\b/.test(s)) return { since: ymd(y, q0 - 3, 1), until: monthEnd(y, q0 - 1), label: "last quarter" };
  if (/\bthis year\b/.test(s)) return { since: ymd(y, 1, 1), until: today, label: "this year" };
  if (/\blast year\b/.test(s)) return { since: ymd(y - 1, 1, 1), until: ymd(y - 1, 12, 31), label: "last year" };
  const last = s.match(/\b(?:last|past)\s+(\d{1,3})\s+days?\b/);
  if (last) return { since: addDays(today, -Number(last[1])), until: today, label: `last ${last[1]} days` };
  const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
  const mm = s.match(new RegExp(`\\b(?:in|during|from)\\s+(${months.join("|")})\\b`));
  if (mm) {
    const idx = months.indexOf(mm[1]!) + 1;
    const yy = idx > m ? y - 1 : y;
    return { since: ymd(yy, idx, 1), until: monthEnd(yy, idx), label: `${mm[1]} ${yy}` };
  }
  return null;
}
