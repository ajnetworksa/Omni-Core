import type { TaskStatus } from "../db/schema.js";
import { addDays, ISO_DATE_RE, todayInTz } from "../util/time.js";

/**
 * Task line grammar (Obsidian / Obsidian-Tasks compatible):
 *   <indent><bullet> [<char>] <text> [!p1..4] [📅 YYYY-MM-DD [HH:mm]] [#tag ...] [^anchor]
 * bullet: -, *, +, or "1." / "1)"
 */
export const TASK_LINE_RE = /^(\s*)([-*+]|\d+[.)])\s+\[(.)\]\s+(.*)$/;
const ANCHOR_RE = /\s+\^([A-Za-z0-9-]+)\s*$/;
const PRIORITY_RE = /(?:^|\s)!p([1-4])(?=\s|$)/i;
const DUE_RE = /(?:^|\s)(?:📅|@)\s?(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}))?(?=\s|$)/u;
const TAG_RE = /(?:^|\s)#([\p{L}\p{N}_/-]+)/gu;
/** Obsidian Tasks completion date. */
const DONE_RE = /(?:^|\s)✅\s?(\d{4}-\d{2}-\d{2})(?=\s|$)/u;
/** Obsidian Tasks recurrence: text after 🔁 up to the next signifier. */
const RECUR_RE = /(?:^|\s)🔁\s*(every(?:\s+[a-z0-9,]+)+?)(?=\s+(?:📅|⏳|🛫|✅|#|\^|!p[1-4]|@\d)|\s*$)/iu;

/** Checkbox character → canonical status. Unknown chars are treated as "done" (Obsidian renders them checked). */
export function statusFromChar(ch: string): TaskStatus {
  switch (ch) {
    case " ":
      return "ready";
    case "/":
      return "in_progress";
    case "-":
      return "cancelled";
    case "!":
      return "blocked";
    default:
      return "done"; // x, X, and any other custom marker
  }
}

/** Canonical status → checkbox character written to disk. */
export function charFromStatus(status: TaskStatus): string {
  switch (status) {
    case "done":
      return "x";
    case "in_progress":
      return "/";
    case "cancelled":
      return "-";
    case "blocked":
      return "!";
    default:
      return " "; // backlog, ready
  }
}

/**
 * Markdown can't distinguish backlog from ready. When the file says "open" and the DB
 * holds a finer-grained open status, keep the DB's.
 */
export function reconcileStatus(fromFile: TaskStatus, inDb: TaskStatus | undefined): TaskStatus {
  if (fromFile === "ready" && (inDb === "backlog" || inDb === "ready")) return inDb;
  return fromFile;
}

export interface TaskMeta {
  title: string;
  priority?: number;
  dueDate?: string;
  dueTime?: string;
  tags: string[];
  anchor?: string;
  recurrence?: string;
  doneDate?: string;
}

/** Extracts inline metadata from the text portion of a task line. */
export function parseTaskText(text: string): TaskMeta {
  let rest = text;
  let anchor: string | undefined;
  const a = rest.match(ANCHOR_RE);
  if (a) {
    anchor = a[1];
    rest = rest.slice(0, a.index);
  }
  let priority: number | undefined;
  const p = rest.match(PRIORITY_RE);
  if (p) {
    priority = Number(p[1]);
    rest = rest.replace(PRIORITY_RE, " ");
  }
  let dueDate: string | undefined;
  let dueTime: string | undefined;
  const d = rest.match(DUE_RE);
  if (d) {
    dueDate = d[1];
    dueTime = d[2];
    rest = rest.replace(DUE_RE, " ");
  }
  let doneDate: string | undefined;
  const dn = rest.match(DONE_RE);
  if (dn) {
    doneDate = dn[1];
    rest = rest.replace(DONE_RE, " ");
  }
  let recurrence: string | undefined;
  const rc = rest.match(RECUR_RE);
  if (rc) {
    recurrence = rc[1]!.trim().toLowerCase();
    rest = rest.replace(RECUR_RE, " ");
  }
  const tags = [...rest.matchAll(TAG_RE)].map((m) => m[1]!);
  const title = rest.replace(TAG_RE, " ").replace(/\s+/g, " ").trim();
  return { title, priority, dueDate, dueTime, tags, anchor, recurrence, doneDate };
}

/** Replace only the checkbox character, leaving every other byte of the line untouched. */
export function setLineCheckbox(line: string, ch: string): string {
  const m = line.match(TASK_LINE_RE);
  if (!m) throw new Error(`Not a task line: ${line}`);
  const prefixLen = line.indexOf("[", m[1]!.length + m[2]!.length);
  return line.slice(0, prefixLen + 1) + ch + line.slice(prefixLen + 2);
}

export function appendAnchor(line: string, anchor: string): string {
  if (ANCHOR_RE.test(line)) return line;
  return `${line.replace(/\s+$/, "")} ^${anchor}`;
}

/**
 * Quick-add syntax used by Telegram `/todo` and the web quick-capture box.
 *   "Order SFP modules !p1 @today #network"
 *   "Call ISP @tomorrow 14:30"
 * Relative dates are resolved here so the file always stores an absolute date.
 */
export function parseQuickAdd(input: string, timeZone: string, now = new Date()): TaskMeta {
  const today = todayInTz(timeZone, now);
  const resolved = input
    .replace(/(^|\s)@today\b/i, `$1📅 ${today}`)
    .replace(/(^|\s)@tomorrow\b/i, `$1📅 ${addDays(today, 1)}`)
    .replace(/(^|\s)@\+(\d{1,3})d\b/i, (_m, sp: string, n: string) => `${sp}📅 ${addDays(today, Number(n))}`);
  const meta = parseTaskText(resolved);
  if (meta.dueDate && !ISO_DATE_RE.test(meta.dueDate)) meta.dueDate = undefined;
  return meta;
}

/**
 * A list typed or pasted into the task box becomes one task per item:
 *   "1. Buy milk 2. Call ISP @tomorrow"      → ["Buy milk", "Call ISP @tomorrow"]
 *   "1 buy milk 2 call ISP"                  → ["buy milk", "call ISP"]   (numbers must run 1, 2, 3…)
 *   "Groceries:\n- milk\n- eggs"              → ["milk", "eggs"]           (a "…:" header line is dropped)
 *   any text on several lines               → one task per line
 * Anything else comes back as a single item, unchanged. Each item keeps its own @date / !p / #tags.
 */
export function splitTaskList(input: string, max = MAX_LIST_ITEMS): string[] {
  const text = input.trim();
  if (!text) return [];
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let items: string[] | null = null;
  if (lines.length >= 2) {
    const body = /:$/.test(lines[0]!) && !LIST_MARK.test(lines[0]!) ? lines.slice(1) : lines;
    // Bare "1 milk / 2 eggs" numbering only counts when every line carries the next number.
    const bare = body.length >= 2 && body.every((l, i) => new RegExp(`^${i + 1}\\s+\\S`).test(l));
    items = body.map((l) => (bare ? l.replace(/^\d+\s+/, "") : l.replace(LIST_MARK, "")).trim());
  } else {
    items = splitInlineNumbers(text);
  }
  const out = (items ?? [text]).filter(Boolean);
  return out.length ? out.slice(0, max) : [text];
}
export const MAX_LIST_ITEMS = 30;
/** "1." "2)" "3-" "- " "* " "• " "[ ] " "- [ ] " at the start of a line. */
const LIST_MARK = /^(?:\d{1,3}[.)-]\s+|-\s+\[[ xX]?\]\s+|\[[ xX]?\]\s+|[-*•–]\s+)/;

/** "1. a 2. b 3. c" / "1) a 2) b" / "1 a 2 b" on one line. Needs at least two items, numbered in order. */
function splitInlineNumbers(text: string): string[] | null {
  // "1." / "1)" may be followed directly by the text ("1.milk"), but not by a digit ("1.5 kg").
  const start = text.match(/^1([.)-])\s*(?=[^\s\d])/) ?? text.match(/^1()\s+(?=\S)/);
  if (!start) return null;
  const sep = start[1] ? `\\${start[1]}\\s*(?=[^\\s\\d])` : "\\s+(?=\\S)";
  const items: string[] = [];
  let rest = text.slice(start[0].length);
  for (let n = 2; n <= MAX_LIST_ITEMS + 1; n++) {
    const next = new RegExp(`\\s${n}${sep}`).exec(rest);
    if (!next) break;
    items.push(rest.slice(0, next.index).trim());
    rest = rest.slice(next.index + next[0].length);
  }
  if (!items.length) return null;
  items.push(rest.trim());
  return items;
}

