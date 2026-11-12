/** Minimal typings + helpers for the Telegram Mini App SDK (telegram-web-app.js). */
export interface TgButton {
  setText(t: string): TgButton;
  show(): TgButton;
  hide(): TgButton;
  enable(): TgButton;
  disable(): TgButton;
  showProgress(leaveActive?: boolean): TgButton;
  hideProgress(): TgButton;
  onClick(cb: () => void): TgButton;
  setParams?(p: { color?: string; text_color?: string }): TgButton;
  offClick(cb: () => void): TgButton;
  isVisible?: boolean;
}
export interface TgWebApp {
  initData: string;
  colorScheme: "light" | "dark";
  themeParams: Record<string, string>;
  platform: string;
  ready(): void;
  expand(): void;
  onEvent(e: string, cb: () => void): void;
  offEvent(e: string, cb: () => void): void;
  MainButton: TgButton;
  BackButton: { show(): void; hide(): void; onClick(cb: () => void): void; offClick(cb: () => void): void };
  HapticFeedback?: { impactOccurred(s: "light" | "medium" | "heavy"): void; notificationOccurred(t: "success" | "warning" | "error"): void };
  showAlert?(msg: string): void;
  setHeaderColor?(color: string): void;
  setBackgroundColor?(color: string): void;
  setBottomBarColor?(color: string): void;
  version?: string;
}
declare global {
  interface Window { Telegram?: { WebApp?: TgWebApp } }
}

let loading: Promise<TgWebApp | null> | null = null;

/** Load the official SDK (only on /tg routes) and resolve with WebApp, or null outside Telegram. */
export function loadTelegram(): Promise<TgWebApp | null> {
  loading ??= new Promise<TgWebApp | null>((resolve) => {
    if (window.Telegram?.WebApp) return resolve(window.Telegram.WebApp);
    const s = document.createElement("script");
    s.src = "https://telegram.org/js/telegram-web-app.js";
    s.async = true;
    s.onload = () => resolve(window.Telegram?.WebApp ?? null);
    s.onerror = () => resolve(null);
    document.head.appendChild(s);
    setTimeout(() => resolve(window.Telegram?.WebApp ?? null), 4000);
  }).then((w) => (w && w.initData ? w : null));
  return loading!;
}

export const haptic = {
  tap: () => window.Telegram?.WebApp?.HapticFeedback?.impactOccurred("light"),
  ok: () => window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred("success"),
  err: () => window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred("error"),
};

/** Paper colours for Telegram's own chrome (header, background, main button), so it matches the page. */
export const PAPER = {
  light: { bg: "#f7f7f5", accent: "#2f6feb" },
  dark: { bg: "#16171a", accent: "#5b8def" },
};
export type ThemePref = "light" | "dark" | "auto";
export function readThemePref(): ThemePref {
  try {
    const v = localStorage.getItem("oc-tg-theme");
    return v === "dark" || v === "auto" ? v : "light";
  } catch {
    return "light";
  }
}
export function saveThemePref(v: ThemePref) {
  try {
    localStorage.setItem("oc-tg-theme", v);
  } catch {
    /* storage unavailable: the choice lasts for this session */
  }
}
export function paintChrome(w: TgWebApp | null, dark: boolean) {
  if (!w) return;
  const c = dark ? PAPER.dark : PAPER.light;
  try {
    w.setHeaderColor?.(c.bg);
    w.setBackgroundColor?.(c.bg);
    w.setBottomBarColor?.(c.bg);
    w.MainButton.setParams?.({ color: c.accent, text_color: "#ffffff" });
  } catch {
    /* older Telegram clients: keep their colours */
  }
}
