import { Check, ChevronRight, HelpCircle, X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { api, refreshAll } from "../lib/api";
import { nagLine, progressOf } from "../lib/nag";
import type { TaskCard } from "../lib/types";
import { haptic } from "../tg/telegram";
import { useTo } from "./platform";
import { PRIORITY } from "./words";

/* Paper building blocks shared by every screen (web and Telegram). */

export const hint = { color: "var(--tg-hint)" } as const;

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`overflow-hidden rounded-[18px] [&>*+*]:border-t [&>*+*]:border-[var(--tg-sep)] ${className}`} style={{ background: "var(--tg-section)", boxShadow: "var(--tg-ring)" }}>
      {children}
    </div>
  );
}

export function Ring({ percent, size = 28 }: { percent: number; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden className="flex-none">
      <circle cx="10" cy="10" r="8" fill="none" stroke="var(--tg-chip)" strokeWidth="3" />
      {percent > 0 && <circle cx="10" cy="10" r="8" fill="none" stroke="var(--tg-accent)" strokeWidth="3" strokeDasharray={`${(percent / 100) * 50.3} 60`} transform="rotate(-90 10 10)" strokeLinecap="round" />}
    </svg>
  );
}

export function PageTitle({ icon, title, sub }: { icon?: ReactNode; title: string; sub?: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 px-6 pt-2">
      <div className="flex items-center gap-2.5">
        {icon}
        <h1 className="m-0 font-display text-[30px] font-extrabold tracking-tight">{title}</h1>
      </div>
      {sub && <div className={`text-[14px] ${icon ? "pl-[38px]" : ""}`} style={hint}>{sub}</div>}
    </div>
  );
}

export function Group({ title, children, warn, help }: { title: string; children: ReactNode; warn?: boolean; help?: string }) {
  return (
    <section aria-label={title} className="flex flex-col gap-2 px-4">
      <h2 className="m-0 flex items-center gap-2 px-1.5 font-display text-[14.5px] font-bold" style={{ color: warn ? "var(--tg-warn)" : "var(--tg-fg-2)" }}>
        {warn && <span className="h-2 w-2 rounded-full" style={{ background: "var(--tg-warn-dot)" }} />}
        {title}
        {help && <Explain text={help} />}
      </h2>
      {children}
    </section>
  );
}

/** A small (?) that explains something in a sentence, on tap. */
export function Explain({ text, label = "What's this?" }: { text: string; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex">
      <button type="button" aria-label={label} aria-expanded={open} onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }} className="inline-flex" style={hint}>
        <HelpCircle size={15} aria-hidden />
      </button>
      {open && (
        <span role="note" className="anim-in absolute left-1/2 top-6 z-20 w-64 -translate-x-1/2 rounded-[12px] px-3 py-2.5 text-[13px] font-normal leading-snug" style={{ background: "var(--tg-fg)", color: "var(--tg-bg)" }} onClick={() => setOpen(false)}>
          {text}
        </span>
      )}
    </span>
  );
}

/** Round check box: empty, partly filled (progress), "!" (waiting), or ticked. Tap = done / not done. */
export function TaskCheck({ t, size = 24 }: { t: TaskCard; size?: number }) {
  const done = t.status === "done";
  const pct = progressOf(t);
  const toast = useToast();
  const toggle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    haptic.tap();
    try {
      await api.action(t.id, done ? "reopen" : "done");
      if (!done) {
        haptic.ok();
        toast.show({ text: `Done: ${t.title}`, undo: () => api.action(t.id, "reopen") });
      }
      await refreshAll();
    } catch {
      haptic.err();
      toast.show({ text: "That didn't work. Try again." });
    }
  };
  const common = { width: size, height: size, borderRadius: 8, flex: "none" as const };
  if (done)
    return (
      <button type="button" aria-label={`Mark “${t.title}” not done`} onClick={toggle} style={{ ...common, background: "var(--tg-accent)", color: "var(--tg-accent-fg)" }} className="flex items-center justify-center">
        <Check size={Math.round(size * 0.58)} strokeWidth={3.5} />
      </button>
    );
  if (t.status === "blocked")
    return (
      <button type="button" aria-label={`Mark “${t.title}” done (it's waiting on something)`} onClick={toggle} style={{ ...common, border: "2px solid var(--tg-block-line)", background: "var(--tg-block-bg)", color: "var(--tg-danger)" }} className="flex items-center justify-center text-[12px] font-extrabold">
        !
      </button>
    );
  return (
    <button
      type="button"
      aria-label={`Mark “${t.title}” done`}
      onClick={toggle}
      style={{ ...common, border: `2px solid ${pct ? "var(--tg-accent)" : "var(--tg-check)"}`, background: pct ? `linear-gradient(to top, var(--tg-accent) ${pct}%, transparent ${pct}%)` : "transparent" }}
    />
  );
}

