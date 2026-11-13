import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BellOff, Clock, ExternalLink, FileText, Pin, Plus, Sunrise, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { api, refreshAll } from "../lib/api";
import { clock, dayLabel, rel } from "../lib/format";
import { progressOf } from "../lib/nag";
import type { TaskAction, TaskDetail } from "../lib/types";
import { haptic } from "../tg/telegram";
import { TgBreakdown } from "../tg/TgBreakdown";
import { useBack, usePlatform, usePrimary, useTo } from "./platform";
import { Button, Card, Confirm, Explain, hint, TaskCheck, useToast } from "./ui";
import { PRIORITY, STATUS } from "./words";

/** One task: everything about it, and every action, in plain words. Same screen on web and in Telegram. */
export function TaskScreen() {
  const { id } = useParams();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ["detail", id], queryFn: () => api.detail(id!), enabled: !!id });
  useBack(() => (window.history.length > 1 ? navigate(-1) : navigate("/")));
  if (!q.data) return <p className="px-6 py-10 text-center" style={hint}>{q.isError ? "This task doesn't exist any more." : "Loading…"}</p>;
  return <TaskBody key={q.data.id} t={q.data} />;
}

const btn = "inline-flex h-11 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-3 text-[14.5px] font-medium";
const soft = { background: "var(--tg-chip)", color: "var(--tg-fg)" };

