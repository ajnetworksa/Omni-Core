/**
 * Cloudflare quick tunnel (the "quicktunnel" extra): cloudflared gets a random
 * https://<words>.trycloudflare.com address with no account or domain, and reports it on its
 * metrics port at /quicktunnel. We poll that, so the Telegram Mini App and links work without
 * PUBLIC_URL. The address changes whenever the tunnel restarts; onUrl fires each time.
 */
const HOST_RE = /^[a-z0-9-]+\.trycloudflare\.com$/i;

export function watchQuickTunnel(metricsBase: string, onUrl: (url: string) => unknown, everyMs = 15_000): { stop(): void; current(): string | undefined } {
  let current: string | undefined;
  let busy = false;
  const poll = async () => {
    if (busy) return;
    busy = true;
    try {
      const r = await fetch(`${metricsBase.replace(/\/+$/, "")}/quicktunnel`, { signal: AbortSignal.timeout(5000) });
      if (!r.ok) return;
      const host = ((await r.json()) as { hostname?: unknown }).hostname;
      if (typeof host !== "string" || !HOST_RE.test(host.trim())) return;
      const url = `https://${host.trim().toLowerCase()}`;
      if (url === current) return;
      current = url;
      await onUrl(url);
    } catch {
      /* tunnel not up yet */
    } finally {
      busy = false;
    }
  };
  const first = setTimeout(() => void poll(), 2000);
  const timer = setInterval(() => void poll(), everyMs);
  first.unref();
  timer.unref();
  return { stop: () => (clearTimeout(first), clearInterval(timer)), current: () => current };
}
