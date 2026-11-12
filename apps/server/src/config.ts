import "dotenv/config";
import { z } from "zod";
import type { AiSettings } from "@omnicore/core";

const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === "" ? def : ["1", "true", "yes", "on"].includes(v.toLowerCase())));

const optional = z
  .string()
  .optional()
  .transform((v) => v?.trim() || undefined);

const hhmm = z.string().regex(/^\d{2}:\d{2}$/, "expected HH:mm");

/**
 * Forgiving PUBLIC_URL: quotes, a trailing comment or slash, and a missing https:// are fixed up.
 * Anything still not a URL is dropped with a warning (it only turns on the Mini App), so a typo
 * here never stops the server.
 */
export function normalizePublicUrl(raw: string | undefined): string | undefined {
  let v = (raw ?? "").replace(/\s+#.*$/, "").trim().replace(/^["']|["']$/g, "").trim();
  if (!v) return undefined;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) v = `https://${v}`;
  v = v.replace(/\/+$/, "");
  try {
    const u = new URL(v);
    if (!u.hostname.includes(".")) throw new Error("no domain");
    return v;
  } catch {
    console.warn(`[config] PUBLIC_URL="${raw}" isn't a web address (expected e.g. https://tg.example.com) — ignoring it; the Mini App stays off.`);
    return undefined;
  }
}

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

