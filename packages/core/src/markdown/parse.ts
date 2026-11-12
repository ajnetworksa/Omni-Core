import matter from "gray-matter";
import { posix } from "node:path";
import type { TaskStatus } from "../db/schema.js";
import { parseTaskText, statusFromChar, TASK_LINE_RE, type TaskMeta } from "./tasks.js";

export interface ParsedTask extends TaskMeta {
  /** 0-based line index in the full file (frontmatter included). */
  line: number;
  rawLine: string;
  status: TaskStatus;
  indent: number;
  /** Order among tasks in this file. */
  ordinal: number;
  /** Ordinal of the parent task, if nested. */
  parentOrdinal?: number;
}

export interface ParsedLink {
  target: string;
  heading?: string;
  line: number;
}

export interface ParsedNote {
  title: string;
  frontmatter: Record<string, unknown>;
  body: string;
  tasks: ParsedTask[];
  links: ParsedLink[];
  eol: "\n" | "\r\n";
}

const LINK_RE = /!?\[\[([^\]|#^\n]+)(?:#([^\]|\n]+))?(?:\|[^\]\n]*)?\]\]/g;
const FENCE_RE = /^\s*(```|~~~)/;

export function detectEol(raw: string): "\n" | "\r\n" {
  return raw.includes("\r\n") ? "\r\n" : "\n";
}

export function splitLines(raw: string): string[] {
  return raw.split(/\r?\n/);
}

function indentWidth(ws: string): number {
  let w = 0;
  for (const c of ws) w += c === "\t" ? 4 : 1;
  return w;
}

/** Returns the number of leading lines occupied by a YAML frontmatter block (0 if none). */
export function frontmatterLineCount(lines: string[]): number {
  if (lines[0]?.trim() !== "---") return 0;
  for (let i = 1; i < lines.length; i++) {
    const l = lines[i]!.trim();
    if (l === "---" || l === "...") return i + 1;
  }
  return 0;
}

export function noteTitleFromPath(relPath: string): string {
  return posix.basename(relPath).replace(/\.md$/i, "");
}

export function parseNote(relPath: string, raw: string): ParsedNote {
  let frontmatter: Record<string, unknown> = {};
  let body = raw;
  try {
    const fm = matter(raw);
    frontmatter = normaliseFrontmatter(fm.data);
    body = fm.content;
  } catch {
    // Malformed YAML: treat the whole file as body rather than failing the index.
  }

  const lines = splitLines(raw);
  const start = frontmatterLineCount(lines);
  const tasks: ParsedTask[] = [];
  const links: ParsedLink[] = [];
  const stack: { indent: number; ordinal: number }[] = [];
  let inFence = false;

  for (let i = start; i < lines.length; i++) {
    const line = lines[i]!;
    if (FENCE_RE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    for (const m of line.matchAll(LINK_RE)) {
      links.push({ target: m[1]!.trim(), heading: m[2]?.trim() || undefined, line: i });
    }

    const tm = line.match(TASK_LINE_RE);
    if (!tm) {
      // A non-blank, non-indented line ends any list nesting.
      if (line.trim() !== "" && !/^\s/.test(line)) stack.length = 0;
      continue;
    }
    const indent = indentWidth(tm[1]!);
    while (stack.length && stack[stack.length - 1]!.indent >= indent) stack.pop();
    const ordinal = tasks.length;
    const meta = parseTaskText(tm[4]!);
    tasks.push({
      ...meta,
      line: i,
      rawLine: line,
      status: statusFromChar(tm[3]!),
      indent,
      ordinal,
      parentOrdinal: stack[stack.length - 1]?.ordinal,
    });
    stack.push({ indent, ordinal });
  }

  const fmTitle = typeof frontmatter.title === "string" ? frontmatter.title.trim() : "";
  return {
    title: fmTitle || noteTitleFromPath(relPath),
    frontmatter,
    body,
    tasks,
    links,
    eol: detectEol(raw),
  };
}

/** gray-matter yields Date objects for YAML dates; store them as ISO strings so JSON round-trips. */
function normaliseFrontmatter(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    out[k] = v instanceof Date ? v.toISOString() : v;
  }
  return out;
}
