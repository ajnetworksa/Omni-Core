import { useQuery } from "@tanstack/react-query";
import { Check, ChevronRight, Plus, Sun } from "lucide-react";
import { useNavigate } from "react-router";
import { api, refreshAll } from "../lib/api";
import { dayLabel } from "../lib/format";
import { nagLine, progressOf } from "../lib/nag";
import type { TaskCard, TodayBoard } from "../lib/types";
import { haptic } from "./telegram";

const pri = (p: number) => (p === 1 ? "!!!" : p === 2 ? "!!" : p === 3 ? "!" : "");

export function TgCheck({ t, size = 24 }: { t: TaskCard; size?: number }) {
  const done = t.status === "done";
  const pct = progressOf(t);
  const toggle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    haptic.tap();
    await api.action(t.id, done ? "reopen" : "done");
    if (!done) haptic.ok();
    await refreshAll();
  };
  const common = { width: size, height: size, borderRadius: 8, flex: "none" as const };
  if (done)
    return (
      <button type="button" aria-label={`Reopen ${t.title}`} onClick={toggle} style={{ ...common, background: "var(--tg-accent)", color: "var(--tg-accent-fg)" }} className="flex items-center justify-center">
        <Check size={14} strokeWidth={3.5} />
      </button>
    );
  if (t.status === "blocked")
    return (
      <button type="button" aria-label={`Complete ${t.title}`} onClick={toggle} style={{ ...common, border: "2px solid var(--tg-block-line)", background: "var(--tg-block-bg)", color: "var(--tg-danger)" }} className="flex items-center justify-center text-[12px] font-extrabold">
        !
      </button>
    );
  return (
    <button
      type="button"
      aria-label={`Complete ${t.title}`}
      onClick={toggle}
      style={{ ...common, border: `2px solid ${pct ? "var(--tg-accent)" : "var(--tg-check)"}`, background: pct ? `linear-gradient(to top, var(--tg-accent) ${pct}%, transparent ${pct}%)` : "transparent" }}
    />
  );
}

/** Plain-language status line in Paper's voice ("Reminded 3 times", "Moved from yesterday twice"). */
function paperLine(t: TaskCard, inProject = false): { text: string; warn: boolean } | null {
  if (t.status === "done") return null;
  const n = nagLine(t);
  const parts: string[] = [];
  const pct = progressOf(t);
  if (t.sub.total) parts.push(`${t.sub.done} of ${t.sub.total} steps`);
  else if (pct) parts.push(pct >= 50 && pct < 75 ? "Halfway" : `${pct}% done`);
  if (t.nag && t.nag.sent > 0) parts.push(`reminded ${t.nag.sent === 1 ? "once" : `${t.nag.sent} times`}`);
  else if (t.rolloverCount > 0) parts.push(`moved from yesterday${t.rolloverCount > 1 ? ` ${t.rolloverCount === 2 ? "twice" : `${t.rolloverCount}×`}` : ""}`);
  else if (n && n.text.startsWith("Overdue")) parts.push(n.text.split(" · ")[0]!.toLowerCase());
  if (!parts.length) {
    const when = t.dueDate ? `${t.dueTime ? `${t.dueTime} · ` : ""}${new Date(`${t.dueDate}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })}` : "";
    if (inProject) return when ? { text: when, warn: false } : null;
    return t.projectTitle ? { text: t.projectTitle, warn: false } : null;
  }
  const s = parts.join(" · ");
  return { text: s[0]!.toUpperCase() + s.slice(1), warn: !!(t.nag?.sent || t.rolloverCount || n) };
}

export function TgRow({ t, boxed, inProject }: { t: TaskCard; boxed?: boolean; inProject?: boolean }) {
  const navigate = useNavigate();
  const line = paperLine(t, inProject);
  return (
    <div role="link" tabIndex={0} onClick={() => navigate(`/tg/task/${t.id}`)} onKeyDown={(e) => e.key === "Enter" && navigate(`/tg/task/${t.id}`)} className="flex cursor-pointer gap-3.5 px-4 py-3.5" style={boxed ? undefined : {}}>
      <TgCheck t={t} />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className={`text-[16px] font-medium leading-snug ${t.status === "done" ? "line-through" : ""}`} style={t.status === "done" ? { color: "var(--tg-hint)" } : undefined}>
          {t.title}
          {pri(t.priority) && <span className="ml-1.5 text-[12px] font-bold" style={{ color: t.priority === 1 ? "var(--tg-danger)" : "var(--tg-warn)" }}>{pri(t.priority)}</span>}
        </span>
        {t.status === "blocked" && t.lastRemark ? (
          <span className="rounded-[10px] px-2.5 py-2 text-[13.5px]" style={{ background: "var(--tg-bg)", color: "var(--tg-fg-2)" }}>{t.lastRemark.text}</span>
        ) : (
          line && <span className="text-[13.5px]" style={{ color: line.warn ? "var(--tg-warn)" : "var(--tg-hint)" }}>{line.text}</span>
        )}
      </span>
      {t.dueTime && t.status !== "done" && !boxed && <span className="self-center text-[13.5px]" style={{ color: "var(--tg-hint)" }}>{t.dueTime}</span>}
      {boxed && <ChevronRight size={16} className="self-center" style={{ color: "var(--tg-hint)" }} aria-hidden />}
    </div>
  );
}

function Group({ title, children, warn }: { title: string; children: React.ReactNode; warn?: boolean }) {
  return (
    <section aria-label={title} className="flex flex-col gap-2 px-4">
      <h2 className="m-0 flex items-center gap-2 px-1.5 font-display text-[14.5px] font-bold" style={{ color: warn ? "var(--tg-warn)" : "var(--tg-fg-2)" }}>
        {warn && <span className="h-2 w-2 rounded-full" style={{ background: "var(--tg-warn-dot)" }} />}
        {title}
      </h2>
      {children}
    </section>
  );
}

export const Card = ({ children }: { children: React.ReactNode }) => (
  <div className="overflow-hidden rounded-[18px] [&>*+*]:border-t [&>*+*]:border-[var(--tg-sep)]" style={{ background: "var(--tg-section)", boxShadow: "var(--tg-ring)" }}>
    {children}
  </div>
);

export function Ring({ percent, size = 28 }: { percent: number; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden className="flex-none">
      <circle cx="10" cy="10" r="8" fill="none" stroke="var(--tg-chip)" strokeWidth="3" />
      {percent > 0 && <circle cx="10" cy="10" r="8" fill="none" stroke="var(--tg-accent)" strokeWidth="3" strokeDasharray={`${(percent / 100) * 50.3} 60`} transform="rotate(-90 10 10)" strokeLinecap="round" />}
    </svg>
  );
}

export function TgToday({ data }: { data?: TodayBoard }) {
  if (!data) return <p className="px-6 py-10 text-center" style={{ color: "var(--tg-hint)" }}>Loading…</p>;
  const total = data.counts.open + data.counts.done;
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-0.5 px-6 pt-2">
        <div className="flex items-center gap-2.5">
          <Sun size={26} style={{ color: "var(--tg-accent)" }} aria-hidden />
          <h1 className="m-0 font-display text-[30px] font-extrabold tracking-tight">Today</h1>
        </div>
        <div className="pl-9 text-[14px]" style={{ color: "var(--tg-hint)" }}>{`${new Date(`${data.date}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })} · ${data.counts.done} of ${total} done`}</div>
      </div>
      {data.attention.length > 0 && (
        <Group title="Still waiting on you" warn>
          <Card>{data.attention.map((t) => <TgRow key={t.id} t={t} boxed />)}</Card>
        </Group>
      )}
      {(data.later.length > 0 || data.done.length > 0) && (
        <Group title="Later today">
          <div className="flex flex-col">{[...data.later, ...data.done].map((t) => <TgRow key={t.id} t={t} />)}</div>
        </Group>
      )}
      {data.attention.length + data.later.length + data.done.length === 0 && <p className="px-6 text-center text-[15px]" style={{ color: "var(--tg-hint)" }}>Nothing due today.</p>}
    </div>
  );
}

