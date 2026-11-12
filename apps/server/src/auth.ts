import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Config } from "./config.js";

/**
 * Stateless signed session cookie: `oc_session=<base64url(json)>.<base64url(hmac)>`.
 * The key derives from API_TOKEN (and the bot token for Mini App sessions), so rotating either
 * invalidates every session, and sessions survive restarts without a store.
 */
export const COOKIE = "oc_session";
const WEB_TTL_S = 30 * 86_400;
const TG_TTL_S = 12 * 3600;

export interface Session {
  k: "web" | "tg";
  /** Telegram user id for Mini App sessions. */
  u?: number;
  exp: number;
}

function key(config: Config): Buffer | null {
  const material = [config.API_TOKEN, config.TELEGRAM_BOT_TOKEN].filter(Boolean).join("\n");
  if (!material) return null;
  return createHash("sha256").update("omnicore-session-v1\n" + material).digest();
}

const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");

export function signSession(config: Config, s: Session): string {
  const k = key(config);
  if (!k) throw new Error("No secret available to sign sessions");
  const body = b64(JSON.stringify(s));
  return `${body}.${b64(createHmac("sha256", k).update(body).digest())}`;
}

export function verifySession(config: Config, cookie: string | undefined, now = Date.now()): Session | null {
  const k = key(config);
  if (!k || !cookie) return null;
  const [body, sig] = cookie.split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", k).update(body).digest();
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const s = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Session;
    if (typeof s.exp !== "number" || s.exp * 1000 < now) return null;
    if (s.k === "tg" && !(s.u && config.TELEGRAM_ALLOWED_USER_IDS.includes(s.u))) return null;
    return s;
  } catch {
    return null;
  }
}

export function readCookie(req: FastifyRequest, name = COOKIE): string | undefined {
  const raw = req.headers.cookie;
  if (!raw) return undefined;
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

export function setSessionCookie(req: FastifyRequest, reply: FastifyReply, config: Config, s: Session): void {
  const secure = config.COOKIE_SECURE ?? (req.protocol === "https" || req.headers["x-forwarded-proto"] === "https");
  const maxAge = s.exp - Math.floor(Date.now() / 1000);
  // SameSite=None is required inside Telegram Web (iframe on web.telegram.org); it needs Secure.
  const sameSite = s.k === "tg" && secure ? "None" : "Strict";
  reply.header(
    "set-cookie",
    `${COOKIE}=${signSession(config, s)}; Path=/; HttpOnly; SameSite=${sameSite}; Max-Age=${maxAge}${secure ? "; Secure" : ""}`,
  );
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.header("set-cookie", `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
}

export const newWebSession = (): Session => ({ k: "web", exp: Math.floor(Date.now() / 1000) + WEB_TTL_S });
export const newTgSession = (userId: number): Session => ({ k: "tg", u: userId, exp: Math.floor(Date.now() / 1000) + TG_TTL_S });

export interface TelegramUser {
  id: number;
  first_name?: string;
  username?: string;
}

/**
 * Validate Telegram Mini App initData (https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app):
 * secret = HMAC_SHA256(key="WebAppData", msg=bot_token); hash = HMAC_SHA256(secret, data_check_string).
 */
export function validateInitData(initData: string, botToken: string, maxAgeS = 24 * 3600, now = Date.now()): TelegramUser | null {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(initData);
  } catch {
    return null;
  }
  const hash = params.get("hash");
  if (!hash || !/^[0-9a-f]{64}$/.test(hash)) return null;
  const pairs: string[] = [];
  for (const [k, v] of params) if (k !== "hash") pairs.push(`${k}=${v}`);
  pairs.sort();
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const expected = createHmac("sha256", secret).update(pairs.join("\n")).digest();
  const given = Buffer.from(hash, "hex");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  const authDate = Number(params.get("auth_date"));
  if (!Number.isFinite(authDate) || now / 1000 - authDate > maxAgeS || authDate - now / 1000 > 60) return null;
  try {
    const user = JSON.parse(params.get("user") ?? "null") as TelegramUser | null;
    return user && typeof user.id === "number" ? user : null;
  } catch {
    return null;
  }
}

/** Test helper / mock clients: build a correctly signed initData string. */
export function signInitData(botToken: string, user: TelegramUser, authDate = Math.floor(Date.now() / 1000)): string {
  const params = new URLSearchParams({ auth_date: String(authDate), query_id: "AAE-test", user: JSON.stringify(user) });
  const pairs = [...params].map(([k, v]) => `${k}=${v}`).sort();
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  params.set("hash", createHmac("sha256", secret).update(pairs.join("\n")).digest("hex"));
  return params.toString();
}