const shortDay = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

/** The grey line under a task title, in plain words ("Reminded 3 times", "Moved from yesterday twice"). */
export function taskLine(t: TaskCard, inProject = false): { text: string; warn: boolean } | null {
  if (t.status === "done") return null;
  const n = nagLine(t);
  const parts: string[] = [];
  const pct = progressOf(t);
  if (t.sub.total) parts.push(`${t.sub.done} of ${t.sub.total} steps`);
  else if (pct) parts.push(pct >= 50 && pct < 75 ? "Halfway" : `${pct}% done`);
  if (t.nag && t.nag.sent > 0) parts.push(`reminded ${t.nag.sent === 1 ? "once" : `${t.nag.sent} times`}`);
  else if (t.rolloverCount > 0) parts.push(`moved from yesterday${t.rolloverCount > 1 ? ` ${t.rolloverCount === 2 ? "twice" : `${t.rolloverCount} times`}` : ""}`);
  else if (n && n.text.startsWith("Overdue")) parts.push(n.text.split(" · ")[0]!.replace("Overdue", "late by").toLowerCase());
  if (!parts.length) {
    const when = t.dueDate ? `${t.dueTime ? `${t.dueTime} · ` : ""}${shortDay(t.dueDate)}` : "";
    if (inProject) return when ? { text: when, warn: false } : null;
    return t.projectTitle ? { text: t.projectTitle, warn: false } : null;
  }
  const s = parts.join(" · ");
  return { text: s[0]!.toUpperCase() + s.slice(1), warn: !!(t.nag?.sent || t.rolloverCount || n) };
}

export function TaskRow({ t, chevron, inProject, showDay }: { t: TaskCard; chevron?: boolean; inProject?: boolean; showDay?: boolean }) {
  const navigate = useNavigate();
  const to = useTo();
  const line = taskLine(t, inProject);
  const mark = PRIORITY[t.priority]?.mark;
  const open = () => navigate(to(`/task/${t.id}`));
  return (
    <div role="link" tabIndex={0} aria-label={`Open “${t.title}”`} onClick={open} onKeyDown={(e) => e.key === "Enter" && open()} className="flex cursor-pointer gap-3.5 px-4 py-3.5 transition-colors hover:bg-[color-mix(in_oklab,var(--tg-chip)_45%,transparent)]">
      <TaskCheck t={t} />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className={`text-[16px] font-medium leading-snug ${t.status === "done" ? "line-through" : ""}`} style={t.status === "done" ? hint : undefined}>
          {t.title}
          {mark && <span className="ml-1.5 text-[12px] font-bold" style={{ color: t.priority === 1 ? "var(--tg-danger)" : "var(--tg-warn)" }} title={PRIORITY[t.priority]!.word}>{mark}</span>}
        </span>
        {t.status === "blocked" && t.lastRemark ? (
          <span className="rounded-[10px] px-2.5 py-2 text-[13.5px]" style={{ background: "var(--tg-bg)", color: "var(--tg-fg-2)" }}>{t.lastRemark.text}</span>
        ) : (
          line && <span className="text-[13.5px]" style={{ color: line.warn ? "var(--tg-warn)" : "var(--tg-hint)" }}>{line.text}</span>
        )}
      </span>
      {showDay && t.dueDate && t.status !== "done" ? (
        <span className="self-center whitespace-nowrap text-[13.5px]" style={hint}>{t.dueTime ?? ""}</span>
      ) : (
        t.dueTime && t.status !== "done" && !chevron && <span className="self-center text-[13.5px]" style={hint}>{t.dueTime}</span>
      )}
      {chevron && <ChevronRight size={16} className="self-center" style={hint} aria-hidden />}
    </div>
  );
}

export function Empty({ title, text, children }: { title: string; text: string; children?: ReactNode }) {
  return (
    <div className="mx-4 flex flex-col items-center gap-1.5 rounded-[18px] px-6 py-8 text-center" style={{ background: "var(--tg-section)", boxShadow: "var(--tg-ring)" }}>
      <span className="font-display text-[16px] font-bold">{title}</span>
      <span className="text-[14px] leading-snug" style={hint}>{text}</span>
      {children}
    </div>
  );
}

