import { useQuery } from "@tanstack/react-query";
import { BookOpen, CalendarDays, ChevronRight, FolderOpen, HelpCircle, LayoutGrid, Network, NotebookPen, Plus, Search, Settings as SettingsIcon, Sun, Trash2 } from "lucide-react";
import { useState } from "react";
import { useNavigate, useParams } from "react-router";
import { api, refreshAll } from "../lib/api";
import { dayLabel } from "../lib/format";
import { haptic } from "../tg/telegram";
import { AddSheet } from "./AddSheet";
import { useBack, usePlatform, usePrimary, useTo } from "./platform";
import { Button, Card, Confirm, Empty, Group, hint, PageTitle, Ring, Sheet, TaskRow, useToast } from "./ui";

const longDay = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

// ---------------------------------------------------------------- Today
export function TodayScreen() {
  const q = useQuery({ queryKey: ["today"], queryFn: api.today });
  const prefs = useQuery({ queryKey: ["prefs"], queryFn: api.prefs, staleTime: 60_000 });
  const [adding, setAdding] = useState(false);
  const navigate = useNavigate();
  const to = useTo();
  usePrimary(adding ? null : { label: "New task", onClick: () => setAdding(true) }, [adding]);
  const d = q.data;
  if (!d) return <p className="px-6 py-10 text-center" style={hint}>Loading…</p>;
  const total = d.counts.open + d.counts.done;
  const name = prefs.data?.name;
  const hour = new Date().getHours();
  const hello = `${hour < 5 ? "Good night" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening"}${name ? `, ${name}` : ""}`;
  return (
    <div className="flex flex-col gap-5 pb-28">
      <PageTitle icon={<Sun size={28} style={{ color: "var(--tg-accent)" }} aria-hidden />} title="Today" sub={`${longDay(d.date)} · ${total ? `${d.counts.done} of ${total} done` : hello}`} />
      {prefs.data?.pausedUntil && (
        <div className="mx-4 rounded-[14px] px-4 py-3 text-[14px]" style={{ background: "var(--tg-note-bg)", color: "var(--tg-note-fg)", boxShadow: "0 0 0 1px var(--tg-note-line)" }}>
          🔕 Reminders are paused until {new Date(prefs.data.pausedUntil).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" })}.{" "}
          <button type="button" className="font-semibold underline" onClick={async () => { await api.pause(0); await refreshAll(); }}>Resume now</button>
        </div>
      )}
      {d.attention.length > 0 && (
        <Group title="Needs you now" warn help="Tasks whose time has come (or passed), and ones you marked as partly done or waiting. I keep reminding you about these until you act.">
          <Card>{d.attention.map((t) => <TaskRow key={t.id} t={t} chevron />)}</Card>
        </Group>
      )}
      {(d.later.length > 0 || d.done.length > 0) && (
        <Group title="Later today">
          <div className="flex flex-col">{[...d.later, ...d.done].map((t) => <TaskRow key={t.id} t={t} />)}</div>
        </Group>
      )}
      {total === 0 && (
        <Empty title="Nothing for today" text="Add something you want to get done. Give it a time and I'll remind you until it's finished.">
          <Button tone="accent" className="mt-2" onClick={() => setAdding(true)}><Plus size={17} aria-hidden />New task</Button>
        </Empty>
      )}
      <div className="px-4">
        <button type="button" onClick={() => navigate(to("/notes/daily"))} className="flex w-full items-center gap-3 rounded-[18px] px-4 py-3.5 text-left" style={{ background: "var(--tg-section)", boxShadow: "var(--tg-ring)" }}>
          <NotebookPen size={20} style={{ color: "var(--tg-accent)" }} aria-hidden />
          <span className="flex flex-1 flex-col">
            <span className="text-[15.5px] font-semibold">Today's note</span>
            <span className="text-[13.5px]" style={hint}>What you sent me today, and the morning / evening summary</span>
          </span>
          <ChevronRight size={16} style={hint} aria-hidden />
        </button>
      </div>
      {adding && <AddSheet onClose={() => setAdding(false)} />}
    </div>
  );
}

// ---------------------------------------------------------------- Upcoming
export function UpcomingScreen() {
  const q = useQuery({ queryKey: ["upcoming"], queryFn: () => api.upcoming(14) });
  const inbox = useQuery({ queryKey: ["inbox"], queryFn: api.inbox });
  const today = useQuery({ queryKey: ["today"], queryFn: api.today });
  const [adding, setAdding] = useState(false);
  usePrimary(adding ? null : { label: "New task", onClick: () => setAdding(true) }, [adding]);
  const undated = inbox.data?.tasks ?? [];
  return (
    <div className="flex flex-col gap-5 pb-28 pt-2">
      <PageTitle icon={<CalendarDays size={26} style={{ color: "var(--tg-accent)" }} aria-hidden />} title="Upcoming" sub="The next two weeks" />
      {q.data?.length === 0 && <Empty title="Nothing planned" text="Tasks with a date in the next two weeks show up here." />}
      {q.data?.map((g) => (
        <Group key={g.date} title={today.data ? `${dayLabel(g.date, today.data.date)}${dayLabel(g.date, today.data.date).includes(" ") ? "" : ` · ${longDay(g.date)}`}` : g.date}>
          <Card>{g.tasks.map((t) => <TaskRow key={t.id} t={t} chevron />)}</Card>
        </Group>
      ))}
      {undated.length > 0 && (
        <Group title="No date yet" help="Tasks without a date never remind you. Open one and pick a day when you're ready.">
          <Card>{undated.map((t) => <TaskRow key={t.id} t={t} chevron />)}</Card>
        </Group>
      )}
      {adding && <AddSheet onClose={() => setAdding(false)} />}
    </div>
  );
}

// ---------------------------------------------------------------- Projects
export function ProjectsScreen() {
  const q = useQuery({ queryKey: ["projects"], queryFn: api.projects });
  const navigate = useNavigate();
  const to = useTo();
  const [creating, setCreating] = useState(false);
  usePrimary(creating ? null : { label: "New project", onClick: () => setCreating(true) }, [creating]);
  return (
    <div className="flex flex-col gap-4 pb-28 pt-2">
      <PageTitle icon={<FolderOpen size={26} style={{ color: "var(--tg-accent)" }} aria-hidden />} title="Projects" sub="Group related tasks. Each project is a note in your vault." />
      <div className="flex flex-col gap-3 px-4">
        {q.data && q.data.length > 0 && (
          <Card>
            {q.data.map((p) => (
              <button key={p.id} type="button" onClick={() => navigate(to(`/project/${encodeURIComponent(p.slug)}`))} className="flex w-full items-center gap-3.5 px-4 py-3.5 text-left">
                <Ring percent={p.percent} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[16px] font-semibold">{p.title}</span>
                  <span className="text-[13.5px]" style={{ color: p.overdue || p.blocked ? "var(--tg-warn)" : "var(--tg-hint)" }}>
                    {p.total ? [`${p.done} of ${p.total} done`, p.overdue ? `${p.overdue} late` : "", p.blocked ? `${p.blocked} waiting` : "", p.dueToday ? `${p.dueToday} today` : ""].filter(Boolean).join(" · ") : "No tasks yet"}
                  </span>
                </span>
                <ChevronRight size={16} style={hint} aria-hidden />
              </button>
            ))}
          </Card>
        )}
        {q.data?.length === 0 && <Empty title="No projects yet" text="A project groups tasks that belong together, like “Home lab” or “Move house”." />}
      </div>
      {creating && <NewProjectSheet onClose={() => setCreating(false)} />}
    </div>
  );
}

export function ProjectScreen() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const to = useTo();
  const toast = useToast();
  const q = useQuery({ queryKey: ["project", slug], queryFn: () => api.project(slug!), enabled: !!slug });
  const [adding, setAdding] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [keepTasks, setKeepTasks] = useState(true);
  const p = q.data;
  useBack(() => navigate(to("/projects")));
  usePrimary(!adding && !deleting && p ? { label: `Add to ${p.title}`, onClick: () => setAdding(true) } : null, [adding, deleting, p?.title]);
  if (q.isError) return <Empty title="Not found" text="That project doesn't exist any more." />;
  if (!p) return <p className="px-6 py-10 text-center" style={hint}>Loading…</p>;
  return (
    <div className="flex flex-col gap-5 pb-28 pt-4">
      <div className="flex items-center gap-3.5 px-6">
        <Ring percent={p.percent} size={40} />
        <div className="flex min-w-0 flex-1 flex-col">
          <h1 className="m-0 truncate font-display text-[26px] font-extrabold tracking-tight">{p.title}</h1>
          <span className="text-[14px]" style={hint}>{[`${p.done} of ${p.total} done`, p.overdue ? `${p.overdue} late` : "", p.blocked ? `${p.blocked} waiting` : ""].filter(Boolean).join(" · ")}</span>
        </div>
        <button type="button" onClick={() => setDeleting(true)} aria-label={`Delete project ${p.title}`} className="rounded-full p-2" style={hint}><Trash2 size={18} /></button>
      </div>
      {p.openTasks.length > 0 ? (
        <Group title="To do">
          <Card>{p.openTasks.map((t) => <TaskRow key={t.id} t={t} chevron inProject />)}</Card>
        </Group>
      ) : (
        <Empty title={p.total ? "All done here" : "No tasks yet"} text={p.total ? "Nice. Add the next thing when it comes up." : "Add the first one with the button below."} />
      )}
      {p.doneTasks.length > 0 && (
        <section className="flex flex-col gap-1 px-4" aria-label="Done">
          <button type="button" onClick={() => setShowDone((v) => !v)} className="self-start px-1.5 font-display text-[14.5px] font-bold" style={hint}>
            {showDone ? "Hide" : "Show"} {p.doneTasks.length} done
          </button>
          {showDone && <div className="flex flex-col">{p.doneTasks.map((t) => <TaskRow key={t.id} t={t} inProject />)}</div>}
        </section>
      )}
      {adding && <AddSheet project={{ slug: p.slug, title: p.title }} onClose={() => setAdding(false)} />}
      {deleting && (
        <Confirm
          title={`Delete “${p.title}”?`}
          text={<>The project's note goes to the vault's trash folder (<code>.trash</code>), so you can still find it in Obsidian.</>}
          confirm="Delete project"
          onClose={() => setDeleting(false)}
          onConfirm={async () => {
            const r = await api.deleteProject(p.slug, keepTasks);
            haptic.ok();
            setDeleting(false);
            await refreshAll();
            toast.show({ text: `Deleted ${r.title}${r.tasksKept ? ` · kept ${r.tasksKept} task${r.tasksKept > 1 ? "s" : ""}` : r.tasksDeleted ? ` and ${r.tasksDeleted} task${r.tasksDeleted > 1 ? "s" : ""}` : ""}` });
            navigate(to("/projects"));
          }}
        >
          {p.total > 0 && (
            <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
              <legend className="mb-1 text-[14px] font-semibold">Its {p.total} task{p.total > 1 ? "s" : ""}:</legend>
              {[[true, "Keep them (they stay in your lists, just not in a project)"], [false, "Delete them too"]].map(([v, label]) => (
                <label key={String(v)} className="flex items-center gap-3 rounded-[12px] px-3 py-2.5 text-[15px]" style={{ background: keepTasks === v ? "var(--tg-accent-soft)" : "var(--tg-secondary)" }}>
                  <input type="radio" name="keep" checked={keepTasks === v} onChange={() => setKeepTasks(v as boolean)} />
                  {label as string}
                </label>
              ))}
            </fieldset>
          )}
        </Confirm>
      )}
    </div>
  );
}

