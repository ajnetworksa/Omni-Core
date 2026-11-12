import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { api } from "../lib/api";
import { dayLabel } from "../lib/format";
import { TaskRow } from "./TaskRow";
import { Empty, SectionTitle } from "./ui";

export function Upcoming() {
  const today = useQuery({ queryKey: ["today"], queryFn: api.today });
  const q = useQuery({ queryKey: ["upcoming"], queryFn: () => api.upcoming(21) });
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 px-5 py-7 sm:px-9">
      <h1 className="m-0 text-[26px] font-semibold tracking-tight">Upcoming</h1>
      {q.data?.length === 0 && <Empty>Nothing scheduled for the next three weeks.</Empty>}
      {q.data?.map((g) => (
        <section key={g.date} aria-label={g.date} className="flex flex-col gap-0.5">
          <div className="mb-1.5">
            <SectionTitle>
              {today.data ? dayLabel(g.date, today.data.date) : g.date}
              <span className="ml-2 font-mono normal-case tracking-normal text-faint">{g.date}</span>
            </SectionTitle>
          </div>
          {g.tasks.map((t) => <TaskRow key={t.id} t={t} />)}
        </section>
      ))}
    </div>
  );
}

export function InboxView() {
  const q = useQuery({ queryKey: ["inbox"], queryFn: api.inbox });
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 px-5 py-7 sm:px-9">
      <div>
        <h1 className="m-0 text-[26px] font-semibold tracking-tight">Inbox</h1>
        <p className="m-0 mt-1 text-sm text-muted">Tasks without a date, and notes captured from Telegram.</p>
      </div>
      <section aria-labelledby="ib-t" className="flex flex-col gap-0.5">
        <div className="mb-1.5"><SectionTitle id="ib-t">No date</SectionTitle></div>
        {q.data?.tasks.length === 0 && <Empty>Every task has a date. Nice.</Empty>}
        {q.data?.tasks.map((t) => <TaskRow key={t.id} t={t} />)}
      </section>
      <section aria-labelledby="ib-n" className="flex flex-col gap-1">
        <div className="mb-1.5"><SectionTitle id="ib-n">Captured notes</SectionTitle></div>
        {q.data?.notes.map((n) => (
          <Link key={n.id} to={`/notes/${n.id}`} className="flex items-center justify-between rounded-lg px-3.5 py-2.5 hover:bg-white/[.03]">
            <span>{n.title}</span>
            <span className="font-mono text-xs text-faint">{n.path}</span>
          </Link>
        ))}
      </section>
    </div>
  );
}
