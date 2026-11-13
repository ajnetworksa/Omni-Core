import { useEffect, useState } from "react";
import { api, refreshAll } from "../lib/api";
import { AppFrame } from "../app/App";
import { PlatformProvider, usePrefsTheme } from "../app/platform";
import { loadTelegram, type TgWebApp } from "./telegram";

type Auth = "checking" | "ok" | "outside" | "denied";

/** Telegram Mini App (/tg/*): sign in with Telegram, then the same app as the web, in Telegram's frame. */
export function MiniApp() {
  const [tg, setTg] = useState<TgWebApp | null>(null);
  const [auth, setAuth] = useState<Auth>("checking");

  useEffect(() => {
    let alive = true;
    (async () => {
      const w = await loadTelegram();
      if (!alive) return;
      setTg(w);
      if (w) {
        w.ready();
        w.expand();
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
    return () => {
      alive = false;
    };
  }, []);

  return (
    <PlatformProvider tg={tg} base="/tg">
      {auth === "ok" ? <AppFrame /> : <Gate auth={auth} tg={tg} />}
    </PlatformProvider>
  );
}

function Gate({ auth, tg }: { auth: Auth; tg: TgWebApp | null }) {
  usePrefsTheme(tg, false);
  const msg =
    auth === "checking"
      ? "Loading…"
      : auth === "denied"
        ? "This Telegram account isn't allowed to use this app. Send the bot any message: it replies with your user id. Add that id to TELEGRAM_ALLOWED_USER_IDS in .env on the server."
        : "Open OmniCore from the Telegram bot (the Open button next to the message box), or sign in on the web first.";
  return (
    <div className="tg flex items-center justify-center px-8 text-center font-sans">
      <p className="text-[15px] leading-snug" style={{ color: "var(--tg-hint)" }}>{msg}</p>
    </div>
  );
}
