import { AiUnavailableError, dailyDigest, todayInTz, type DigestText } from "@omnicore/core";
import type { AppContext } from "./context.js";

/**
 * Background embedding with backoff: if the local model server is down (Ollama not running,
 * model not pulled), log once and retry less often instead of spamming the log every tick.
 */
const embedState = { failures: 0, skipUntil: 0, lastError: "" };

/** Last result of pinging the local model server (null until the first check). */
let localReachable: boolean | null = null;

export async function probeAi(ctx: AppContext): Promise<boolean | null> {
  if (ctx.config.AI_PROVIDER === "none") return (localReachable = null);
  const ok = await ctx.ai.ping();
  if (ok !== localReachable && localReachable !== null) console.info(`[ai] local model server ${ok ? "is back" : "stopped answering"}`);
  if (!ok && localReachable === null) console.warn(`[ai] local model server not reachable at ${ctx.config.AI_PROVIDER === "ollama" ? ctx.config.OLLAMA_BASE_URL : ctx.config.AI_BASE_URL} — AI features stay hidden until it is.`);
  localReachable = ok;
  if (ok && embedState.skipUntil) embedState.skipUntil = 0; // retry embedding right away
  if (ok) void ensureModels(ctx);
  return ok;
}

/** Model names Ollama treats as the same: "nomic-embed-text" is "nomic-embed-text:latest". */
const withTag = (m: string) => (m.includes(":") ? m : `${m}:latest`);
let pulling: Promise<void> | null = null;
const pulled = new Set<string>();

/**
 * With Ollama and AI_AUTO_PULL (default on), download any configured model that isn't there yet,
 * one at a time, so "enable ai in .env and start" is all it takes. Failures are logged and retried
 * at the next probe (every 5 minutes).
 */
export function ensureModels(ctx: AppContext): Promise<void> {
  const c = ctx.config;
  if (c.AI_PROVIDER !== "ollama" || !c.AI_AUTO_PULL) return Promise.resolve();
  if (pulling) return pulling;
  const base = c.OLLAMA_BASE_URL.replace(/\/+$/, "");
  pulling = (async () => {
    const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return;
    const have = new Set(((await res.json()) as { models?: { name?: string; model?: string }[] }).models?.flatMap((m) => [m.name, m.model]).filter((n): n is string => !!n).map(withTag) ?? []);
    const wanted = [c.AI_EMBEDDING_MODEL, c.AI_CHAT_MODEL, c.AI_VISION_MODEL].filter((m): m is string => !!m);
    for (const model of [...new Set(wanted)]) {
      if (have.has(withTag(model)) || pulled.has(model)) continue;
      console.info(`[ai] downloading model ${model} (first start only; can take a few minutes)…`);
      const started = Date.now();
      const r = await fetch(`${base}/api/pull`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model, name: model, stream: false }),
        signal: AbortSignal.timeout(3 * 3600_000),
      });
      const body = (await r.json().catch(() => ({}))) as { status?: string; error?: string };
      if (!r.ok || body.error) {
        console.warn(`[ai] couldn't download ${model}: ${body.error ?? `HTTP ${r.status}`} — check AI_CHAT_MODEL / AI_EMBEDDING_MODEL in .env`);
        continue;
      }
      pulled.add(model);
      console.info(`[ai] model ${model} ready (${Math.round((Date.now() - started) / 1000)} s)`);
      if (model === c.AI_EMBEDDING_MODEL) {
        embedState.skipUntil = 0;
        void runEmbedSync(ctx, { force: true });
      }
    }
  })()
    .catch((e) => console.warn(`[ai] model check failed: ${(e as Error).message}`))
    .finally(() => (pulling = null));
  return pulling;
}

/** What the UI should offer, given what's configured and reachable. */
export function aiFeatures(ctx: AppContext) {
  const local = localReachable !== false && !!ctx.ai.local;
  const chat = local || !!ctx.ai.cloud;
  return {
    ask: !!ctx.semantic && local && !embedState.lastError,
    breakdown: chat,
    summaries: chat,
    voice: ctx.ai.canTranscribe && chat,
    photos: ctx.ai.canSeeImages && (!!ctx.ai.cloud || local),
    localReachable,
  };
}

export function embedHealth() {
  return { failures: embedState.failures, lastError: embedState.lastError || null, retryAt: embedState.skipUntil ? new Date(embedState.skipUntil).toISOString() : null };
}

export async function runEmbedSync(ctx: AppContext, opts: { force?: boolean } = {}): Promise<void> {
  if (!ctx.semantic || (!opts.force && Date.now() < embedState.skipUntil)) return;
  try {
    const r = await ctx.semantic.sync();
    if (embedState.failures) console.info("[ai] embedding model is reachable again");
    embedState.failures = 0;
    embedState.skipUntil = 0;
    embedState.lastError = "";
    if (r.embedded || r.removed) console.info(`[ai] index: embedded ${r.embedded}, removed ${r.removed} (${r.total} sources, ${ctx.semantic.engine})`);
  } catch (e) {
    const msg = (e as Error).message;
    embedState.failures++;
    // 2, 4, 8 … up to 30 minutes.
    embedState.skipUntil = Date.now() + Math.min(30, 2 ** embedState.failures) * 60_000;
    if (msg !== embedState.lastError) {
      console.warn(`[ai] semantic index paused: ${msg}${e instanceof AiUnavailableError ? " — is the model server running and the embedding model pulled?" : ""}`);
    }
    embedState.lastError = msg;
  }
}

/** Write the standup/retro into today's daily note and return it for sending. */
export async function runDigest(ctx: AppContext, kind: "standup" | "retro", now = new Date()): Promise<DigestText & { path: string }> {
  const d = await dailyDigest({ db: ctx.db, ai: ctx.ai, semantic: ctx.semantic, nag: ctx.nag }, kind, now);
  const path = `daily/${todayInTz(ctx.config.TIMEZONE, now)}.md`;
  if (!d.empty) await ctx.tasks.writeSection(path, kind === "standup" ? "Standup" : "Retro", d.text, now);
  return { ...d, path };
}