const Env = z.object({
  /** "production" turns on info-level logging (Docker sets it). */
  NODE_ENV: z.string().default("development"),
  /** HTTP port. */
  PORT: z.coerce.number().int().default(3000),
  /** Loopback by default. Docker sets 0.0.0.0 (the compose file only publishes it on 127.0.0.1). */
  HOST: z.string().default("127.0.0.1"),
  /** Public https URL of this app (Cloudflare tunnel hostname). Enables the Telegram Mini App buttons. */
  PUBLIC_URL: z
    .string()
    .optional()
    .transform((v) => normalizePublicUrl(v)),
  /** Metrics address of the "quicktunnel" extra (set automatically); its https address is used when PUBLIC_URL is empty. */
  QUICK_TUNNEL_METRICS: optional,
  /** Force the Secure flag on session cookies (default: auto from the request protocol). */
  COOKIE_SECURE: z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === "" ? undefined : ["1", "true", "yes", "on"].includes(v.toLowerCase()))),
  /** Built web app to serve at / (default: apps/web/dist next to the server). */
  WEB_DIST: optional,
  /** Behind Cloudflare Tunnel: identify clients by CF-Connecting-IP (only safe when the port isn't publicly reachable). */
  TRUST_PROXY: bool(false),
  /** Comma-separated allowed browser origins for CORS. Empty → no cross-origin access. */
  CORS_ORIGINS: z
    .string()
    .default("")
    .transform((v) => v.split(",").map((s) => s.trim()).filter(Boolean)),
  /** IANA time zone for "today", due times, quiet hours and the midnight rollover. */
  TIMEZONE: z.string().default("Asia/Riyadh"),
  /** Folder of Markdown notes (an Obsidian vault works as-is). */
  VAULT_PATH: z.string().default("./vault"),
  /** SQLite index and app state. Rebuildable from the vault except remarks, reminder history and the AI index. */
  DATABASE_PATH: z.string().default("./data/app.db"),
  /** Add a hidden ^oc-xxxxxxxx block id to task lines so a task keeps its identity when edited or moved. */
  TASK_ANCHORS: bool(true),
  /** Write Obsidian-Tasks ✅ YYYY-MM-DD on completion. */
  TASK_DONE_DATE: bool(true),
  /** Weekend for "every weekday" recurrence. */
  WEEKEND_DAYS: z
    .string()
    .default("fri,sat")
    .transform((v) => v.split(",").map((d) => WEEKDAYS.indexOf(d.trim().toLowerCase().slice(0, 3))).filter((i) => i >= 0)),
  /** Poll the vault instead of filesystem events (needed for Docker bind mounts from Windows/macOS hosts). */
  VAULT_POLLING: bool(false),
  /** Full re-scan as a safety net for missed file events. 0 disables. */
  REINDEX_INTERVAL_MINUTES: z.coerce.number().int().min(0).default(15),
  /** Optional Redis for the BullMQ scheduler. Empty = built-in timers (default; the tested path). */
  REDIS_URL: optional,
  /** Web/API password (bearer token for /api/*). Empty in Docker: one is generated into data/api-token on first start. */
  API_TOKEN: optional,

  // --- Telegram ---
  /** From @BotFather. Empty disables the bot and reminders. */
  TELEGRAM_BOT_TOKEN: optional,
  /** Comma-separated Telegram user ids allowed to use the bot and the Mini App. Everyone else is ignored. */
  TELEGRAM_ALLOWED_USER_IDS: z
    .string()
    .default("")
    .transform((v) => v.split(",").map((s) => s.trim()).filter(Boolean).map(Number).filter(Number.isFinite)),
  /** Public URL for webhook mode, e.g. https://workspace.example.com/telegram/webhook. Empty → long polling. */
  TELEGRAM_WEBHOOK_URL: optional,
  /** Secret Telegram sends with webhook calls; required with TELEGRAM_WEBHOOK_URL. */
  TELEGRAM_WEBHOOK_SECRET: optional,
  /** Bot API base URL. Change only for a self-hosted Bot API server (or tests). */
  TELEGRAM_API_ROOT: z.string().url().default("https://api.telegram.org"),

  // --- Nag engine ---
  /** Send escalating Telegram reminders. */
  NAG_ENABLED: bool(true),
  /** How often the nag engine looks for reminders to send. */
  NAG_TICK_SECONDS: z.coerce.number().int().min(15).default(60),
  /** Minutes between pings per state, e.g. "overdue=30,partial=60,remark=120". */
  NAG_INTERVALS: z
    .string()
    .default("overdue=30,partial=60,remark=120")
    .transform((v) => {
      const out = { overdue: 30, partial: 60, remark: 120 };
      for (const pair of v.split(",")) {
        const [k, n] = pair.split("=").map((s) => s.trim());
        if (k && k in out && Number(n) > 0) out[k as keyof typeof out] = Number(n);
      }
      return out;
    }),
  /** No reminders in this window (local time), e.g. "23:00-07:00". Empty = none. */
  NAG_QUIET_HOURS: z.string().default("23:00-07:00"),
  /** Due time for tasks that only have a date. */
  NAG_DEFAULT_DUE_TIME: hhmm.default("09:00"),
  /** At most this many reminders per tick (the rest wait); keeps bursts readable. */
  NAG_MAX_PER_TICK: z.coerce.number().int().min(1).default(5),
  /** Time "🌅 Tomorrow" moves a task to. */
  TOMORROW_TIME: hhmm.default("08:00"),
  // --- AI (Phase 4) ---
  /** Local model server: "ollama", "openai" (any OpenAI-compatible server such as LM Studio), or "none". */
  AI_PROVIDER: z.enum(["ollama", "openai", "none"]).default("ollama"),
  /** Ollama root (…:11434) or, for AI_PROVIDER=openai, the /v1 base URL. */
  OLLAMA_BASE_URL: z.string().url().default("http://127.0.0.1:11434"),
  /** With AI_PROVIDER=openai: the server's /v1 URL (LM Studio, llama.cpp, vLLM). */
  AI_BASE_URL: optional,
  /** API key for an OpenAI-compatible local server, if it needs one. */
  AI_API_KEY: optional,
  /** Chat model for Ask, breakdown, voice extraction and summaries. */
  AI_CHAT_MODEL: z.string().default("llama3.2:3b"),
  /** With Ollama: download the chat, embedding and vision models on first start if they're missing. */
  AI_AUTO_PULL: bool(true),
  /** Embedding model for the semantic index. Changing it rebuilds the index. */
  AI_EMBEDDING_MODEL: z.string().default("nomic-embed-text"),
  /** Optional local vision model for photos, e.g. "llama3.2-vision" or "qwen2.5vl:7b". */
  AI_VISION_MODEL: optional,
  /** Cloud model: off (default — nothing leaves this machine), fallback (when local fails), prefer (cloud first). */
  CLOUD_MODE: z.enum(["off", "fallback", "prefer"]).default("off"),
  /** Cloud model provider when CLOUD_MODE is not off. */
  CLOUD_PROVIDER: z.enum(["anthropic", "openai", "gemini"]).optional().or(z.literal("").transform(() => undefined)),
  /** API key for CLOUD_PROVIDER. Never logged or shown. */
  CLOUD_API_KEY: optional,
  /** Cloud model name (defaults per provider). */
  CLOUD_MODEL: optional,
  /** Override the provider URL (proxy or gateway). */
  CLOUD_BASE_URL: optional,
  /** OpenAI-compatible speech-to-text (/v1/audio/transcriptions), e.g. a local faster-whisper server. */
  STT_BASE_URL: optional,
  /** API key for the speech-to-text server, if it needs one. */
  STT_API_KEY: optional,
  /** Speech-to-text model name. */
  STT_MODEL: z.string().default("whisper-1"),
  /** Optional language hint for transcription, e.g. "en" or "ar". */
  STT_LANGUAGE: optional,
  /** Give up on a model call after this long. */
  AI_TIMEOUT_SECONDS: z.coerce.number().int().min(5).default(90),
  /** Model calls at once; extra requests queue (max 6) and then get 429. */
  AI_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(1),
  /** How often to re-embed changed notes and tasks. 0 disables the semantic index. */
  AI_EMBED_INTERVAL_SECONDS: z.coerce.number().int().min(0).default(120),
  /** "auto" uses sqlite-vec when it loads; "js" forces the built-in brute-force search. */
  AI_VECTOR_ENGINE: z.enum(["auto", "js"]).default("auto"),
  /** Varied wording for reminders, from the local model. */
  AI_NAG_VARIATION: bool(false),
  // --- Updates ---
  /** "owner/repo" on GitHub: check for new releases and show "Update available" in the app. Empty = off. */
  UPDATE_CHECK_REPO: z
    .string()
    .optional()
    .transform((v) => (v ? v.trim() : undefined))
    .refine((v) => v === undefined || /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(v), "expected owner/repo"),
  /** How often to ask GitHub for a new release. */
  UPDATE_CHECK_HOURS: z.coerce.number().min(1).default(12),
  /** Test hook / GitHub Enterprise. */
  GITHUB_API_ROOT: z.string().url().default("https://api.github.com"),

  /** Evening retro time; empty disables. The morning digest becomes an AI standup when AI is on. */
  RETRO_TIME: z
    .string()
    .default("21:00")
    .refine((v) => v === "" || /^\d{2}:\d{2}$/.test(v), "expected HH:mm or empty"),

  /** Morning /today digest time; empty disables. */
  DIGEST_TIME: z
    .string()
    .default("08:00")
    .refine((v) => v === "" || /^\d{2}:\d{2}$/.test(v), "expected HH:mm or empty"),
});

