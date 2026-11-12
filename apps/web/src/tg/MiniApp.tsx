import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { Navigate, Route, Routes, useNavigate } from "react-router";
import { api, refreshAll } from "../lib/api";
import { Moon, Sun } from "lucide-react";
import { loadTelegram, paintChrome, readThemePref, saveThemePref, type ThemePref, type TgWebApp } from "./telegram";
import { TgProjects, TgToday, TgUpcoming } from "./screens";
import { AddSheet } from "./AddSheet";
import { NewProjectSheet, TgProject } from "./TgProject";
import { TgTask } from "./TgTask";

type Auth = "checking" | "ok" | "outside" | "denied";

/**
 * Telegram Mini App shell, Paper style (mockup B). Lives at /tg/*. It uses its own Paper palette —
 * light by default, "Paper night" if you pick it (or "auto" follows Telegram) — and paints Telegram's
 * header, background and main button to match.
 */
export function MiniApp() {
  const [tg, setTg] = useState<TgWebApp | null>(null);
  const [auth, setAuth] = useState<Auth>("checking");
  const [pref, setPref] = useState<ThemePref>(readThemePref);
  const [tgDark, setTgDark] = useState(window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false);
  const dark = pref === "dark" || (pref === "auto" && tgDark);
  const [adding, setAdding] = useState(false);
  const [newProject, setNewProject] = useState(false);
  useEffect(() => paintChrome(tg, dark), [tg, dark, adding, newProject]);
  const cycleTheme = useCallback(() => {
    setPref((p) => {
      const next: ThemePref = p === "light" ? "dark" : p === "dark" ? "auto" : "light";
      saveThemePref(next);
      return next;
    });
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      const w = await loadTelegram();
      if (!alive) return;
      setTg(w);
      if (w) {
        w.ready();
        w.expand();
        setTgDark(w.colorScheme === "dark");
        const onTheme = () => setTgDark(w.colorScheme === "dark");
        w.onEvent("themeChanged", onTheme);
      }
      const me = await api.me().catch(() => ({ authenticated: false }));
      if (me.authenticated) return alive && setAuth("ok");
      if (!w) return alive && setAuth("outside");
      try {
        await api.loginTelegram(w.initData);
        await refreshAll();
        if (alive) setAuth("ok");
      } catch {
        if (alive) setAuth("denied");
      }
    })();
    return () => { alive = false; };
  }, []);

  if (auth !== "ok") {
    const msg =
      auth === "checking" ? "Loading…" : auth === "denied" ? "This Telegram account isn't allowed. Add your user id to TELEGRAM_ALLOWED_USER_IDS." : "Open OmniCore from the Telegram bot (the Open button), or sign in on the web app first.";
    return (
      <div className={`tg ${dark ? "tg-dark" : ""} flex items-center justify-center px-8 text-center font-sans`}>
        <p className="text-[15px]" style={{ color: "var(--tg-hint)" }}>{msg}</p>
      </div>
    );
  }
  return (
    <div className={`tg ${dark ? "tg-dark" : ""} flex flex-col font-sans`}>
      <Routes>
        <Route index element={<Tabs tab="today" tg={tg} onAdd={() => setAdding(true)} adding={adding || newProject} theme={{ pref, cycle: cycleTheme }} />} />
        <Route path="upcoming" element={<Tabs tab="upcoming" tg={tg} onAdd={() => setAdding(true)} adding={adding || newProject} theme={{ pref, cycle: cycleTheme }} />} />
        <Route path="projects" element={<Tabs tab="projects" tg={tg} onAdd={() => setNewProject(true)} adding={adding || newProject} theme={{ pref, cycle: cycleTheme }} />} />
        <Route path="project/:slug" element={<TgProject tg={tg} />} />
        <Route path="task/:id" element={<TgTask tg={tg} />} />
        <Route path="*" element={<Navigate to="/tg" replace />} />
      </Routes>
      {adding && <AddSheet tg={tg} onClose={() => setAdding(false)} />}
      {newProject && <NewProjectSheet tg={tg} onClose={() => setNewProject(false)} />}
    </div>
  );
}

function Tabs({ tab, tg, onAdd, adding, theme }: { tab: "today" | "upcoming" | "projects"; tg: TgWebApp | null; onAdd: () => void; adding: boolean; theme: { pref: ThemePref; cycle: () => void } }) {
  const navigate = useNavigate();
  const today = useQuery({ queryKey: ["today"], queryFn: api.today });
  // Native Telegram main button = "New task" on list screens (hidden while the add sheet owns it).
  const click = useCallback(() => onAdd(), [onAdd]);
  useEffect(() => {
    if (!tg || adding) return;
    tg.BackButton.hide();
    tg.MainButton.setText(tab === "projects" ? "New project" : "New task").show().enable();
    tg.MainButton.onClick(click);
    return () => { tg.MainButton.offClick(click); };
  }, [tg, click, adding, tab]);
  const tabs = [["today", "Today", "/tg"], ["upcoming", "Upcoming", "/tg/upcoming"], ["projects", "Projects", "/tg/projects"]] as const;
  return (
    <>
      <div className="flex items-center gap-2 px-5 pb-2 pt-5">
        <div role="tablist" aria-label="Views" className="grid flex-1 grid-cols-3 gap-1 rounded-xl p-1" style={{ background: "var(--tg-chip)" }}>
          {tabs.map(([id, label, to]) => (
            <button key={id} role="tab" aria-selected={tab === id} type="button" onClick={() => navigate(to)} className="rounded-[9px] py-2 text-[14px] font-medium" style={tab === id ? { background: "var(--tg-section)", color: "var(--tg-fg)", boxShadow: "0 1px 2px rgba(0,0,0,.08)" } : { color: "var(--tg-hint)" }}>
              {label}
            </button>
          ))}
        </div>
        <button type="button" onClick={theme.cycle} aria-label={`Theme: ${theme.pref}. Tap to change.`} title={`Theme: ${theme.pref === "auto" ? "follow Telegram" : theme.pref}`} className="flex h-10 w-10 flex-none items-center justify-center rounded-xl text-[11px] font-bold" style={{ background: "var(--tg-chip)", color: "var(--tg-hint)" }}>
          {theme.pref === "light" ? <Sun size={18} aria-hidden /> : theme.pref === "dark" ? <Moon size={18} aria-hidden /> : "A"}
        </button>
      </div>
      <div className="flex-1 pb-28">
        {tab === "today" && <TgToday data={today.data} />}
        {tab === "upcoming" && <TgUpcoming today={today.data?.date} />}
        {tab === "projects" && <TgProjects onNew={onAdd} />}
      </div>
      {!tg && (
        <div className="fixed inset-x-0 bottom-0 p-4" style={{ background: "linear-gradient(to top, var(--tg-bg) 70%, transparent)" }}>
          <button type="button" onClick={onAdd} className="h-[52px] w-full rounded-[14px] text-[16px] font-semibold" style={{ background: "var(--tg-accent)", color: "var(--tg-accent-fg)" }}>{tab === "projects" ? "New project" : "New task"}</button>
        </div>
      )}
    </>
  );
}
