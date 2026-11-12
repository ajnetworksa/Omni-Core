import { useQuery } from "@tanstack/react-query";
import { BellOff, Check, Clock, ExternalLink, FileText, Pin, Sunrise, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { api, refreshAll } from "../lib/api";
import { clock, lateBy, rel } from "../lib/format";
import { nagLine, progressOf } from "../lib/nag";
import type { TaskAction, TaskDetail } from "../lib/types";
import { Breakdown } from "./Breakdown";
import { toggleDone, useOpenTask } from "./TaskRow";
import { Chip, PriorityChip, TaskCheck } from "./ui";

export function TaskDrawer() {
  const { openId, close } = useOpenTask();
  const q = useQuery({ queryKey: ["detail", openId], queryFn: () => api.detail(openId!), enabled: !!openId });
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!openId) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!openId) return null;
  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <button type="button" aria-label="Close task" className="absolute inset-0 bg-black/50" onClick={close} />
      <div role="dialog" aria-modal="true" aria-label="Task" className="anim-in relative flex h-full w-full max-w-[480px] flex-col border-l border-line bg-panel shadow-2xl">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <span className="text-xs text-muted">Task</span>
          <button ref={closeRef} type="button" onClick={close} aria-label="Close" className="rounded p-1 text-muted hover:bg-white/5 hover:text-fg">
            <X size={18} />
          </button>
        </div>
        {q.data ? <DrawerBody t={q.data} /> : <div className="p-6 text-muted">{q.isError ? "Task not found." : "Loading…"}</div>}
      </div>
    </div>
  );
}