export type Config = z.infer<typeof Env>;

/**
 * Docker defaults from the extras switched on in .env (COMPOSE_PROFILES, passed in as
 * OMNICORE_PROFILES): "ai" points at the bundled Ollama, "redis" at the bundled Redis. With no
 * model server configured at all, AI is off quietly instead of probing localhost in the container.
 * Anything set explicitly in .env wins.
 */
export function composeDefaults(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out = { ...env };
  if (out.OLLAMA_BASE_URL !== undefined && !out.OLLAMA_BASE_URL.trim()) delete out.OLLAMA_BASE_URL;
  if (out.OMNICORE_PROFILES === undefined) return out;
  const profiles = new Set(out.OMNICORE_PROFILES.split(",").map((p) => p.trim().toLowerCase()).filter(Boolean));
  if (!out.REDIS_URL?.trim() && profiles.has("redis")) out.REDIS_URL = "redis://omnicore-redis:6379";
  if (!out.OLLAMA_BASE_URL && profiles.has("ai")) out.OLLAMA_BASE_URL = "http://omnicore-ollama:11434";
  if (!out.AI_PROVIDER?.trim() && !out.OLLAMA_BASE_URL && !out.AI_BASE_URL?.trim()) out.AI_PROVIDER = "none";
  if (!out.QUICK_TUNNEL_METRICS?.trim() && !out.PUBLIC_URL?.trim() && profiles.has("quicktunnel")) out.QUICK_TUNNEL_METRICS = "http://omnicore-quicktunnel:2000";
  return out;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = Env.safeParse(composeDefaults(env));
  if (!parsed.success) {
    console.error("Invalid configuration:\n" + z.prettifyError(parsed.error));
    process.exit(1);
  }
  // Fail fast on a bad timezone instead of at midnight.
  new Intl.DateTimeFormat("en-CA", { timeZone: parsed.data.TIMEZONE });
  const c = parsed.data;
  if (c.CLOUD_MODE !== "off" && (!c.CLOUD_PROVIDER || !c.CLOUD_API_KEY)) {
    console.error("Invalid configuration: CLOUD_MODE needs CLOUD_PROVIDER and CLOUD_API_KEY.");
    process.exit(1);
  }
  return c;
}

/** AI client settings from config. */
export function aiSettings(c: Config): AiSettings {
  return {
    provider: c.AI_PROVIDER,
    baseUrl: c.AI_PROVIDER === "openai" ? (c.AI_BASE_URL ?? "http://127.0.0.1:1234/v1") : c.OLLAMA_BASE_URL,
    apiKey: c.AI_API_KEY,
    chatModel: c.AI_CHAT_MODEL,
    embedModel: c.AI_EMBEDDING_MODEL,
    visionModel: c.AI_VISION_MODEL,
    cloud: c.CLOUD_PROVIDER && c.CLOUD_API_KEY ? { provider: c.CLOUD_PROVIDER, apiKey: c.CLOUD_API_KEY, model: c.CLOUD_MODEL, baseUrl: c.CLOUD_BASE_URL } : undefined,
    cloudMode: c.CLOUD_MODE,
    stt: c.STT_BASE_URL ? { baseUrl: c.STT_BASE_URL, apiKey: c.STT_API_KEY, model: c.STT_MODEL, language: c.STT_LANGUAGE } : undefined,
    timeoutMs: c.AI_TIMEOUT_SECONDS * 1000,
    concurrency: c.AI_CONCURRENCY,
    maxQueue: 6,
  };
}