function TaskBody({ t }: { t: TaskDetail }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const to = useTo();
  const toast = useToast();
  const { tg } = usePlatform();
  const today = useQuery({ queryKey: ["today"], queryFn: api.today });
  const settings = useQuery({ queryKey: ["settings"], queryFn: api.settings, staleTime: 60_000 });
  const [title, setTitle] = useState(t.title);
  const [update, setUpdate] = useState("");
  const [step, setStep] = useState("");
  const [sheet, setSheet] = useState<null | "partly" | "later" | "delete">(null);
  useEffect(() => setTitle(t.title), [t.title]);
  const open = t.status !== "done" && t.status !== "cancelled";
  const pct = progressOf(t);

  const run = async (fn: () => Promise<unknown>, msg?: string, undo?: () => Promise<unknown>) => {
    haptic.tap();
    try {
      await fn();
      haptic.ok();
      await refreshAll();
      if (msg) toast.show({ text: msg, undo });
    } catch {
      haptic.err();
      toast.show({ text: "That didn't work. The note may have changed; try again." });
    }
  };
  const act = (a: TaskAction, msg: string) => run(() => api.action(t.id, a), msg);
  const done = () =>
    run(() => api.action(t.id, "done"), `Done: ${t.title}`, () => api.action(t.id, "reopen")).then(() => setTimeout(() => navigate(-1), 350));

  // In Telegram, Done is Telegram's big button; on the web it's in the action bar below.
  usePrimary(!tg || sheet ? null : open ? { label: "✓ Done", onClick: () => void done() } : { label: "Not done after all", onClick: () => void act("reopen", "Back on your list") }, [tg, sheet, open, t.id]);

  const item = (k: string) => settings.data?.groups.flatMap((g) => g.items).find((i) => i.key === k)?.value;
  const nag = t.nag;
  const when = t.dueDate ? `${today.data ? dayLabel(t.dueDate, today.data.date) : t.dueDate}${t.dueTime ? ` at ${t.dueTime}` : ""}` : "No date";

  // What the reminders will do, in one sentence.
  let reminder: { title: string; text: string; tone: "warn" | "calm" } | null = null;
  if (open) {
    if (!t.dueDate) reminder = { title: "No reminders", text: "It has no date, so I won't remind you. Pick a day below to get reminded.", tone: "calm" };
    else if (t.status === "backlog") reminder = { title: "No reminders", text: "It's set to Someday.", tone: "calm" };
    else if (nag && nag.snoozedUntil && new Date(nag.snoozedUntil) > new Date()) reminder = { title: `Quiet until ${clock(nag.snoozedUntil)}`, text: "You pushed it later. Reminders start again then.", tone: "calm" };
    else if (nag && new Date(nag.dueAt) <= new Date()) {
      const next = nag.nextAt ? rel(nag.nextAt) : "";
      const why = nag.state === "remark" ? `you added an update, so I check back every ${nag.intervalMin} minutes` : nag.state === "partial" ? `it's partly done, so I remind you every ${nag.intervalMin} minutes` : `it's not done yet, so I remind you every ${nag.intervalMin} minutes`;
      reminder = {
        title: next && !next.endsWith("ago") ? `Next reminder ${next}` : "Reminder due now",
        text: `${nag.sent ? `Reminded ${nag.sent === 1 ? "once" : `${nag.sent} times`} since ${clock(nag.dueAt)}. ` : ""}It's been due since ${clock(nag.dueAt)}; ${why}. ✓ Done stops it.`,
        tone: "warn",
      };
    } else reminder = { title: `First reminder ${when === "Today" ? "today" : when.toLowerCase().startsWith("tomorrow") ? "tomorrow" : `on ${when}`}${t.dueTime ? "" : ` at ${item("defaultTime") ?? "09:00"}`}`, text: "Then again until it's done, unless you mark it partly done or add an update.", tone: "calm" };
  }

  return (
    <div className="flex flex-col gap-4 px-4 pt-4">
      {/* Title */}
      <div className="flex flex-col gap-3 rounded-[20px] p-5" style={{ background: "var(--tg-section)", boxShadow: "var(--tg-ring)" }}>
        <div className="flex gap-3.5">
          <div className="pt-1"><TaskCheck t={t} size={26} /></div>
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <label htmlFor="task-title" className="sr-only">Title</label>
            <textarea
              id="task-title"
              rows={1}
              value={title}
              onChange={(e) => setTitle(e.target.value.replace(/\n/g, " "))}
              onBlur={() => title.trim() && title !== t.title && void run(() => api.patch(t.id, { title: title.trim() }), "Renamed")}
              className="field-sizing-content w-full resize-none bg-transparent font-display text-[23px] font-extrabold leading-tight tracking-tight outline-none"
            />
            <div className="flex flex-wrap items-center gap-x-1.5 text-[14px]" style={hint}>
              {t.projectTitle && t.projectSlug ? <Link to={to(`/project/${t.projectSlug}`)} style={{ color: "var(--tg-link)" }}>{t.projectTitle}</Link> : null}
              {t.projectTitle && <span>·</span>}
              <span>{STATUS[t.status].word}</span>
              {t.priority < 4 && <><span>·</span><span style={{ color: t.priority === 1 ? "var(--tg-danger)" : "var(--tg-warn)", fontWeight: 600 }}>{PRIORITY[t.priority]!.word}</span></>}
              {t.recurrence && <><span>·</span><span>🔁 {t.recurrence}</span></>}
              {t.rolloverCount > 0 && <><span>·</span><span style={{ color: "var(--tg-warn)" }}>moved from yesterday {t.rolloverCount === 1 ? "once" : `${t.rolloverCount} times`}</span></>}
            </div>
          </div>
        </div>
        {t.parent && <Link to={to(`/task/${t.parent.id}`)} className="pl-10 text-[13.5px]" style={{ color: "var(--tg-link)" }}>Part of: {t.parent.title}</Link>}
      </div>

      {/* Reminder explanation */}
      {reminder && (
        <div className="flex flex-col gap-1 rounded-[18px] px-4 py-3.5" style={reminder.tone === "warn" ? { background: "var(--tg-note-bg)", boxShadow: "0 0 0 1px var(--tg-note-line)" } : { background: "var(--tg-section)", boxShadow: "var(--tg-ring)" }}>
          <div className="flex items-center gap-2 font-display text-[15px] font-bold" style={{ color: reminder.tone === "warn" ? "var(--tg-note-fg)" : "var(--tg-fg)" }}>
            {reminder.title}
            <Explain text="I send reminders to Telegram until you act. Done stops them; Partly done or an Update makes them less frequent; Later moves the next one. You can change how often in Settings." />
          </div>
          <div className="text-[14px] leading-snug" style={{ color: reminder.tone === "warn" ? "var(--tg-note-fg)" : "var(--tg-hint)" }}>{reminder.text}</div>
        </div>
      )}

      {/* When / priority */}
      <Card>
        <div className="flex flex-col gap-2 px-4 py-3.5">
          <span className="text-[13px] font-semibold" style={hint}>When</span>
          <div className="flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor="due-date">Date</label>
            <input id="due-date" type="date" value={t.dueDate ?? ""} onChange={(e) => void run(() => api.patch(t.id, { dueDate: e.target.value || null }), e.target.value ? "Date changed" : "Date removed")} className="h-10 rounded-[10px] px-2.5 text-[15px]" style={{ background: "var(--tg-secondary)", color: "var(--tg-fg)" }} />
            <label className="sr-only" htmlFor="due-time">Time</label>
            <input id="due-time" type="time" value={t.dueTime ?? ""} onChange={(e) => void run(() => api.patch(t.id, { dueTime: e.target.value || null, ...(t.dueDate ? {} : { dueDate: today.data?.date }) }), "Time changed")} className="h-10 rounded-[10px] px-2.5 text-[15px]" style={{ background: "var(--tg-secondary)", color: "var(--tg-fg)" }} />
            {today.data && t.dueDate !== today.data.date && <button type="button" className="h-10 rounded-full px-3 text-[14px] font-medium" style={soft} onClick={() => void run(() => api.patch(t.id, { dueDate: today.data!.date }), "Moved to today")}>Today</button>}
            {t.dueDate && <button type="button" className="h-10 rounded-full px-3 text-[14px]" style={hint} onClick={() => void run(() => api.patch(t.id, { dueDate: null, dueTime: null }), "Date removed")}>Clear</button>}
          </div>
        </div>
        <div className="flex flex-col gap-2 px-4 py-3.5">
          <span className="text-[13px] font-semibold" style={hint}>Priority</span>
          <div role="radiogroup" aria-label="Priority" className="grid grid-cols-4 gap-1.5">
            {[1, 2, 3, 4].map((p) => (
              <button key={p} type="button" role="radio" aria-checked={t.priority === p} onClick={() => t.priority !== p && void run(() => api.patch(t.id, { priority: p }))} className="h-10 rounded-[10px] text-[14px] font-medium" style={t.priority === p ? { background: "var(--tg-accent)", color: "var(--tg-accent-fg)" } : soft}>
                {PRIORITY[p]!.word.replace("No priority", "None")}
              </button>
            ))}
          </div>
        </div>
      </Card>

      {/* Steps */}
      <section aria-label="Steps" className="flex flex-col gap-2">
        <h2 className="m-0 flex items-center gap-2 px-1.5 font-display text-[14.5px] font-bold" style={{ color: "var(--tg-fg-2)" }}>
          Steps {t.children.length > 0 && <span className="font-normal" style={hint}>{`${t.sub.done} of ${t.sub.total} · ${pct}%`}</span>}
          <Explain text="Break a task into smaller steps. Ticking steps fills in the task's progress. Steps are saved as indented checkboxes under the task in your note." />
        </h2>
        <Card>
          {pct > 0 && <div className="px-4 py-3"><div className="h-1.5 overflow-hidden rounded-full" style={{ background: "var(--tg-secondary)" }}><div className="h-1.5 rounded-full" style={{ width: `${pct}%`, background: "var(--tg-accent)" }} /></div></div>}
          {t.children.map((c) => (
            <div key={c.id} className="flex items-start gap-3 px-4 py-3">
              <TaskCheck t={c} size={21} />
              <span className="flex flex-col text-[15.5px]">
                <span className={c.status === "done" ? "line-through" : ""} style={c.status === "done" ? hint : undefined}>{c.title}</span>
                {c.lastRemark && <span className="text-[13px]" style={hint}>{c.lastRemark.text}</span>}
              </span>
            </div>
          ))}
          <form className="flex items-center gap-2 px-4 py-2.5" onSubmit={(e) => { e.preventDefault(); if (step.trim()) void run(() => api.addSubtasks(t.id, [step.trim()]).then(() => setStep(""))); }}>
            <Plus size={18} style={hint} aria-hidden />
            <label htmlFor="new-step" className="sr-only">Add a step</label>
            <input id="new-step" value={step} onChange={(e) => setStep(e.target.value)} placeholder="Add a step" className="h-10 flex-1 bg-transparent text-[15.5px] outline-none" />
            {step.trim() && <Button tone="accent" type="submit" className="min-h-9 px-3 text-[14px]">Add</Button>}
          </form>
        </Card>
        <TgBreakdown task={t} />
      </section>

      {/* Updates (remarks) */}
      <section aria-label="Updates" className="flex flex-col gap-2">
        <h2 className="m-0 flex items-center gap-2 px-1.5 font-display text-[14.5px] font-bold" style={{ color: "var(--tg-fg-2)" }}>
          Updates
          <Explain text="Write what's happening, like “waiting for parts” or “called, no answer”. The task shows as Waiting, and I check back later instead of the usual reminders." />
        </h2>
        <Card>
          {[...t.remarks].reverse().map((r, i) => (
            <div key={i} className="flex flex-col px-4 py-3 text-[15px]">
              {r.text}
              <span className="text-[12.5px]" style={hint}>{`${rel(r.at)} · from ${r.source === "telegram" ? "Telegram" : "the app"}`}</span>
            </div>
          ))}
          <form className="flex items-center gap-2 px-4 py-2.5" onSubmit={(e) => { e.preventDefault(); if (update.trim()) void run(() => api.remark(t.id, update.trim()).then(() => setUpdate("")), "Update saved. I'll check back later instead of nagging."); }}>
            <label htmlFor="update" className="sr-only">Write an update</label>
            <input id="update" value={update} onChange={(e) => setUpdate(e.target.value)} placeholder={t.remarks.length ? "Add another update" : "What's happening? e.g. waiting for parts"} className="h-10 flex-1 bg-transparent text-[15.5px] outline-none" />
            <Button tone="accent" type="submit" disabled={!update.trim()} className="min-h-9 px-3 text-[14px]">Save</Button>
          </form>
        </Card>
      </section>

      {/* History + source */}
      {t.reminders.length > 0 && (
        <section aria-label="Reminders sent" className="flex flex-col gap-2 px-1.5">
          <h2 className="m-0 font-display text-[14.5px] font-bold" style={{ color: "var(--tg-fg-2)" }}>Reminders sent</h2>
          {t.reminders.slice(0, 6).map((r) => (
            <div key={r.sentAt} className="flex gap-3 text-[14.5px]">
              <span className="w-12 flex-none" style={hint}>{clock(r.sentAt)}</span>
              <span>{`Reminder on Telegram${r.ackAt ? " · you responded" : ""}`}</span>
            </div>
          ))}
        </section>
      )}
      {t.notePath && (
        <div className="flex flex-col gap-1.5 rounded-[14px] px-4 py-3 text-[13.5px]" style={{ background: "var(--tg-secondary)" }}>
          <span className="flex items-center gap-2" style={hint}><FileText size={14} aria-hidden />Saved in <code className="truncate">{t.notePath}</code>{t.sourceLine ? ` · line ${t.sourceLine}` : ""}</span>
          <span className="flex gap-4">
            {t.noteId && <Link to={to(`/notes/${t.noteId}`)} style={{ color: "var(--tg-link)" }}>Open the note</Link>}
            {!tg && <a href={`obsidian://open?file=${encodeURIComponent(t.notePath.replace(/\.md$/, ""))}`} className="inline-flex items-center gap-1" style={hint}>Open in Obsidian <ExternalLink size={11} aria-hidden /></a>}
          </span>
        </div>
      )}

      {/* Actions */}
      <div className="sticky bottom-0 z-10 -mx-4 flex flex-col gap-2 px-4 pb-3 pt-6" style={{ background: "linear-gradient(to top, var(--tg-bg) 75%, transparent)", paddingBottom: "calc(12px + var(--tg-safe-area-inset-bottom, 0px))" }}>
        <div className="flex gap-2">
          {open && <button type="button" className={btn} style={soft} onClick={() => setSheet("partly")}>Partly done</button>}
          {open && <button type="button" className={btn} style={soft} onClick={() => setSheet("later")}><Clock size={16} aria-hidden />Later</button>}
          <button type="button" aria-label={t.pinned ? "Unpin from Today" : "Pin to Today"} aria-pressed={t.pinned} title={t.pinned ? "Pinned to Today" : "Pin to Today"} className="flex h-11 w-11 flex-none items-center justify-center rounded-full" style={t.pinned ? { background: "var(--tg-accent-soft)", color: "var(--tg-link)" } : soft} onClick={() => void run(() => api.patch(t.id, { pinned: !t.pinned }), t.pinned ? "Unpinned" : "Pinned to Today")}><Pin size={17} /></button>
          <button type="button" aria-label="Delete task" className="flex h-11 w-11 flex-none items-center justify-center rounded-full" style={{ background: "var(--tg-block-bg)", color: "var(--tg-danger)" }} onClick={() => setSheet("delete")}><Trash2 size={17} /></button>
        </div>
        {!tg && (open ? (
          <button type="button" onClick={() => void done()} className="h-[52px] rounded-[14px] text-[16px] font-semibold" style={{ background: "var(--tg-accent)", color: "var(--tg-accent-fg)" }}>✓ Done</button>
        ) : (
          <button type="button" onClick={() => void act("reopen", "Back on your list")} className="h-[52px] rounded-[14px] text-[16px] font-semibold" style={soft}>Not done after all</button>
        ))}
      </div>

      {sheet === "partly" && (
        <Confirm title="How far along?" text="I'll remind you less often while it's partly done." confirm="" onClose={() => setSheet(null)} onConfirm={() => setSheet(null)}>
          <div className="grid grid-cols-3 gap-2">
            {(["p25", "p50", "p75"] as const).map((a) => <Button key={a} onClick={() => { setSheet(null); void act(a, `Marked ${a.slice(1)}% done`); }}>{a.slice(1)}%</Button>)}
          </div>
          <Button onClick={() => { setSheet(null); void act("start", "Marked as started"); }}>Just started</Button>
        </Confirm>
      )}
      {sheet === "later" && (
        <Confirm title="Remind me later" text="Pushes the next reminder. The task stays on your list." confirm="" onClose={() => setSheet(null)} onConfirm={() => setSheet(null)}>
          <div className="flex flex-col gap-2">
            <Button onClick={() => { setSheet(null); void act("snooze1h", "Quiet for an hour"); }}><Clock size={16} aria-hidden />In 1 hour</Button>
            <Button onClick={() => { setSheet(null); void act("tomorrow", "Moved to tomorrow"); }}><Sunrise size={16} aria-hidden />Tomorrow morning ({item("tomorrowTime") ?? "08:00"})</Button>
            <Button onClick={() => { setSheet(null); void act("mute", "No more reminders today"); }}><BellOff size={16} aria-hidden />Quiet for the rest of today</Button>
          </div>
        </Confirm>
      )}
      {sheet === "delete" && (
        <Confirm
          title="Delete this task?"
          text={<>“{t.title}”{t.children.length ? ` and its ${t.children.length} step${t.children.length > 1 ? "s" : ""}` : ""} will be removed from <code>{t.notePath ?? "the app"}</code>. You can undo for a few seconds.</>}
          confirm="Delete"
          onClose={() => setSheet(null)}
          onConfirm={async () => {
            setSheet(null);
            try {
              const r = await api.deleteTask(t.id);
              haptic.ok();
              navigate(-1); // leave first, so this screen doesn't reload a task that's gone
              qc.removeQueries({ queryKey: ["detail", t.id] });
              toast.show({ text: `Deleted: ${r.title}`, undo: r.undo ? () => api.undo(r.undo!) : undefined });
              await refreshAll();
            } catch {
              haptic.err();
              toast.show({ text: "Couldn't delete it. Try again." });
            }
          }}
        />
      )}
    </div>
  );
}
