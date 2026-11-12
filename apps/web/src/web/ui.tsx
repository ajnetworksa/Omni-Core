import { Check, Repeat } from "lucide-react";
import type { ReactNode } from "react";
import type { TaskCard } from "../lib/types";
import { progressOf } from "../lib/nag";

export function Chip({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "p1" | "p2" | "p3" | "danger" | "warn" | "accent" | "info" }) {
  const cls = {
    neutral: "bg-[#1a1f2b] text-fg-2",
    p1: "bg-[#2d1517] text-[#fca5a5]",
    p2: "bg-[#2a1f12] text-[#fdba74]",
    p3: "bg-[#13223a] text-[#93c5fd]",
    danger: "bg-[#2d1517] text-[#fca5a5]",
    warn: "bg-[#2a1f12] text-[#fdba74]",
    accent: "bg-[#211d3a] text-accent-soft",
    info: "bg-[#10242e] text-[#7dd3fc]",
  }[tone];
  return <span className={`inline-flex items-center gap-1 rounded px-1.5 py-px text-[11.5px] font-medium leading-5 ${cls}`}>{children}</span>;
}

export const PriorityChip = ({ p }: { p: number }) => (p < 4 ? <Chip tone={(["neutral", "p1", "p2", "p3"] as const)[p]}>{`p${p}`}</Chip> : null);

const ring = (p: number) => (p === 1 ? "border-danger" : p === 2 ? "border-[#fb923c]" : p === 3 ? "border-[#60a5fa]" : "border-[#4b5263]");

/** Status-aware round checkbox: empty, progress pie, blocked "!", done tick. */
export function TaskCheck({ t, onToggle, size = 18 }: { t: TaskCard; onToggle: () => void; size?: number }) {
  const done = t.status === "done";
  const label = done ? `Reopen ${t.title}` : `Complete ${t.title}`;
  if (done) {
    return (
      <button type="button" aria-label={label} onClick={onToggle} style={{ width: size, height: size }} className="flex flex-none items-center justify-center rounded-full bg-ok text-ink transition hover:opacity-80">
        <Check size={size * 0.6} strokeWidth={3.5} />
      </button>
    );
  }
  if (t.status === "blocked") {
    return (
      <button type="button" aria-label={label} onClick={onToggle} style={{ width: size, height: size }} className="flex flex-none items-center justify-center rounded-[5px] border-2 border-danger bg-[#2d1517] text-[11px] font-bold leading-none text-danger">
        !
      </button>
    );
  }
  const pct = progressOf(t);
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onToggle}
      style={{ width: size, height: size, background: pct ? `conic-gradient(var(--color-accent) 0 ${pct}%, transparent ${pct}% 100%)` : undefined }}
      className={`flex-none rounded-full border-2 ${ring(t.priority)} transition hover:bg-white/5`}
    />
  );
}

export function RepeatIcon() {
  return <Repeat size={13} className="text-muted" aria-label="Repeats" role="img" />;
}

export function SectionTitle({ children, tone = "muted", id }: { children: ReactNode; tone?: "muted" | "warn"; id?: string }) {
  return (
    <div className="flex items-center gap-2">
      <h2 id={id} className={`m-0 text-xs font-semibold uppercase tracking-[.06em] ${tone === "warn" ? "text-warn" : "text-muted"}`}>
        {children}
      </h2>
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-dashed border-line-strong px-4 py-8 text-center text-sm text-muted">{children}</div>;
}

export function ProgressBar({ pct, w = 60 }: { pct: number; w?: number }) {
  return (
    <span className="inline-block h-1 overflow-hidden rounded bg-line-strong" style={{ width: w }}>
      <span className="block h-1 bg-accent" style={{ width: `${pct}%` }} />
    </span>
  );
}