function DrawerBody({ t }: { t: TaskDetail }) {
  const [title, setTitle] = useState(t.title);
  const [remark, setRemark] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [flash, setFlash] = useState("");
  useEffect(() => setTitle(t.title), [t.title]);
  const nag = nagLine(t);
  const pct = progressOf(t);
  const open = t.status !== "done" && t.status !== "cancelled";

  const run = async (key: string, fn: () => Promise<unknown>, msg?: string) => {
    setBusy(key);
    try {
      await fn();
      await refreshAll();
      if (msg) setFlash(msg);
    } catch {
      setFlash("That didn't work — the file may have changed. Try again.");
    } finally {
      setBusy(null);
    }
  };
  const act = (a: TaskAction, msg: string) => run(a, () => api.action(t.id, a), msg);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-5">
        <div className="flex items-start gap-3">
          <div className="pt-1.5"><TaskCheck t={t} onToggle={() => void run("check", () => toggleDone(t))} size={20} /></div>
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <label htmlFor="task-title" className="sr-only">Title</label>
            <textarea
              id="task-title"
              value={title}
              rows={1}
              onChange={(e) => setTitle(e.target.value.replace(/\n/g, " "))}
              onBlur={() => title.trim() && title !== t.title && void run("title", () => api.patch(t.id, { title: title.trim() }))}
              className="field-sizing-content w-full resize-none bg-transparent text-xl font-semibold leading-snug text-fg outline-none"
            />
            <div className="flex flex-wrap gap-1.5">
              <PriorityChip p={t.priority} />
              {t.projectTitle && <Chip tone="info">{t.projectTitle}</Chip>}
              {t.status === "blocked" && <Chip tone="danger">Blocked</Chip>}
              {t.status === "in_progress" && <Chip tone="accent">{`In progress${pct ? ` · ${pct}%` : ""}`}</Chip>}
              {t.rolloverCount > 0 && <Chip tone="warn">{`Rolled over ${t.rolloverCount}×`}</Chip>}
              {t.recurrence && <Chip>{t.recurrence}</Chip>}
              {t.tags.filter((x) => !x.startsWith("project/")).map((x) => <Chip key={x}>{`#${x}`}</Chip>)}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 text-xs">
          <label className="col-span-1 flex flex-col gap-1 text-muted">
            Priority
            <select
              value={t.priority}
              onChange={(e) => void run("prio", () => api.patch(t.id, { priority: Number(e.target.value) }))}
              className="rounded-md border border-line-strong bg-card px-2 py-1.5 text-sm text-fg"
            >
              <option value={1}>p1 · urgent</option>
              <option value={2}>p2 · high</option>
              <option value={3}>p3 · medium</option>
              <option value={4}>none</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-muted">
            Due date
            <input type="date" value={t.dueDate ?? ""} onChange={(e) => void run("date", () => api.patch(t.id, { dueDate: e.target.value || null }))} className="rounded-md border border-line-strong bg-card px-2 py-1.5 text-sm text-fg [color-scheme:dark]" />
          </label>
          <label className="flex flex-col gap-1 text-muted">
            Time
            <input type="time" value={t.dueTime ?? ""} onChange={(e) => void run("time", () => api.patch(t.id, { dueTime: e.target.value || null }))} className="rounded-md border border-line-strong bg-card px-2 py-1.5 text-sm text-fg [color-scheme:dark]" />
          </label>
        </div>

        {open && nag && (
          <div className="rounded-[10px] border border-[#3d2f12] bg-[#1a160d] px-3.5 py-3 text-[13px] text-[#fde68a]">
            {nag.text}
            {t.nag && <span className="text-[#c9b27a]">{` · due ${lateBy(t.nag.dueAt) ? `${lateBy(t.nag.dueAt)} ago` : clock(t.nag.dueAt)}`}</span>}
          </div>
        )}

        {(t.children.length > 0 || pct > 0) && (
          <section aria-labelledby="sub-h" className="flex flex-col gap-2 rounded-xl border border-line bg-card p-3.5">
            <div className="flex justify-between text-[13px]">
              <h3 id="sub-h" className="m-0 font-normal text-muted">Progress</h3>
              <span className="font-semibold">{`${pct}%${t.children.length ? ` · ${t.sub.done} of ${t.sub.total} subtasks` : ""}`}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded bg-line-strong"><div className="h-1.5 bg-accent" style={{ width: `${pct}%` }} /></div>
            {t.children.map((c) => (
              <div key={c.id} className="flex items-start gap-2.5 pt-1 text-sm">
                <TaskCheck t={c} onToggle={() => void run(c.id, () => toggleDone(c))} size={17} />
                <span className="flex flex-col">
                  <span className={c.status === "done" ? "text-faint line-through" : ""}>{c.title}</span>
                  {c.lastRemark && <i className="text-xs text-muted">{`“${c.lastRemark.text}”`}</i>}
                </span>
              </div>
            ))}
          </section>
        )}

        <Breakdown key={t.id} task={t} />

        <section aria-labelledby="rem-h" className="flex flex-col gap-2">
          <h3 id="rem-h" className="m-0 text-xs font-semibold uppercase tracking-[.06em] text-muted">Remarks</h3>
          {t.remarks.length === 0 && <p className="m-0 text-[13px] text-faint">No remarks. Add one when you're blocked or waiting — the nag engine switches to gentle follow-ups.</p>}
          {[...t.remarks].reverse().map((r, i) => (
            <div key={i} className="rounded-lg bg-card px-3 py-2 text-sm">
              {r.text}
              <div className="text-xs text-faint">{`${r.source} · ${rel(r.at)}`}</div>
            </div>
          ))}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (remark.trim()) void run("remark", () => api.remark(t.id, remark.trim()).then(() => setRemark("")), "Remark added");
            }}
          >
            <label htmlFor="remark" className="sr-only">Add a remark</label>
            <input id="remark" value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="e.g. Waiting for supplier quote" className="w-full rounded-lg border border-line bg-card px-3 py-2 text-sm outline-none placeholder:text-faint focus:border-accent/60" />
          </form>
        </section>

        {t.reminders.length > 0 && (
          <section aria-labelledby="hist-h" className="flex flex-col gap-2">
            <h3 id="hist-h" className="m-0 text-xs font-semibold uppercase tracking-[.06em] text-muted">Nudge history</h3>
            <ol className="m-0 ml-1.5 flex list-none flex-col gap-2.5 border-l-2 border-line-strong p-0 pl-3.5 text-[13px]">
              {t.reminders.slice(0, 8).map((r) => (
                <li key={r.sentAt} className="relative">
                  <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full bg-[#4b5263]" />
                  <span className="font-mono text-xs text-faint">{clock(r.sentAt)}</span>
                  {` ${r.state} reminder via ${r.channel}`}
                  {r.ackAt && <span className="text-ok">{" · seen"}</span>}
                </li>
              ))}
            </ol>
          </section>
        )}

        {t.notePath && (
          <section aria-label="Source" className="flex flex-col gap-2 rounded-xl border border-line bg-[#0d1016] p-3">
            <div className="flex items-center gap-2 text-xs text-muted">
              <FileText size={14} aria-hidden />
              <span className="font-mono">{t.notePath}</span>
              {t.sourceLine && <span className="ml-auto">{`line ${t.sourceLine}`}</span>}
            </div>
            {t.rawLine && <code className="block overflow-x-auto whitespace-pre font-mono text-[11.5px] text-fg-2">{t.rawLine.trim()}</code>}
            <div className="flex gap-3 text-xs">
              {t.noteId && <Link to={`/notes/${t.noteId}`} className="text-accent-soft hover:underline">Open note</Link>}
              <a href={`obsidian://open?file=${encodeURIComponent(t.notePath.replace(/\.md$/, ""))}`} className="inline-flex items-center gap-1 text-muted hover:text-fg">
                Open in Obsidian <ExternalLink size={11} aria-hidden />
              </a>
            </div>
          </section>
        )}
      </div>

      {open ? (
        <div className="flex flex-col gap-2 border-t border-line bg-[#0c0f15] p-4">
          {flash && <p role="status" className="m-0 text-center text-xs text-muted">{flash}</p>}
          <div className="grid grid-cols-3 gap-2 text-[13px]">
            {(["p25", "p50", "p75"] as const).map((a) => (
              <button key={a} type="button" disabled={!!busy} onClick={() => void act(a, `Marked ${a.slice(1)}%`)} className={`rounded-lg border px-2 py-2 ${t.progress === Number(a.slice(1)) ? "border-accent/60 bg-[#211d3a] text-accent-soft" : "border-line-strong bg-raised text-fg"}`}>
                {`${a.slice(1)}%`}
              </button>
            ))}
            <button type="button" disabled={!!busy} onClick={() => void act("snooze1h", "Snoozed for an hour")} className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-line-strong bg-raised px-2 py-2"><Clock size={14} aria-hidden />+1 hour</button>
            <button type="button" disabled={!!busy} onClick={() => void act("tomorrow", "Moved to tomorrow")} className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-line-strong bg-raised px-2 py-2"><Sunrise size={14} aria-hidden />Tomorrow</button>
            <button type="button" disabled={!!busy} onClick={() => void act("mute", "Muted until tomorrow")} className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-line-strong bg-raised px-2 py-2"><BellOff size={14} aria-hidden />Mute today</button>
          </div>
          <div className="flex gap-2">
            <button type="button" disabled={!!busy} onClick={() => void run("pin", () => api.patch(t.id, { pinned: !t.pinned }))} aria-pressed={t.pinned} aria-label={t.pinned ? "Unpin" : "Pin to Today"} className={`rounded-lg border px-3 ${t.pinned ? "border-accent/60 text-accent-soft" : "border-line-strong text-muted"}`}><Pin size={16} /></button>
            <button type="button" disabled={!!busy} onClick={() => void act("done", "Done")} className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-accent font-semibold text-ink hover:brightness-110 disabled:opacity-60"><Check size={17} strokeWidth={3} aria-hidden />Mark done</button>
          </div>
        </div>
      ) : (
        <div className="border-t border-line p-4">
          <button type="button" onClick={() => void act("reopen", "Reopened")} className="h-11 w-full rounded-lg border border-line-strong bg-raised font-medium">Reopen</button>
        </div>
      )}
    </div>
  );
}
