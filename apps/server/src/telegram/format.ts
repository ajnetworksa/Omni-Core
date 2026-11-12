import type { ReminderPayload, Task, todayView } from "@omnicore/core";
import { InlineKeyboard } from "grammy";

/** Pure message formatting (HTML parse mode) — kept free of I/O so it's easy to test. */

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function relative(from: Date, to: Date): string {
  const mins = Math.round(Math.abs(to.getTime() - from.getTime()) / 60_000);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  if (h < 48) return `${h}h${mins % 60 ? ` ${mins % 60}m` : ""}`;
  return `${Math.floor(h / 24)}d`;
}

const PRIORITY = ["", "🔴 p1", "🟠 p2", "🔵 p3", ""] as const;

function metaLine(t: Task): string {
  const bits: string[] = [];
  if (PRIORITY[t.priority]) bits.push(PRIORITY[t.priority]!);
  if (t.rolloverCount > 0) bits.push(`↻ rolled over ${t.rolloverCount}×`);
  if (t.recurrence) bits.push(`🔁 ${esc(t.recurrence)}`);
  return bits.join(" · ");
}

export function formatReminder(p: ReminderPayload, now = p.now ?? new Date()): string {
  const { task: t, decision: d } = p;
  const late = relative(d.dueAt, now);
  const header =
    p.state === "overdue"
      ? `⏰ <b>Overdue</b> by ${late}`
      : p.state === "partial"
        ? `🌗 <b>Still in progress</b>${progressText(t, p.subtasks)}`
        : t.status === "blocked"
          ? `🧱 <b>Blocked</b> — follow-up`
          : `💬 <b>Follow-up</b>`;
  const lines = [header, `<b>${esc(t.title)}</b>`];
  const meta = metaLine(t);
  if (meta) lines.push(meta);
  lines.push(`📅 ${t.dueDate}${t.dueTime ? ` ${t.dueTime}` : ""}${p.reminderCount ? ` · reminder #${p.reminderCount + 1}` : ""}`);
  if (p.lastRemark) lines.push(`📝 <i>${esc(clip(p.lastRemark.text, 300))}</i> (${relative(new Date(p.lastRemark.at), now)} ago)`);
  const where = [p.projectTitle && `📁 ${esc(p.projectTitle)}`, p.notePath && `📄 ${esc(p.notePath)}`].filter(Boolean);
  if (where.length) lines.push(where.join(" · "));
  if (p.reminderCount >= 3) lines.push("\n<i>Still open after several reminders — finish it, reschedule it, or say what's blocking it.</i>");
  return lines.join("\n");
}

function progressText(t: Task, sub: { done: number; total: number }): string {
  const parts: string[] = [];
  if (t.progress > 0) parts.push(`${t.progress}%`);
  if (sub.total > 0) parts.push(`${sub.done}/${sub.total} subtasks`);
  return parts.length ? ` — ${parts.join(", ")}` : "";
}

/** Public https URL of the Mini App (`<PUBLIC_URL>/tg`), when configured. */
let miniAppUrl: string | undefined;
export function setMiniAppUrl(url: string | undefined): void {
  miniAppUrl = url && url.startsWith("https://") ? url.replace(/\/+$/, "") : undefined;
}
export const getMiniAppUrl = () => miniAppUrl;

/** Callback data: `t:<action>:<taskId>` (≤ 64 bytes). */
export function reminderKeyboard(taskId: string): InlineKeyboard {
  const kb = new InlineKeyboard()
    .text("✅ Done", `t:done:${taskId}`)
    .text("🌗 Partial", `t:menu:${taskId}`)
    .text("💬 Remark", `t:rem:${taskId}`)
    .row()
    .text("⏱ +1h", `t:snooze1h:${taskId}`)
    .text("🌅 Tomorrow", `t:tomorrow:${taskId}`)
    .text("🔕 Today", `t:mute:${taskId}`);
  if (miniAppUrl) kb.row().webApp("📱 Open in app", `${miniAppUrl}/task/${encodeURIComponent(taskId)}`);
  return kb;
}

export function partialKeyboard(taskId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("25%", `t:p25:${taskId}`)
    .text("50%", `t:p50:${taskId}`)
    .text("75%", `t:p75:${taskId}`)
    .row()
    .text("▶️ Just started", `t:start:${taskId}`)
    .text("⬅️ Back", `t:back:${taskId}`);
}

export function formatTaskCreated(t: Task): string {
  const lines = [`📝 <b>${esc(t.title)}</b>`];
  const meta = metaLine(t);
  if (meta) lines.push(meta);
  if (t.dueDate) lines.push(`📅 ${t.dueDate}${t.dueTime ? ` ${t.dueTime}` : ""}`);
  if (t.tags.length) lines.push(t.tags.map((x) => `#${esc(x)}`).join(" "));
  return lines.join("\n");
}

type TodayView = ReturnType<typeof todayView>;

export function formatToday(v: TodayView): { text: string; keyboard: InlineKeyboard } {
  const kb = new InlineKeyboard();
  const lines = [`<b>📋 Today · ${v.date}</b>`];
  const open = [...v.overdue, ...v.dueToday, ...v.pinned];
  const item = (t: Task) => {
    const bits = [esc(t.title)];
    if (t.dueTime) bits.push(`<i>${t.dueTime}</i>`);
    if (t.priority < 4) bits.push(PRIORITY[t.priority]!.split(" ")[0]!);
    if (t.rolloverCount > 0) bits.push(`↻${t.rolloverCount}`);
    if (t.status === "in_progress") bits.push(`🌗${t.progress ? `${t.progress}%` : ""}`);
    if (t.status === "blocked") bits.push("🧱");
    return `• ${bits.join(" ")}`;
  };
  if (v.overdue.length) lines.push("", `<b>⚠️ Overdue (${v.overdue.length})</b>`, ...v.overdue.map(item));
  if (v.dueToday.length) lines.push("", `<b>📅 Due today (${v.dueToday.length})</b>`, ...v.dueToday.map(item));
  if (v.pinned.length) lines.push("", `<b>📌 Pinned (${v.pinned.length})</b>`, ...v.pinned.map(item));
  if (!open.length) lines.push("", "Nothing due. 🎉");
  if (v.completed.length) lines.push("", `✅ ${v.completed.length} done today`);

  for (const t of open.slice(0, 12)) kb.text(`✅ ${clip(t.title, 30)}`, `td:${t.id}`).row();
  if (open.length > 12) lines.push(`\n<i>+${open.length - 12} more — see the web UI</i>`);
  kb.text("➕ New task", "m:new").text("🔄 Refresh", "today:r").text("☰ Menu", "m:menu");
  if (miniAppUrl) kb.row().webApp("📱 Open app", miniAppUrl);
  return { text: lines.join("\n"), keyboard: kb };
}

export interface ProjectStats {
  title: string;
  total: number;
  done: number;
  open: Task[];
  blocked: Task[];
  overdue: Task[];
}

export function formatProject(p: ProjectStats): string {
  const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
  const bar = "▰".repeat(Math.round(pct / 10)) + "▱".repeat(10 - Math.round(pct / 10));
  const lines = [`<b>📁 ${esc(p.title)}</b>`, `${bar} ${pct}% · ${p.done}/${p.total} done`];
  if (p.overdue.length) lines.push("", `<b>⚠️ Overdue</b>`, ...p.overdue.slice(0, 8).map((t) => `• ${esc(t.title)} (${t.dueDate})`));
  if (p.blocked.length) {
    lines.push("", `<b>🧱 Blockers / remarks</b>`);
    for (const t of p.blocked.slice(0, 8)) {
      const r = t.remarks.at(-1);
      lines.push(`• ${esc(t.title)}${r ? ` — <i>${esc(clip(r.text, 80))}</i>` : ""}`);
    }
  }
  const next = p.open.filter((t) => !p.blocked.includes(t) && !p.overdue.includes(t)).slice(0, 8);
  if (next.length) lines.push("", `<b>▶️ Next up</b>`, ...next.map((t) => `• ${esc(t.title)}${t.dueDate ? ` (${t.dueDate})` : ""}`));
  return lines.join("\n");
}

export const HELP = `⌨️ <b>Typing shortcuts</b>
Everything here also works through the buttons (☰ Menu).

<b>Add a task</b>
<code>+ Replace UPS battery !p1 @today 18:00 #project/homelab</code>
• <b>When:</b> @today · @tomorrow · @+3d · 📅 2026-12-01, plus a time like 18:00
• <b>Priority:</b> !p1 (urgent) to !p4
• <b>Project:</b> #project/name · <b>Repeat:</b> 🔁 every week
<code>/todo …</code> does the same as <code>+ …</code>

<b>Capture</b>
• Any other message goes into today's log.
• <code>/note Title</code>, new line, then the text: a note in the inbox.
• Photos, voice notes and files are saved to your notes. With AI on, voice notes become tasks and photos become notes.

<b>Find</b>
/today · /project name · /search words · /ask question · /standup · /retro

Reminders keep coming until you tap ✅ Done, reschedule, snooze or mute.`;

/** "Fri 14 Nov" style label for a YYYY-MM-DD date. */
export function shortDate(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

export function formatExtracted(transcript: string, summary: string, found: { title: string; dueDate?: string; dueTime?: string; priority?: number; projectSlug?: string }[]): string {
  const clipT = transcript.length > 700 ? `${transcript.slice(0, 700)}…` : transcript;
  const lines = [`🎤 <i>${esc(clipT || "(couldn't make out any words)")}</i>`];
  if (!found.length) {
    lines.push("", summary ? `${esc(summary)}\n` : "", "No tasks in this one — it's in today's log.");
    return lines.filter((l, i) => l || i < 2).join("\n");
  }
  lines.push("", `I heard ${found.length === 1 ? "one task" : `${found.length} tasks`}:`);
  found.forEach((t, i) => {
    const meta = [
      t.dueDate ? `📅 ${shortDate(t.dueDate)}${t.dueTime ? ` ${t.dueTime}` : ""}` : "",
      t.priority && t.priority < 4 ? `p${t.priority}` : "",
      t.projectSlug ? `#${t.projectSlug}` : "",
    ].filter(Boolean).join(" · ");
    lines.push(`${i + 1}. ${esc(t.title)}${meta ? `  <i>${esc(meta)}</i>` : ""}`);
  });
  return lines.join("\n");
}
