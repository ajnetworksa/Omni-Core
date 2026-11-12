import { useQuery } from "@tanstack/react-query";
import { CalendarDays, Inbox, LogOut, Network, Notebook, Search, SquareKanban, Sun } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { NavLink, Route, Routes } from "react-router";
import { api, refreshAll } from "../lib/api";
import type { AiStatus } from "../lib/types";
import { Board } from "./Board";
import { CommandPalette } from "./CommandPalette";
import { Graph } from "./Graph";
import { Notes } from "./Notes";
import { TaskDrawer } from "./TaskDrawer";
import { Today } from "./Today";
import { InboxView, Upcoming } from "./Upcoming";

function Item({ to, icon, label, count }: { to: string; icon: ReactNode; label: string; count?: number }) {
  return (
    <NavLink to={to} end={to === "/"} className={({ isActive }) => `flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm ${isActive ? "bg-[#1a1f2b] text-fg" : "text-fg-2 hover:bg-white/[.04]"}`}>
      {icon}
      <span className="flex-1">{label}</span>
      {count ? <span className="text-xs text-muted">{count}</span> : null}
    </NavLink>
  );
}

function AiLine({ s }: { s: AiStatus }) {
  const paused = !!s.index?.health.lastError;
  const label = !s.enabled ? "AI off" : paused ? "AI paused" : s.local ? `AI · ${s.local.chatModel.split(":")[0]}` : `AI · ${s.cloud?.provider} (cloud)`;
  const tip = !s.enabled
    ? "Set AI_PROVIDER=ollama to turn on Ask, breakdown and summaries."
    : paused
      ? `Can't reach the embedding model: ${s.index!.health.lastError}`
      : [s.local && `Local: ${s.local.chatModel}, ${s.local.embedModel}`, s.cloud && `Cloud: ${s.cloud.provider} ${s.cloud.model} (${s.cloud.mode})`, s.index && `${s.index.chunks} passages indexed (${s.index.engine})`, s.speechToText && "Voice notes on", s.vision && "Photos on"]
          .filter(Boolean)
          .join(" · ");
  return (
    <div className="flex items-center gap-2" title={tip}>
      <span className={`h-2 w-2 rounded-full ${!s.enabled ? "bg-[#4b5263]" : paused ? "bg-warn" : "bg-accent"}`} />
      <span className="flex-1 truncate">{label}</span>
    </div>
  );
}

