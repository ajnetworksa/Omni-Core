import { useQuery } from "@tanstack/react-query";
import { CalendarDays, ChevronLeft, FolderOpen, HelpCircle, LayoutGrid, LogOut, MoreHorizontal, Network, NotebookPen, Plus, Search, Settings as SettingsIcon, Sun } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate, useParams } from "react-router";
import { api, ApiError, refreshAll } from "../lib/api";
import { Board } from "../web/Board";
import { CommandPalette } from "../web/CommandPalette";
import { DailyNote } from "../web/DailyNote";
import { Graph } from "../web/Graph";
import { Notes } from "../web/Notes";
import { AddSheet } from "./AddSheet";
import { HelpScreen, Welcome } from "./HelpScreen";
import { usePlatform, usePrefsTheme, usePrimary, useBack, useTo } from "./platform";
import { MoreScreen, ProjectScreen, ProjectsScreen, TodayScreen, UpcomingScreen } from "./screens";
import { SettingsScreen } from "./SettingsScreen";
import { TaskScreen } from "./TaskScreen";
import { hint, ToastHost } from "./ui";

/**
 * The one app: same screens and words on the web and in Telegram.
 *   wide browser   → sidebar + content
 *   phone/Telegram → tabs (Today · Upcoming · Projects · More) + content
 * The screen's main action is Telegram's big button in the Mini App, or a button at the bottom here.
 */
export function AppFrame({ onSignOut }: { onSignOut?: () => void }) {
  const p = usePlatform();
  const prefs = usePrefsTheme(p.tg, true);
  const to = useTo();
  const navigate = useNavigate();
  const loc = useLocation();
  const [palette, setPalette] = useState(false);
  const [adding, setAdding] = useState(false);

  // Open on the start screen chosen in Settings (once, when landing on the root).
  const started = useRef(false);
  useEffect(() => {
    if (started.current || !prefs) return;
    started.current = true;
    const root = loc.pathname === (p.base || "/") || loc.pathname === `${p.base}/`;
    if (root && prefs.startScreen !== "today") navigate(to(`/${prefs.startScreen}`), { replace: true });
  }, [prefs]); // eslint-disable-line react-hooks/exhaustive-deps

  // ⌘K / Ctrl-K: search (web).
  useEffect(() => {
    if (p.tg) return;
    const k = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette(true);
      }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [p.tg]);

  const content = (
    <Routes>
      <Route index element={<TodayScreen />} />
      <Route path="today" element={<Navigate to={to("/")} replace />} />
      <Route path="upcoming" element={<UpcomingScreen />} />
      <Route path="projects" element={<ProjectsScreen />} />
      <Route path="project/:slug" element={<ProjectScreen />} />
      <Route path="task/:id" element={<TaskScreen />} />
      <Route path="more" element={<MoreScreen />} />
      <Route path="settings" element={<SettingsScreen />} />
      <Route path="help" element={<HelpScreen />} />
      <Route path="notes/daily" element={<DailyScreen />} />
      <Route path="notes/:id?" element={<Page title="Notes" icon={<NotebookPen size={24} />} flush><Notes /></Page>} />
      <Route path="board" element={<Page title="Board" icon={<LayoutGrid size={24} />} sub="Drag a card to change it. Tap one to open it."><Board /></Page>} />
      <Route path="map" element={<Page title="Map" icon={<Network size={24} />} sub="Your notes and the links between them."><Graph /></Page>} />
      <Route path="search" element={<SearchScreen />} />
      {/* old addresses */}
      <Route path="graph" element={<Navigate to={to("/map")} replace />} />
      <Route path="inbox" element={<Navigate to={to("/upcoming")} replace />} />
      <Route path="*" element={<Navigate to={to("/")} replace />} />
    </Routes>
  );

  return (
    <ToastHost>
      <div className="tg min-h-full">
        {p.wide ? (
          <div className="mx-auto flex min-h-screen max-w-[1320px]">
            <Sidebar onSearch={() => setPalette(true)} onAdd={() => setAdding(true)} onSignOut={onSignOut} />
            <main className="flex min-w-0 flex-1 flex-col">
              <div className="mx-auto flex w-full max-w-[760px] flex-1 flex-col pt-6">
                <BackBar />
                {content}
              </div>
              <PrimaryBar />
            </main>
          </div>
        ) : (
          <div className="flex min-h-screen flex-col">
            <Tabs />
            {!p.tg && <BackBar />}
            <div className="flex-1">{content}</div>
            {!p.tg && <PrimaryBar />}
          </div>
        )}
        <Welcome />
        {!p.tg && <CommandPalette open={palette} onClose={() => setPalette(false)} />}
        {adding && <AddSheet onClose={() => setAdding(false)} />}
      </div>
    </ToastHost>
  );
}

