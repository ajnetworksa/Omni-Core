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

/** Paint Telegram's own chrome (header, background, main button) in the page's Paper colours. */
export function paintChrome(w: TgWebApp | null, dark: boolean, accent?: string) {
  if (!w) return;
  const bg = dark ? "#16171a" : "#f7f7f5";
  try {
    w.setHeaderColor?.(bg);
    w.setBackgroundColor?.(bg);
    w.setBottomBarColor?.(bg);
    w.MainButton.setParams?.({ color: accent || (dark ? "#5b8def" : "#2f6feb"), text_color: "#ffffff" });
  } catch {
    /* older Telegram clients: keep their colours */
  }
}
