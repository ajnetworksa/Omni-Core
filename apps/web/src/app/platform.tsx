import { Link, useNavigate, type LinkProps } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "../lib/api";
import { paintChrome, type TgWebApp } from "../tg/telegram";

/**
 * Where the app is running: inside Telegram (Mini App, routes under /tg) or in a browser.
 * Screens never check that themselves; they ask for a main button and a back action, and the
 * frame shows them the right way: Telegram's own buttons, or a button in the page.
 */
export interface Primary {
  label: string;
  onClick: () => void;
  enabled?: boolean;
  tone?: "accent" | "danger";
}
interface Platform {
  tg: TgWebApp | null;
  /** "/tg" in Telegram, "" on the web. */
  base: string;
  /** Wide browser window: sidebar layout. */
  wide: boolean;
  primary: Primary | null;
  setPrimary: (p: Primary | null, owner: symbol) => void;
  back: (() => void) | null;
  setBack: (fn: (() => void) | null, owner: symbol) => void;
}
const Ctx = createContext<Platform | null>(null);
export const usePlatform = () => useContext(Ctx)!;
export const useTo = () => {
  const { base } = usePlatform();
  return (path: string) => `${base}${path === "/" ? "" : path}` || "/";
};

export function PlatformProvider({ tg, base, children }: { tg: TgWebApp | null; base: string; children: ReactNode }) {
  const [wide, setWide] = useState(() => !tg && window.matchMedia("(min-width: 1000px)").matches);
  useEffect(() => {
    if (tg) return;
    const m = window.matchMedia("(min-width: 1000px)");
    const on = () => setWide(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, [tg]);
  // The latest screen to ask wins; when it unmounts, its button goes away.
  const [primary, setP] = useState<{ p: Primary; owner: symbol } | null>(null);
  const [back, setB] = useState<{ fn: () => void; owner: symbol } | null>(null);
  const value: Platform = {
    tg,
    base,
    wide,
    primary: primary?.p ?? null,
    setPrimary: (p, owner) => setP((cur) => (p ? { p, owner } : cur?.owner === owner ? null : cur)),
    back: back?.fn ?? null,
    setBack: (fn, owner) => setB((cur) => (fn ? { fn, owner } : cur?.owner === owner ? null : cur)),
  };

  // Telegram's own Main and Back buttons mirror the current ones.
  const latest = useRef(value);
  latest.current = value;
  useEffect(() => {
    if (!tg) return;
    const p = primary?.p;
    const click = () => latest.current.primary?.onClick();
    if (p) {
      tg.MainButton.setText(p.label).show();
      if (p.enabled === false) tg.MainButton.disable();
      else tg.MainButton.enable();
      tg.MainButton.onClick(click);
    } else tg.MainButton.hide();
    return () => void tg.MainButton.offClick(click);
  }, [tg, primary]);
  useEffect(() => {
    if (!tg) return;
    const click = () => latest.current.back?.();
    if (back) {
      tg.BackButton.show();
      tg.BackButton.onClick(click);
    } else tg.BackButton.hide();
    return () => tg.BackButton.offClick(click);
  }, [tg, back]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** The screen's main action (Telegram's big bottom button, or a button in the page). */
export function usePrimary(p: Primary | null, deps: unknown[]) {
  const { setPrimary } = usePlatform();
  const owner = useRef(Symbol("primary")).current;
  const ref = useRef(p);
  ref.current = p;
  useEffect(() => {
    setPrimary(ref.current ? { ...ref.current, onClick: () => ref.current?.onClick() } : null, owner);
    return () => setPrimary(null, owner);
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
}

/** A back action (Telegram's back arrow, or "‹ Back" in the page). */
export function useBack(fn: (() => void) | null) {
  const { setBack } = usePlatform();
  const owner = useRef(Symbol("back")).current;
  const ref = useRef(fn);
  ref.current = fn;
  const on = !!fn;
  useEffect(() => {
    setBack(on ? () => ref.current?.() : null, owner);
    return () => setBack(null, owner);
  }, [on]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** Theme and accent from Settings, applied to <html> (and to Telegram's header in the Mini App). */
export function usePrefsTheme(tg: TgWebApp | null, enabled: boolean) {
  const prefs = useQuery({ queryKey: ["prefs"], queryFn: api.prefs, enabled, staleTime: 60_000 });
  const [systemDark, setSystemDark] = useState(() => (tg ? tg.colorScheme === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches));
  useEffect(() => {
    if (tg) {
      const on = () => setSystemDark(tg.colorScheme === "dark");
      tg.onEvent("themeChanged", on);
      return () => tg.offEvent("themeChanged", on);
    }
    const m = window.matchMedia("(prefers-color-scheme: dark)");
    const on = () => setSystemDark(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, [tg]);
  const theme = prefs.data?.theme ?? cachedTheme();
  const dark = theme === "dark" || (theme === "auto" && systemDark);
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = dark ? "dark" : "light";
    root.dataset.accent = prefs.data?.accent ?? root.dataset.accent ?? "blue";
    try {
      localStorage.setItem("oc-theme", theme);
    } catch {
      /* no storage: fine */
    }
    paintChrome(tg, dark, getComputedStyle(root).getPropertyValue("--tg-accent").trim());
  }, [dark, theme, tg, prefs.data?.accent]);
  return prefs.data;
}
function cachedTheme(): "light" | "dark" | "auto" {
  try {
    const v = localStorage.getItem("oc-theme");
    return v === "dark" || v === "auto" ? v : "light";
  } catch {
    return "light";
  }
}

/** useNavigate that keeps you inside the current app ("/tg/…" in Telegram). */
export function useAppNavigate() {
  const n = useNavigate();
  const { base } = usePlatform();
  return (to: string | number, opts?: { replace?: boolean }) => {
    if (typeof to === "number") return n(to);
    return n(base && to.startsWith("/") && !to.startsWith(`${base}/`) && to !== base ? `${base}${to}` : to, opts);
  };
}

/** <Link> that keeps you inside the current app. */
export function AppLink({ to, ...rest }: Omit<LinkProps, "to"> & { to: string }) {
  const { base } = usePlatform();
  return <Link {...rest} to={base && to.startsWith("/") && !to.startsWith(`${base}/`) ? `${base}${to}` : to} />;
}
