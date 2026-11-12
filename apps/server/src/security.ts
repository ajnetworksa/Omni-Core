import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";

/** Constant-time bearer token comparison. */
export function tokenMatches(header: string | undefined, token: string): boolean {
  if (!header?.startsWith("Bearer ")) return false;
  const a = Buffer.from(header.slice(7));
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Throttles clients that keep presenting bad credentials: after `maxFailures` within `windowMs`,
 * the IP is locked out for `lockMs` (429). Successful requests are unaffected until locked.
 */
export class AuthThrottle {
  private failures = new Map<string, { count: number; first: number; lockedUntil: number }>();
  constructor(
    private maxFailures = 10,
    private windowMs = 5 * 60_000,
    private lockMs = 15 * 60_000,
  ) {}

  isLocked(ip: string, now = Date.now()): boolean {
    const f = this.failures.get(ip);
    return !!f && f.lockedUntil > now;
  }

  fail(ip: string, now = Date.now()): void {
    let f = this.failures.get(ip);
    if (!f || now - f.first > this.windowMs) f = { count: 0, first: now, lockedUntil: 0 };
    f.count++;
    if (f.count >= this.maxFailures) f.lockedUntil = now + this.lockMs;
    this.failures.set(ip, f);
    if (this.failures.size > 10_000) {
      for (const [k, v] of this.failures) if (v.lockedUntil < now && now - v.first > this.windowMs) this.failures.delete(k);
    }
  }
}

/** CSP for the web app / Mini App pages (scripts and styles are bundled; Telegram's SDK is the one exception). */
export const APP_CSP = [
  "default-src 'self'",
  "script-src 'self' https://telegram.org",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'self'",
  "object-src 'none'",
  // Telegram Web runs Mini Apps in an iframe on web.telegram.org; nothing else may frame us.
  "frame-ancestors 'self' https://web.telegram.org",
].join("; ");

/**
 * Baseline headers. JSON responses get the strictest policy; HTML pages get APP_CSP; hashed
 * static assets are cacheable.
 */
export function registerSecurityHeaders(app: FastifyInstance): void {
  app.addHook("onSend", async (req, reply, payload) => {
    const type = String(reply.getHeader("content-type") ?? "");
    const path = req.url.split("?")[0]!;
    // Decide by path, not only by content-type: a 304 revalidation of a page has no body/type,
    // and giving it the API policy would make the browser block the whole app on reload.
    const isPage = type.startsWith("text/html") || (!path.startsWith("/api/") && !path.startsWith("/assets/") && !path.startsWith("/telegram/") && path !== "/health");
    reply.header("x-content-type-options", "nosniff");
    reply.header("referrer-policy", "no-referrer");
    reply.header("cross-origin-resource-policy", "same-origin");
    if (isPage) {
      reply.header("content-security-policy", APP_CSP);
      reply.header("cache-control", "no-cache");
    } else {
      reply.header("x-frame-options", "DENY");
      reply.header("content-security-policy", "default-src 'none'; frame-ancestors 'none'");
      // Vite's hashed bundles never change; everything else (API JSON) must not be cached.
      if (req.url.startsWith("/assets/") && reply.statusCode === 200) reply.header("cache-control", "public, max-age=31536000, immutable");
      else if (!reply.hasHeader("cache-control")) reply.header("cache-control", "no-store");
    }
    return payload;
  });
}

/** Request log serializer that never writes query strings (tokens pasted into URLs) or headers. */
export function safeRequestSerializer(req: FastifyRequest) {
  return { method: req.method, url: req.url.split("?")[0], remoteAddress: req.ip };
}

export const isLoopback = (host: string) => ["127.0.0.1", "::1", "localhost"].includes(host);