/** Web: the screen's main action as a button pinned to the bottom (Telegram has its own). */
function PrimaryBar() {
  const { primary, tg } = usePlatform();
  if (tg || !primary) return null;
  return (
    <div className="sticky bottom-0 z-20 mx-auto w-full max-w-[760px] px-4 pb-4 pt-3" style={{ background: "linear-gradient(to top, var(--tg-bg) 70%, transparent)" }}>
      <button type="button" disabled={primary.enabled === false} onClick={primary.onClick} className="h-[52px] w-full rounded-[14px] text-[16px] font-semibold disabled:opacity-50" style={{ background: "var(--tg-accent)", color: "var(--tg-accent-fg)" }}>
        {primary.label}
      </button>
    </div>
  );
}

function BackBar() {
  const { back, tg } = usePlatform();
  if (tg || !back) return null;
  return (
    <button type="button" onClick={back} className="mb-1 inline-flex items-center gap-0.5 self-start px-4 pt-3 text-[15px]" style={{ color: "var(--tg-link)" }}>
      <ChevronLeft size={18} aria-hidden />Back
    </button>
  );
}

/** Phones and Telegram: four tabs, shown on the main screens. */
function Tabs() {
  const to = useTo();
  const { base } = usePlatform();
  const loc = useLocation();
  const path = loc.pathname.slice(base.length) || "/";
  const tabs: [string, string][] = [["/", "Today"], ["/upcoming", "Upcoming"], ["/projects", "Projects"], ["/more", "More"]];
  if (!tabs.some(([t]) => t === path)) return null;
  return (
    <div className="px-5 pb-2 pt-5">
      <div role="tablist" aria-label="Views" className="grid grid-cols-4 gap-1 rounded-xl p-1" style={{ background: "var(--tg-chip)" }}>
        {tabs.map(([t, label]) => (
          <NavLink key={t} to={to(t)} end role="tab" aria-selected={path === t} className="flex items-center justify-center gap-1 rounded-[9px] py-2 text-[14.5px] font-medium" style={path === t ? { background: "var(--tg-section)", color: "var(--tg-fg)", boxShadow: "0 1px 2px rgba(0,0,0,.08)" } : { color: "var(--tg-hint)" }}>
            {label === "More" ? <><MoreHorizontal size={16} aria-hidden />More</> : label}
          </NavLink>
        ))}
      </div>
    </div>
  );
}

