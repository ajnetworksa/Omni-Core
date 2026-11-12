import { useQuery } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { api } from "../lib/api";
import { longDate } from "../lib/format";
import { DailyNote } from "./DailyNote";
import { QuickAdd } from "./QuickAdd";
import { TaskRow } from "./TaskRow";
import { Empty, SectionTitle } from "./ui";

export function Today() {
  const q = useQuery({ queryKey: ["today"], queryFn: api.today });
  const b = q.data;
  if (!b) return <div className="p-10 text-muted">{q.isError ? "Couldn't load today." : "Loading…"}</div>;
  const escalating = b.attention.filter((t) => t.nag && (t.nag.sent > 0 || t.rolloverCount > 0 || t.status === "blocked")).length;
  return (
    <div className="flex min-h-full flex-col lg:flex-row">
      <div className="flex min-w-0 flex-1 flex-col gap-6 px-5 py-7 sm:px-9">
        <header className="flex flex-wrap items-end gap-4">
          <div className="flex-1">
            <div className="text-xs font-medium text-muted">{longDate(b.date)}</div>
            <h1 className="m-0 mt-1 text-[26px] font-semibold tracking-tight">Today</h1>
          </div>
          <div className="flex flex-wrap gap-2">
            {escalating > 0 && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-[#3d2f12] bg-[#1f1a10] px-2.5 py-1.5 text-xs font-medium text-warn">
                <Bell size={13} aria-hidden />
                {`${escalating} escalating`}
              </span>
            )}
            <span className="inline-flex items-center rounded-full border border-line-strong bg-card px-2.5 py-1.5 text-xs text-fg-2">
              {`${b.counts.done} of ${b.counts.done + b.counts.open} done`}
            </span>
          </div>
        </header>
        <QuickAdd today={b.date} />

        {b.attention.length > 0 && (
          <section aria-labelledby="sec-att" className="flex flex-col gap-2">
            <SectionTitle id="sec-att" tone="warn">Needs attention</SectionTitle>
            {b.attention.map((t) => (
              <div key={t.id} className="anim-in"><TaskRow t={t} variant="card" /></div>
            ))}
          </section>
        )}
        <section aria-labelledby="sec-later" className="flex flex-col gap-0.5">
          <div className="mb-1.5"><SectionTitle id="sec-later">Later today</SectionTitle></div>
          {b.later.length === 0 && b.done.length === 0 && b.attention.length === 0 && <Empty>Nothing due today. Add something above or enjoy the quiet.</Empty>}
          {b.later.map((t) => <TaskRow key={t.id} t={t} />)}
          {b.done.map((t) => <TaskRow key={t.id} t={t} />)}
        </section>
        {b.pinned.length > 0 && (
          <section aria-labelledby="sec-pin" className="flex flex-col gap-0.5">
            <div className="mb-1.5"><SectionTitle id="sec-pin">Pinned</SectionTitle></div>
            {b.pinned.map((t) => <TaskRow key={t.id} t={t} />)}
          </section>
        )}
      </div>
      <DailyNote board={b} />
    </div>
  );
}