/** One-line, control-character-free text: anything multi-line would become extra markdown lines. */
export function singleLine(text: string): string {
  return text.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim();
}

/** Renders a task back into a markdown line (used when creating tasks from the app). */
export function renderTaskLine(t: {
  title: string;
  status?: TaskStatus;
  priority?: number;
  dueDate?: string | null;
  dueTime?: string | null;
  tags?: string[];
  anchor?: string | null;
  indent?: string;
  recurrence?: string | null;
  doneDate?: string | null;
}): string {
  const parts = [singleLine(t.title)];
  if (t.priority && t.priority < 4) parts.push(`!p${t.priority}`);
  if (t.recurrence) parts.push(`🔁 ${t.recurrence}`);
  if (t.dueDate) parts.push(`📅 ${t.dueDate}${t.dueTime ? ` ${t.dueTime}` : ""}`);
  if (t.doneDate) parts.push(`✅ ${t.doneDate}`);
  for (const tag of t.tags ?? []) parts.push(`#${singleLine(tag).replace(/\s/g, "-")}`);
  if (t.anchor) parts.push(`^${t.anchor}`);
  return `${t.indent ?? ""}- [${charFromStatus(t.status ?? "ready")}] ${parts.join(" ")}`;
}

/** Add or replace the `✅ YYYY-MM-DD` completion token, keeping the rest of the line intact. */
export function setDoneToken(line: string, date: string): string {
  const cleaned = removeDoneToken(line);
  const a = cleaned.match(ANCHOR_RE);
  if (a) return `${cleaned.slice(0, a.index)} ✅ ${date}${cleaned.slice(a.index)}`;
  return `${cleaned.replace(/\s+$/, "")} ✅ ${date}`;
}

export function removeDoneToken(line: string): string {
  return line.replace(/\s✅\s?\d{4}-\d{2}-\d{2}(?=\s|$)/u, "");
}

/** Strip a block anchor (used when cloning a line for the next recurrence). */
export function removeAnchor(line: string): string {
  return line.replace(ANCHOR_RE, "");
}