function Sidebar({ onSearch, onAdd, onSignOut }: { onSearch: () => void; onAdd: () => void; onSignOut?: () => void }) {
  const today = useQuery({ queryKey: ["today"], queryFn: api.today });
  const version = useQuery({ queryKey: ["version"], queryFn: api.version, staleTime: 10 * 60_000 });
  const n = today.data ? today.data.attention.length + today.data.later.length : 0;
  const item = (to: string, label: string, Icon: typeof Sun, count?: number) => (
    <NavLink to={to} end={to === "/"} className="flex items-center gap-3 rounded-[12px] px-3 py-2 text-[15px]" style={({ isActive }) => (isActive ? { background: "var(--tg-section)", boxShadow: "var(--tg-ring)", fontWeight: 600 } : { color: "var(--tg-fg-2)" })}>
      <Icon size={18} aria-hidden style={{ color: "var(--tg-accent)" }} />
      <span className="flex-1">{label}</span>
      {count ? <span className="text-[13px]" style={hint}>{count}</span> : null}
    </NavLink>
  );
  return (
    <aside className="sticky top-0 flex h-screen w-[260px] flex-none flex-col gap-1 px-4 py-6">
      <div className="flex items-center gap-2.5 px-2 pb-4">
        <span className="flex h-8 w-8 items-center justify-center rounded-[10px] font-display text-[16px] font-extrabold" style={{ background: "var(--tg-accent)", color: "var(--tg-accent-fg)" }}>O</span>
        <span className="font-display text-[18px] font-extrabold tracking-tight">OmniCore</span>
      </div>
      <button type="button" onClick={onAdd} className="mb-1 flex h-11 items-center justify-center gap-2 rounded-[12px] text-[15px] font-semibold" style={{ background: "var(--tg-accent)", color: "var(--tg-accent-fg)" }}>
        <Plus size={17} aria-hidden />New task
      </button>
      <button type="button" onClick={onSearch} className="mb-3 flex h-10 items-center gap-2 rounded-[12px] px-3 text-[14.5px]" style={{ background: "var(--tg-chip)", color: "var(--tg-hint)" }}>
        <Search size={16} aria-hidden /><span className="flex-1 text-left">Search or ask</span><kbd className="text-[12px]">Ctrl K</kbd>
      </button>
      <nav aria-label="Main" className="flex flex-col gap-0.5">
        {item("/", "Today", Sun, n)}
        {item("/upcoming", "Upcoming", CalendarDays)}
        {item("/projects", "Projects", FolderOpen)}
        {item("/notes", "Notes", NotebookPen)}
        {item("/board", "Board", LayoutGrid)}
        {item("/map", "Map", Network)}
      </nav>
      <div className="flex-1" />
      <nav aria-label="App" className="flex flex-col gap-0.5">
        {item("/settings", "Settings", SettingsIcon)}
        {item("/help", "Help & guide", HelpCircle)}
        {onSignOut && (
          <button type="button" onClick={onSignOut} className="flex items-center gap-3 rounded-[12px] px-3 py-2 text-[15px]" style={hint}>
            <LogOut size={18} aria-hidden />Sign out
          </button>
        )}
      </nav>
      {version.data?.updateAvailable && (
        <NavLink to="/settings" className="mt-2 rounded-[12px] px-3 py-2 text-[13px]" style={{ background: "var(--tg-note-bg)", color: "var(--tg-note-fg)" }}>
          Version {version.data.latest?.version} is available. How to update ›
        </NavLink>
      )}
    </aside>
  );
}

/** Wrapper for the web-born screens (Notes, Board, Map) so they get the same title and spacing. */
function Page({ title, icon, sub, children, flush }: { title: string; icon: ReactNode; sub?: string; children: ReactNode; flush?: boolean }) {
  const { wide } = usePlatform();
  const { id } = useParams();
  const showTitle = !(flush && id && !wide);
  return (
    <div className="flex flex-col gap-4 pb-10 pt-2">
      {showTitle && (
        <div className="flex flex-col gap-0.5 px-6">
          <div className="flex items-center gap-2.5" style={{ color: "var(--tg-accent)" }}>
            {icon}
            <h1 className="m-0 font-display text-[30px] font-extrabold tracking-tight" style={{ color: "var(--tg-fg)" }}>{title}</h1>
          </div>
          {sub && <div className="pl-[34px] text-[14px]" style={hint}>{sub}</div>}
        </div>
      )}
      <div className={flush ? "" : "px-4"}>{children}</div>
    </div>
  );
}

function DailyScreen() {
  const today = useQuery({ queryKey: ["today"], queryFn: api.today });
  const navigate = useNavigate();
  const to = useTo();
  useBack(() => navigate(to("/")));
  usePrimary(null, []);
  return (
    <Page title="Today's note" icon={<NotebookPen size={24} />} sub="Everything you sent me today, and the daily summaries.">
      {today.data ? <DailyNote board={today.data} /> : <p style={hint}>Loading…</p>}
    </Page>
  );
}

function SearchScreen() {
  const navigate = useNavigate();
  const to = useTo();
  useBack(() => navigate(to("/more")));
  return <CommandPalette open inline onClose={() => navigate(to("/more"))} />;
}

/** Web sign-in, then the app. */
export function useSignOut() {
  return async () => {
    try {
      await api.logout();
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
    }
    await refreshAll();
    window.location.href = "/";
  };
}