export function Shell({ mode }: { mode: string }) {
  const [palette, setPalette] = useState(false);
  const today = useQuery({ queryKey: ["today"], queryFn: api.today });
  const projects = useQuery({ queryKey: ["projects"], queryFn: api.projects });
  const inbox = useQuery({ queryKey: ["inbox"], queryFn: api.inbox });
  const ai = useQuery({ queryKey: ["ai"], queryFn: api.ai, staleTime: 60_000, refetchInterval: 120_000 });
  const ver = useQuery({ queryKey: ["version"], queryFn: api.version, staleTime: 3_600_000, refetchInterval: 3_600_000 });
  const health = useQuery({ queryKey: ["health"], queryFn: () => fetch("/health").then((r) => r.json() as Promise<{ telegram: string }>), refetchInterval: 60_000 });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPalette((v) => !v); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const colors = ["#38bdf8", "#f59e0b", "#34d399", "#f472b6", "#a78bfa"];
  const tg = health.data?.telegram;
  return (
    <div className="flex h-full flex-col md:flex-row">
      <nav aria-label="Main" className="flex flex-none flex-col gap-1 border-line bg-panel px-3 py-4 md:w-[240px] md:border-r md:overflow-y-auto">
        <div className="flex items-center gap-2.5 px-2 pb-4">
          <div className="flex h-[26px] w-[26px] items-center justify-center rounded-[7px] bg-accent text-[13px] font-bold text-ink">O</div>
          <span className="text-[15px] font-semibold">OmniCore</span>
        </div>
        <button type="button" onClick={() => setPalette(true)} className="mb-2.5 flex items-center gap-2.5 rounded-lg border border-line-strong bg-[#131720] px-2.5 py-2 text-left text-sm text-muted hover:text-fg-2">
          <Search size={15} aria-hidden />
          <span className="flex-1">{ai.data?.features.ask ? "Search or ask" : "Search or jump"}</span>
          <kbd className="rounded border border-line-strong px-1.5 font-mono text-[11px] text-faint">⌘K</kbd>
        </button>
        <div className="flex flex-row flex-wrap gap-1 md:flex-col">
          <Item to="/" icon={<Sun size={16} className="text-accent" aria-hidden />} label="Today" count={today.data?.counts.open} />
          <Item to="/upcoming" icon={<CalendarDays size={16} aria-hidden />} label="Upcoming" />
          <Item to="/inbox" icon={<Inbox size={16} aria-hidden />} label="Inbox" count={inbox.data?.tasks.length} />
          <Item to="/board" icon={<SquareKanban size={16} aria-hidden />} label="Board" />
          <Item to="/notes" icon={<Notebook size={16} aria-hidden />} label="Notes" />
          <Item to="/graph" icon={<Network size={16} aria-hidden />} label="Graph" />
        </div>
        <div className="hidden px-2.5 pt-5 pb-1.5 text-[11px] font-semibold uppercase tracking-[.06em] text-faint md:block">Projects</div>
        <div className="hidden flex-col gap-0.5 md:flex">
          {projects.data?.map((p, i) => (
            <div key={p.id} className="flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm text-fg-2" title={`${p.done}/${p.total} done${p.blocked ? ` · ${p.blocked} blocked` : ""}`}>
              <span className="h-2 w-2 rounded-sm" style={{ background: colors[i % colors.length] }} />
              <span className="flex-1 truncate">{p.title}</span>
              <span className="text-xs text-faint">{`${p.percent}%`}</span>
            </div>
          ))}
        </div>
        <div className="hidden flex-1 md:block" />
        <div className="mt-3 hidden flex-col gap-1.5 rounded-lg border border-line bg-[#121620] px-2.5 py-2 text-xs text-muted md:flex">
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${tg === "running" ? "bg-ok" : tg === "failed" ? "bg-danger" : "bg-[#4b5263]"}`} />
            <span className="flex-1">{tg === "running" ? "Telegram live" : tg === "failed" ? "Telegram offline" : "Telegram off"}</span>
            {mode === "web" && (
              <button type="button" aria-label="Sign out" onClick={() => void api.logout().then(refreshAll)} className="text-faint hover:text-fg"><LogOut size={14} /></button>
            )}
          </div>
          {ai.data && <AiLine s={ai.data} />}
          {ver.data?.updateAvailable && ver.data.latest ? (
            <a
              href={ver.data.latest.url}
              target="_blank"
              rel="noopener noreferrer"
              title={`You have ${ver.data.version}. On the server run: ${ver.data.updateCommand}`}
              className="flex items-center gap-2 text-ok hover:underline"
            >
              <span className="h-2 w-2 rounded-full bg-ok" />
              <span className="flex-1 truncate">Update {ver.data.latest.version} available</span>
            </a>
          ) : ver.data ? (
            <div className="truncate text-faint" title={ver.data.sha ? `commit ${ver.data.sha}` : undefined}>
              OmniCore {ver.data.version}
            </div>
          ) : null}
        </div>
      </nav>
      <main className="min-h-0 min-w-0 flex-1 overflow-y-auto">
        <Routes>
          <Route path="/" element={<Today />} />
          <Route path="/upcoming" element={<Upcoming />} />
          <Route path="/inbox" element={<InboxView />} />
          <Route path="/board" element={<Board />} />
          <Route path="/notes" element={<Notes />} />
          <Route path="/notes/:id" element={<Notes />} />
          <Route path="/graph" element={<Graph />} />
          <Route path="*" element={<Today />} />
        </Routes>
      </main>
      <TaskDrawer />
      <CommandPalette open={palette} onClose={() => setPalette(false)} />
    </div>
  );
}
