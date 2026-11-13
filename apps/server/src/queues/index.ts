import { catchUpRolloverWindow, nightlyRolloverWindow, rollover, runNagTick, type Notifier } from "@omnicore/core";
import { Queue, Worker, type Job } from "bullmq";
import { Redis } from "ioredis";
import type { AppContext } from "../context.js";
import { probeAi, runEmbedSync } from "../ai.js";

export const QUEUE = "omnicore-maintenance";

type JobData = { kind: "rollover" } | { kind: "reindex" } | { kind: "nag" } | { kind: "digest" } | { kind: "retro" } | { kind: "embed" };

export interface Hooks {
  /** Present when Telegram is configured. */
  notifier?: Notifier;
  digest?: () => Promise<void>;
  retro?: () => Promise<void>;
}

export interface Scheduler {
  close(): Promise<void>;
}

async function handle(ctx: AppContext, hooks: Hooks, data: JobData) {
  switch (data.kind) {
    case "rollover": {
      const r = await rollover(ctx.db, ctx.tasks, nightlyRolloverWindow(ctx.config.TIMEZONE));
      console.info(`[rollover] migrated ${r.migrated.length} task(s) to ${r.toDate}; ${r.conflicts.length} conflict(s)`);
      return r;
    }
    case "reindex": {
      const r = await ctx.indexer.fullScan();
      if (r.indexed || r.removed) console.info(`[reindex] indexed ${r.indexed}, removed ${r.removed}`);
      return r;
    }
    case "nag": {
      if (ctx.settings.pausedUntil()) return; // "Pause all reminders" from the app
      if (!hooks.notifier) return;
      const r = await runNagTick(ctx.db, hooks.notifier, ctx.nag);
      if (r.sent || r.errors) console.info(`[nag] sent ${r.sent}/${r.due} due (${r.evaluated} evaluated, ${r.errors} errors)`);
      return r;
    }
    case "digest":
      return hooks.digest?.();
    case "retro":
      return hooks.retro?.();
    case "embed":
      // Can take minutes on a first run; don't hold up nags and rollovers. sync() never overlaps itself.
      void runEmbedSync(ctx);
      return;
  }
}

function cronAt(hhmm: string, seconds = 0): string {
  const [h, m] = hhmm.split(":").map(Number);
  return `${seconds} ${m} ${h} * * *`;
}

/** BullMQ-backed scheduler. Job schedulers are idempotent upserts, safe across restarts. */
export async function startBullScheduler(ctx: AppContext, hooks: Hooks, redisUrl: string): Promise<Scheduler> {
  const { config } = ctx;
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
  const q = new Queue<JobData>(QUEUE, { connection });
  const keep = { removeOnComplete: 20, removeOnFail: 50 };
  const tz = config.TIMEZONE;

  await q.upsertJobScheduler("nightly-rollover", { pattern: "59 59 23 * * *", tz }, { name: "rollover", data: { kind: "rollover" }, opts: keep });

  const toggle = async (id: string, enabled: boolean, repeat: Parameters<typeof q.upsertJobScheduler>[1], data: JobData) =>
    enabled ? q.upsertJobScheduler(id, repeat, { name: data.kind, data, opts: keep }) : q.removeJobScheduler(id);

  await toggle("periodic-reindex", config.REINDEX_INTERVAL_MINUTES > 0, { every: config.REINDEX_INTERVAL_MINUTES * 60_000 }, { kind: "reindex" });
  await toggle("nag-tick", !!hooks.notifier && config.NAG_ENABLED, { every: config.NAG_TICK_SECONDS * 1000 }, { kind: "nag" });
  await toggle("morning-digest", !!hooks.digest && !!config.DIGEST_TIME, { pattern: cronAt(config.DIGEST_TIME || "08:00"), tz }, { kind: "digest" });
  await toggle("evening-retro", !!hooks.retro && !!config.RETRO_TIME, { pattern: cronAt(config.RETRO_TIME || "21:00"), tz }, { kind: "retro" });
  await toggle("embed-sync", !!ctx.semantic, { every: Math.max(30, config.AI_EMBED_INTERVAL_SECONDS) * 1000 }, { kind: "embed" });
  if (ctx.semantic) await q.add("embed", { kind: "embed" }, keep);
  // Reachability is per process (it decides what this server's UI offers), so it isn't a queued job.
  const probe = config.AI_PROVIDER !== "none" ? setInterval(() => void probeAi(ctx), 5 * 60_000) : undefined;
  if (probe) void probeAi(ctx);

  // Concurrency 1: jobs touch many files and must not overlap.
  const worker = new Worker<JobData>(QUEUE, (job: Job<JobData>) => handle(ctx, hooks, job.data), { connection, concurrency: 1 });
  worker.on("failed", (job, err) => console.error(`[queue] ${job?.name} failed`, err));

  return {
    async close() {
      if (probe) clearInterval(probe);
      await worker.close();
      await q.close();
      connection.disconnect();
    },
  };
}