export function NewProjectSheet({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const to = useTo();
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const submit = async () => {
    if (!name.trim()) return;
    try {
      const p = await api.createProject(name.trim());
      haptic.ok();
      await refreshAll();
      onClose();
      navigate(to(`/project/${encodeURIComponent(p.slug)}`));
    } catch {
      haptic.err();
      setError("Couldn't create it. Try a different name.");
    }
  };
  usePrimary({ label: "Create project", onClick: () => void submit(), enabled: !!name.trim() }, [name]);
  useBack(onClose);
  const { tg } = usePlatform();
  return (
    <Sheet title="New project" onClose={onClose}>
      <label htmlFor="new-proj" className="sr-only">Project name</label>
      <input id="new-proj" autoFocus value={name} maxLength={80} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void submit()} placeholder="e.g. Home lab" className="rounded-[14px] px-3.5 py-3 text-[16.5px] outline-none" style={{ background: "var(--tg-secondary)", color: "var(--tg-fg)" }} />
      <span className="text-[12.5px]" style={hint}>Creates <code>projects/{name.trim() ? name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") : "name"}.md</code> in your notes.</span>
      {error && <p className="m-0 text-[13px]" style={{ color: "var(--tg-danger)" }}>{error}</p>}
      {!tg && <Button tone="accent" disabled={!name.trim()} onClick={() => void submit()}>Create project</Button>}
    </Sheet>
  );
}

// ---------------------------------------------------------------- More (phones / Telegram)
export function MoreScreen() {
  const navigate = useNavigate();
  const to = useTo();
  const { tg } = usePlatform();
  const items: [string, string, string, typeof Sun][] = [
    ["/notes", "Notes", "Your Markdown notes (the same files Obsidian sees)", BookOpen],
    ["/search", "Search", "Find tasks and notes, or ask a question about them", Search],
    ["/board", "Board", "All tasks as columns: To do, Doing, Waiting, Done", LayoutGrid],
    ...(tg ? [] : [["/map", "Map", "How your notes link to each other", Network] as [string, string, string, typeof Sun]]),
    ["/settings", "Settings", "Reminders, daily summaries, time zone, look, updates", SettingsIcon],
    ["/help", "Help & guide", "How it works, in five short steps", HelpCircle],
  ];
  return (
    <div className="flex flex-col gap-4 pb-10 pt-2">
      <PageTitle title="More" />
      <div className="px-4">
        <Card>
          {items.map(([path, label, sub, Icon]) => (
            <button key={path} type="button" onClick={() => navigate(to(path))} className="flex w-full items-center gap-3.5 px-4 py-3.5 text-left">
              <span className="flex h-9 w-9 flex-none items-center justify-center rounded-[10px]" style={{ background: "var(--tg-accent-soft)", color: "var(--tg-link)" }}><Icon size={18} aria-hidden /></span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-[16px] font-semibold">{label}</span>
                <span className="text-[13.5px]" style={hint}>{sub}</span>
              </span>
              <ChevronRight size={16} style={hint} aria-hidden />
            </button>
          ))}
        </Card>
      </div>
    </div>
  );
}