export function TgUpcoming({ today }: { today?: string }) {
  const q = useQuery({ queryKey: ["upcoming"], queryFn: () => api.upcoming(14) });
  return (
    <div className="flex flex-col gap-5 pt-2">
      <h1 className="m-0 px-6 font-display text-[30px] font-extrabold tracking-tight">Upcoming</h1>
      {q.data?.length === 0 && <p className="px-6 text-[15px]" style={{ color: "var(--tg-hint)" }}>Nothing in the next two weeks.</p>}
      {q.data?.map((g) => (
        <Group key={g.date} title={today ? dayLabel(g.date, today) : g.date}>
          <Card>{g.tasks.map((t) => <TgRow key={t.id} t={t} boxed />)}</Card>
        </Group>
      ))}
    </div>
  );
}

export function TgProjects({ onNew }: { onNew: () => void }) {
  const q = useQuery({ queryKey: ["projects"], queryFn: api.projects });
  const navigate = useNavigate();
  return (
    <div className="flex flex-col gap-4 pt-2">
      <h1 className="m-0 px-6 font-display text-[30px] font-extrabold tracking-tight">Projects</h1>
      <div className="flex flex-col gap-3 px-4">
        {q.data && q.data.length > 0 && (
          <Card>
            {q.data.map((p) => (
              <button key={p.id} type="button" onClick={() => navigate(`/tg/project/${encodeURIComponent(p.slug)}`)} className="flex w-full items-center gap-3.5 px-4 py-3.5 text-left">
                <Ring percent={p.percent} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[16px] font-semibold">{p.title}</span>
                  <span className="text-[13.5px]" style={{ color: p.overdue || p.blocked ? "var(--tg-warn)" : "var(--tg-hint)" }}>
                    {p.total ? [`${p.done} of ${p.total} done`, p.overdue ? `${p.overdue} overdue` : "", p.blocked ? `${p.blocked} blocked` : "", p.dueToday ? `${p.dueToday} due today` : ""].filter(Boolean).join(" · ") : "No tasks yet"}
                  </span>
                </span>
                <ChevronRight size={16} style={{ color: "var(--tg-hint)" }} aria-hidden />
              </button>
            ))}
          </Card>
        )}
        {q.data?.length === 0 && <p className="m-0 px-2 text-[15px]" style={{ color: "var(--tg-hint)" }}>No projects yet. Create one to group related tasks.</p>}
        <button type="button" onClick={onNew} className="flex items-center gap-3 rounded-[18px] px-4 py-3.5 text-[15.5px] font-semibold" style={{ background: "var(--tg-section)", boxShadow: "var(--tg-ring)", color: "var(--tg-link)" }}>
          <span className="flex h-7 w-7 items-center justify-center rounded-full" style={{ background: "var(--tg-accent-soft)" }}><Plus size={16} aria-hidden /></span>
          New project
        </button>
      </div>
    </div>
  );
}