/** Bottom sheet (phones / Telegram) that becomes a centred dialog on wide screens. */
export function Sheet({ title, onClose, children, side }: { title: string; onClose: () => void; children: ReactNode; side?: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-40 flex flex-col justify-end md:items-center md:justify-center" style={{ background: "var(--tg-overlay)" }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={title} className="anim-in flex w-full flex-col gap-3 rounded-t-[24px] px-5 pb-5 pt-3 md:max-w-[520px] md:rounded-[24px] md:pt-5" style={{ background: "var(--tg-section)", boxShadow: "0 -8px 30px rgba(0,0,0,.12)" }}>
        <div className="mx-auto h-1 w-10 rounded-full md:hidden" style={{ background: "var(--tg-check)" }} aria-hidden />
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="m-0 font-display text-[19px] font-extrabold tracking-tight">{title}</h2>
          {side}
          <button type="button" onClick={onClose} aria-label="Close" className="hidden rounded-full p-1 md:inline-flex" style={hint}><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Button({ children, onClick, tone = "plain", disabled, className = "", type = "button" }: { children: ReactNode; onClick?: () => void; tone?: "accent" | "plain" | "danger" | "ghost"; disabled?: boolean; className?: string; type?: "button" | "submit" }) {
  const style =
    tone === "accent" ? { background: "var(--tg-accent)", color: "var(--tg-accent-fg)" }
    : tone === "danger" ? { background: "var(--tg-block-bg)", color: "var(--tg-danger)" }
    : tone === "ghost" ? { background: "transparent", color: "var(--tg-link)" }
    : { background: "var(--tg-chip)", color: "var(--tg-fg)" };
  return (
    <button type={type} disabled={disabled} onClick={onClick} className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-[14px] px-4 text-[15px] font-semibold disabled:opacity-50 ${className}`} style={style}>
      {children}
    </button>
  );
}

/** "Are you sure?" for anything destructive. */
export function Confirm({ title, text, confirm, onConfirm, onClose, children, tone = "danger" }: { title: string; text: ReactNode; confirm: string; onConfirm: () => void; onClose: () => void; children?: ReactNode; tone?: "danger" | "accent" }) {
  return (
    <Sheet title={title} onClose={onClose}>
      <div className="text-[15px] leading-snug" style={{ color: "var(--tg-fg-2)" }}>{text}</div>
      {children}
      <div className="flex gap-2 pt-1">
        <Button onClick={onClose} tone={confirm ? "plain" : "ghost"} className="flex-1">Cancel</Button>
        {confirm && <Button tone={tone} onClick={onConfirm} className="flex-1">{confirm}</Button>}
      </div>
    </Sheet>
  );
}

// ---------- toasts (with Undo) ----------
interface ToastMsg { text: string; undo?: () => Promise<unknown> }
const ToastCtx = createContext<{ show: (t: ToastMsg) => void }>({ show: () => {} });
export const useToast = () => useContext(ToastCtx);

export function ToastHost({ children }: { children: ReactNode }) {
  const [t, setT] = useState<(ToastMsg & { id: number }) | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const show = useCallback((m: ToastMsg) => {
    clearTimeout(timer.current);
    setT({ ...m, id: Date.now() });
    timer.current = setTimeout(() => setT(null), m.undo ? 8000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={{ show }}>
      {children}
      {t && (
        <div role="status" className="anim-in fixed inset-x-0 z-50 mx-auto flex w-[min(92vw,460px)] items-center gap-3 rounded-[16px] px-4 py-3 text-[14.5px]" style={{ bottom: "calc(90px + var(--tg-safe-area-inset-bottom, 0px))", background: "var(--tg-fg)", color: "var(--tg-bg)", boxShadow: "0 8px 30px rgba(0,0,0,.2)" }}>
          <span className="min-w-0 flex-1 truncate">{t.text}</span>
          {t.undo && (
            <button
              type="button"
              className="font-semibold"
              style={{ color: "var(--tg-accent-soft)" }}
              onClick={async () => {
                const u = t.undo!;
                setT(null);
                try {
                  await u();
                  await refreshAll();
                  show({ text: "Undone" });
                } catch {
                  show({ text: "Couldn't undo that (too late?)" });
                }
              }}
            >
              Undo
            </button>
          )}
        </div>
      )}
    </ToastCtx.Provider>
  );
}
