import { useQuery } from "@tanstack/react-query";
import { Check, MessageSquare } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { api, refreshAll } from "../lib/api";
import { clock, dayLabel, rel } from "../lib/format";
import { progressOf } from "../lib/nag";
import type { TaskAction } from "../lib/types";
import { haptic, type TgWebApp } from "./telegram";
import { TgCheck } from "./screens";
import { TgBreakdown } from "./TgBreakdown";

export function TgTask({ tg }: { tg: TgWebApp | null }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ["detail", id], queryFn: () => api.detail(id!), enabled: !!id });
  const today = useQuery({ queryKey: ["today"], queryFn: api.today });
  const [remark, setRemark] = useState<string | null>(null);
  const [toast, setToast] = useState("");
  const t = q.data;
  const back = useCallback(() => navigate(-1), [navigate]);

  const act = useCallback(async (a: TaskAction, msg: string) => {
    if (!t) return;
    haptic.tap();
    try {
      await api.action(t.id, a);
      haptic.ok();
      setToast(msg);
      await refreshAll();
      if (a === "done") setTimeout(() => navigate("/tg"), 450);
    } catch {
      haptic.err();
      setToast("That didn't work. Try again.");
    }
  }, [t, navigate]);
  const done = useCallback(() => void act("done", "Done"), [act]);

  useEffect(() => {
    if (!tg) return;
    tg.BackButton.show();
    tg.BackButton.onClick(back);
    const open = t && t.status !== "done";
    if (open) { tg.MainButton.setText("Done").show().enable(); tg.MainButton.onClick(done); } else tg.MainButton.hide();
    return () => { tg.BackButton.offClick(back); tg.MainButton.offClick(done); };
  }, [tg, back, done, t]);

  if (!t) return <p className="px-6 py-10 text-center" style={{ color: "var(--tg-hint)" }}>{q.isError ? "Task not found." : "Loading…"}</p>;
  const pct = progressOf(t);
  const nag = t.nag;
  const nextIn = nag?.nextAt ? rel(nag.nextAt) : "";
  const isOpen = t.status !== "done" && t.status !== "cancelled";
  const btn = "h-11 flex-1 rounded-full text-[14.5px] font-medium";
  return (
    <div className="flex flex-col gap-4 px-4 pb-36 pt-4">
      {!tg && <button type="button" onClick={back} className="self-start text-[15px]" style={{ color: "var(--tg-link)" }}>‹ Back</button>}
      <div className="flex flex-col gap-4 rounded-[20px] p-5" style={{ background: "var(--tg-section)", boxShadow: "0 1px 3px rgba(0,0,0,.06)" }}>
        <div className="flex gap-3.5">
          <div className="pt-1"><TgCheck t={t} size={26} /></div>
          <div className="flex flex-col gap-1.5">
            <h1 className="m-0 font-display text-[23px] font-extrabold leading-tight tracking-tight">{t.title}</h1>
            <div className="text-[14px]" style={{ color: "var(--tg-hint)" }}>
              {[t.projectTitle, t.dueDate ? `${today.data ? dayLabel(t.dueDate, today.data.date) : t.dueDate}${t.dueTime ? `, ${t.dueTime}` : ""}` : null].filter(Boolean).join(" · ")}
              {t.priority === 1 && <span className="whitespace-nowrap font-semibold" style={{ color: "var(--tg-danger)" }}>{" · Urgent"}</span>}
            </div>
          </div>
        </div>
        {(t.children.length > 0 || pct > 0) && (
          <div className="flex flex-col gap-1 pl-10">
            {pct > 0 && <div className="mb-1 h-1.5 overflow-hidden rounded-full" style={{ background: "var(--tg-secondary)" }}><div className="h-1.5 rounded-full" style={{ width: `${pct}%`, background: "var(--tg-accent)" }} /></div>}
            {t.children.map((c) => (
              <div key={c.id} className="flex items-start gap-3 py-2">
                <TgCheck t={c} size={21} />
                <span className="flex flex-col text-[15.5px]">
                  <span className={c.status === "done" ? "line-through" : ""} style={c.status === "done" ? { color: "var(--tg-hint)" } : undefined}>{c.title}</span>
                  {c.lastRemark && <span className="text-[13px]" style={{ color: "var(--tg-hint)" }}>{c.lastRemark.text}</span>}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <TgBreakdown key={t.id} task={t} />

      {isOpen && nag && new Date(nag.dueAt) <= new Date() && (
        <div className="flex flex-col gap-1.5 rounded-[18px] px-4 py-4" style={{ background: "color-mix(in oklab, var(--tg-warn) 12%, var(--tg-section))" }}>
          <div className="font-display text-[15px] font-bold" style={{ color: "var(--tg-warn)" }}>
            {nag.snoozedUntil && new Date(nag.snoozedUntil) > new Date() ? `Snoozed — back ${rel(nag.snoozedUntil)}` : nextIn && !nextIn.endsWith("ago") ? `I'll remind you again ${nextIn}` : "Reminder due now"}
          </div>
          <div className="text-[14px] leading-snug" style={{ color: "var(--tg-fg)" }}>
            {nag.sent > 0 ? `Reminded ${nag.sent === 1 ? "once" : `${nag.sent} times`} since ${clock(nag.dueAt)}. ` : ""}
            {`${t.priority === 1 ? "Important tasks" : "Tasks"} like this get a nudge every ${nag.intervalMin} minutes until they're done or moved.`}
          </div>
        </div>
      )}

      {t.remarks.length > 0 && (
        <section aria-label="Remarks" className="flex flex-col gap-2 px-1">
          <h2 className="m-0 font-display text-[14.5px] font-bold">Remarks</h2>
          {[...t.remarks].reverse().slice(0, 4).map((r, i) => (
            <div key={i} className="rounded-[14px] px-3.5 py-2.5 text-[15px]" style={{ background: "var(--tg-section)" }}>
              {r.text}
              <div className="text-[12.5px]" style={{ color: "var(--tg-hint)" }}>{rel(r.at)}</div>
            </div>
          ))}
        </section>
      )}

      {t.reminders.length > 0 && (
        <section aria-label="Activity" className="flex flex-col gap-2 px-1">
          <h2 className="m-0 font-display text-[14.5px] font-bold">Activity</h2>
          {t.reminders.slice(0, 4).map((r) => (
            <div key={r.sentAt} className="flex gap-3 text-[14.5px]">
              <span className="w-11 flex-none" style={{ color: "var(--tg-hint)" }}>{clock(r.sentAt)}</span>
              <span>{`Reminder sent${r.ackAt ? " · you responded" : ""}`}</span>
            </div>
          ))}
        </section>
      )}

      {isOpen && (
        <div className="fixed inset-x-0 bottom-0 flex flex-col gap-2.5 px-4 pb-4 pt-3" style={{ background: "linear-gradient(to top, var(--tg-bg) 80%, transparent)", paddingBottom: `calc(16px + var(--tg-safe-area-inset-bottom, 0px))` }}>
          {toast && <p role="status" className="m-0 text-center text-[13px]" style={{ color: "var(--tg-hint)" }}>{toast}</p>}
          {remark !== null ? (
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (remark.trim()) void api.remark(t.id, remark.trim()).then(() => { setRemark(null); setToast("Remark added — I'll check in later instead"); haptic.ok(); return refreshAll(); }); }}>
              <label htmlFor="tg-remark" className="sr-only">Remark</label>
              <input id="tg-remark" autoFocus value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="What's holding this up?" className="h-11 flex-1 rounded-full px-4 text-[15px] outline-none" style={{ background: "var(--tg-section)", color: "var(--tg-fg)" }} />
              <button type="submit" className="h-11 rounded-full px-4 text-[14.5px] font-semibold" style={{ background: "var(--tg-accent)", color: "var(--tg-accent-fg)" }}>Save</button>
            </form>
          ) : (
            <div className="flex gap-2">
              <button type="button" className={btn} style={{ background: "var(--tg-secondary)" }} onClick={() => void act("p50", "Marked halfway")}>Halfway</button>
              <button type="button" className={btn} style={{ background: "var(--tg-secondary)" }} onClick={() => void act("snooze1h", "Snoozed for an hour")}>In an hour</button>
              <button type="button" className={btn} style={{ background: "var(--tg-secondary)" }} onClick={() => void act("tomorrow", "Moved to tomorrow")}>Tomorrow</button>
              <button type="button" aria-label="Add a remark" className="flex h-11 w-11 flex-none items-center justify-center rounded-full" style={{ background: "var(--tg-secondary)" }} onClick={() => setRemark("")}><MessageSquare size={18} /></button>
            </div>
          )}
          {!tg && (
            <button type="button" onClick={done} className="flex h-[52px] items-center justify-center gap-2 rounded-[14px] text-[16px] font-semibold" style={{ background: "var(--tg-accent)", color: "var(--tg-accent-fg)" }}><Check size={18} strokeWidth={3} aria-hidden />Done</button>
          )}
        </div>
      )}
    </div>
  );
}