/** Fallback when REDIS_URL is unset (local dev): plain timers, single process only. */
export function startLocalScheduler(ctx: AppContext, hooks: Hooks): Scheduler {
  const { config } = ctx;
  const timers: NodeJS.Timeout[] = [];
  let chain: Promise<unknown> = Promise.resolve();
  const enqueue = (data: JobData) => {
    chain = chain.then(() => handle(ctx, hooks, data)).catch((e) => console.error(`[scheduler] ${data.kind}`, e));
  };
  const daily = (hhmm: string, sec: number, data: JobData) => {
    const [h, m] = hhmm.split(":").map(Number) as [number, number];
    const arm = () =>
      timers.push(
        setTimeout(() => {
          enqueue(data);
          arm();
        }, msUntilLocalTime(config.TIMEZONE, h, m, sec)),
      );
    arm();
  };

  daily("23:59", 59, { kind: "rollover" });
  if (config.REINDEX_INTERVAL_MINUTES > 0) timers.push(setInterval(() => enqueue({ kind: "reindex" }), config.REINDEX_INTERVAL_MINUTES * 60_000));
  if (hooks.notifier && config.NAG_ENABLED) timers.push(setInterval(() => enqueue({ kind: "nag" }), config.NAG_TICK_SECONDS * 1000));
  if (hooks.digest && config.DIGEST_TIME) daily(config.DIGEST_TIME, 0, { kind: "digest" });
  if (hooks.retro && config.RETRO_TIME) daily(config.RETRO_TIME, 0, { kind: "retro" });
  if (ctx.config.AI_PROVIDER !== "none") {
    void probeAi(ctx);
    timers.push(setInterval(() => void probeAi(ctx), 5 * 60_000));
  }
  if (ctx.semantic) {
    timers.push(setTimeout(() => void runEmbedSync(ctx), 2000));
    timers.push(setInterval(() => void runEmbedSync(ctx), Math.max(30, config.AI_EMBED_INTERVAL_SECONDS) * 1000));
  }

  return {
    async close() {
      timers.forEach((t) => clearTimeout(t));
      await chain;
    },
  };
}

/** Catch up on rollovers missed while the server was down. */
export async function runStartupCatchUp(ctx: AppContext) {
  const r = await rollover(ctx.db, ctx.tasks, catchUpRolloverWindow(ctx.config.TIMEZONE));
  if (r.migrated.length) console.info(`[rollover] catch-up migrated ${r.migrated.length} task(s) to ${r.toDate}`);
}

export function msUntilLocalTime(timeZone: string, h: number, m: number, s: number, now = new Date()): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone, hourCycle: "h23", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  const nowSec = Number(parts.hour) * 3600 + Number(parts.minute) * 60 + Number(parts.second);
  let delta = h * 3600 + m * 60 + s - nowSec;
  if (delta <= 0) delta += 86_400;
  return delta * 1000;
}
