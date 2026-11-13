import {
  AiUnavailableError,
  ask,
  applyTaskAction,
  describeHits,
  parseTimeHint,
  suggestSubtasks,
  board,
  graph,
  inbox,
  listTasks,
  NoteConflictError,
  noteDetail,
  notes,
  parsePreview,
  projects,
  projectStats,
  toCards,
  search,
  TASK_ACTIONS,
  TASK_STATUSES,
  taskDetail,
  TaskLineConflictError,
  TaskNotFoundError,
  UndoExpiredError,
  todayBoard,
  todayView,
  upcoming,
  VaultPathError,
} from "@omnicore/core";
import { asc, eq } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  clearSessionCookie,
  newTgSession,
  newWebSession,
  readCookie,
  setSessionCookie,
  validateInitData,
  verifySession,
  type Session,
} from "../auth.js";
import type { AppContext } from "../context.js";
import { SettingError } from "../settings.js";
import { backupNow, listBackups } from "../snapshot.js";
import { getMiniAppUrl } from "../telegram/format.js";
import { AuthThrottle, tokenMatches } from "../security.js";
import { aiFeatures, embedHealth, runDigest, runEmbedSync } from "../ai.js";
import { updateInfo } from "../version.js";

const Status = z.enum(TASK_STATUSES);
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Time = z.string().regex(/^\d{2}:\d{2}$/);
const VaultPath = z
  .string()
  .max(300)
  .regex(/^(?![/\\])(?!.*(?:^|[/\\])\.\.(?:[/\\]|$))(?!.*[\\\u0000:%])[^\u0000]+\.md$/i, "relative vault path ending in .md, no '..', backslashes or drive letters");

const TaskQuery = z.object({
  status: z
    .string()
    .optional()
    .transform((s) => s?.split(",").filter(Boolean))
    .pipe(z.array(Status).optional()),
  project: z.string().optional(),
  tag: z.string().optional(),
  dueBefore: IsoDate.optional(),
  minRollover: z.coerce.number().int().optional(),
  limit: z.coerce.number().int().min(1).max(2000).optional(),
});

const CreateTask = z.object({
  text: z.string().min(1).max(2000),
  notePath: VaultPath.optional(),
  projectSlug: z.string().max(80).optional(),
  status: Status.optional(),
});

const PatchTask = z
  .object({
    status: Status,
    title: z.string().min(1).max(2000),
    priority: z.number().int().min(1).max(4),
    dueDate: IsoDate.nullable(),
    dueTime: Time.nullable(),
    pinned: z.boolean(),
  })
  .partial()
  .refine((p) => Object.keys(p).length > 0, "Empty patch");

const Text = (max: number) => z.object({ text: z.string().min(1).max(max) });

declare module "fastify" {
  interface FastifyRequest {
    session?: Session;
  }
}

export async function apiRoutes(app: FastifyInstance, ctx: AppContext, opts: { telegramStatus?: () => string } = {}) {
  const { db, config } = ctx;
  const throttle = new AuthThrottle();
  const clientKey = (req: FastifyRequest) =>
    (config.TRUST_PROXY && typeof req.headers["cf-connecting-ip"] === "string" && req.headers["cf-connecting-ip"]) || req.ip;

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof z.ZodError) return reply.status(400).send({ error: "validation", issues: err.issues });
    if (err instanceof TaskNotFoundError) return reply.status(404).send({ error: "not_found" });
    if (err instanceof TaskLineConflictError) return reply.status(409).send({ error: "conflict", message: err.message });
    if (err instanceof NoteConflictError) return reply.status(409).send({ error: "note_conflict", checksum: err.currentChecksum });
    if (err instanceof VaultPathError) return reply.status(400).send({ error: "invalid_path", message: err.message });
    if (err instanceof UndoExpiredError) return reply.status(410).send({ error: "undo_expired", message: err.message });
    if (err instanceof AiUnavailableError) {
      return reply.status(err.reason === "busy" ? 429 : 503).send({ error: "ai_unavailable", reason: err.reason, message: err.message });
    }
    // Fastify's own client errors (bad JSON, prototype poisoning, body too large, …) keep their 4xx.
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) {
      return reply.status(status).send({ error: status === 413 ? "payload_too_large" : "bad_request" });
    }
    app.log.error(err);
    return reply.status(500).send({ error: "internal" });
  });

  // ------------------------------------------------------------ public: sessions
  const authOpen = !config.API_TOKEN;

  app.get("/me", async (req) => {
    if (authOpen) return { authenticated: true, mode: "open" };
    const s = verifySession(config, readCookie(req));
    if (s) return { authenticated: true, mode: s.k };
    if (tokenMatches(req.headers.authorization, config.API_TOKEN!)) return { authenticated: true, mode: "token" };
    return { authenticated: false, telegramLogin: !!config.TELEGRAM_BOT_TOKEN };
  });

  app.post("/session", async (req, reply) => {
    const key = clientKey(req);
    if (throttle.isLocked(key)) return reply.status(429).send({ error: "too_many_failed_attempts" });
    const { token } = z.object({ token: z.string().min(1).max(512) }).parse(req.body);
    if (authOpen) return { ok: true, mode: "open" };
    if (!tokenMatches(`Bearer ${token}`, config.API_TOKEN!)) {
      throttle.fail(key);
      return reply.status(401).send({ error: "unauthorized" });
    }
    setSessionCookie(req, reply, config, newWebSession());
    return { ok: true, mode: "web" };
  });

  app.post("/session/telegram", async (req, reply) => {
    const key = clientKey(req);
    if (throttle.isLocked(key)) return reply.status(429).send({ error: "too_many_failed_attempts" });
    if (!config.TELEGRAM_BOT_TOKEN) return reply.status(404).send({ error: "telegram_disabled" });
    const { initData } = z.object({ initData: z.string().min(1).max(8192) }).parse(req.body);
    const user = validateInitData(initData, config.TELEGRAM_BOT_TOKEN);
    if (!user || !config.TELEGRAM_ALLOWED_USER_IDS.includes(user.id)) {
      throttle.fail(key);
      return reply.status(401).send({ error: "unauthorized" });
    }
    setSessionCookie(req, reply, config, newTgSession(user.id));
    return { ok: true, mode: "tg", user: { id: user.id, firstName: user.first_name ?? null } };
  });

  app.post("/logout", async (_req, reply) => {
    clearSessionCookie(reply);
    return { ok: true };
  });

  // ------------------------------------------------------------ protected
  await app.register(async (api) => {
    api.addHook("onRequest", async (req, reply) => {
      if (authOpen) return;
      const key = clientKey(req);
      if (throttle.isLocked(key)) return reply.status(429).send({ error: "too_many_failed_attempts" });
      if (req.headers.authorization) {
        if (tokenMatches(req.headers.authorization, config.API_TOKEN!)) return;
        throttle.fail(key);
        return reply.status(401).send({ error: "unauthorized" });
      }
      const s = verifySession(config, readCookie(req));
      if (!s) return reply.status(401).send({ error: "unauthorized" });
      // Cookie-authenticated writes must come from our own front-end (CSRF defence on top of SameSite).
      if (req.method !== "GET" && req.method !== "HEAD" && req.headers["x-omnicore"] !== "1") {
        return reply.status(403).send({ error: "csrf" });
      }
      req.session = s;
    });

    const nag = () => ctx.nag;

    // --- views for the UI
    api.get("/today", async () => todayView(db, config.TIMEZONE));
    api.get("/today/board", async () => todayBoard(db, nag()));
    api.get("/upcoming", async (req) => {
      const { days } = z.object({ days: z.coerce.number().int().min(1).max(90).default(14) }).parse(req.query);
      return upcoming(db, nag(), days);
    });
    api.get("/inbox", async () => inbox(db, nag()));
    api.get("/board", async () => board(db, nag()));
    api.get("/search", async (req) => search(db, z.object({ q: z.string().max(200) }).parse(req.query).q, nag()));
    api.post("/parse", async (req) => parsePreview(Text(2000).parse(req.body).text, config.TIMEZONE));
    api.get("/config", async () => ({
      timezone: config.TIMEZONE,
      nag: { intervals: config.NAG_INTERVALS, quietHours: config.NAG_QUIET_HOURS, defaultDueTime: config.NAG_DEFAULT_DUE_TIME },
      telegram: !!config.TELEGRAM_BOT_TOKEN,
      vaultName: ctx.vault.root.split(/[\\/]/).pop() ?? "vault",
    }));

    // --- tasks
    api.get("/tasks", async (req) => {
      const q = TaskQuery.parse(req.query);
      return listTasks(db, { ...q, projectSlug: q.project });
    });
    api.get<{ Params: { id: string } }>("/tasks/:id", async (req) => ctx.tasks.get(req.params.id));
    api.get<{ Params: { id: string } }>("/tasks/:id/detail", async (req, reply) => taskDetail(db, req.params.id, nag()) ?? reply.status(404).send({ error: "not_found" }));
    api.post("/tasks", async (req, reply) => reply.status(201).send(await ctx.tasks.create(CreateTask.parse(req.body))));
    api.patch<{ Params: { id: string } }>("/tasks/:id", async (req) => ctx.tasks.update(req.params.id, PatchTask.parse(req.body)));
    api.post<{ Params: { id: string; action: string } }>("/tasks/:id/actions/:action", async (req) => {
      const action = z.enum(TASK_ACTIONS).parse(req.params.action);
      return applyTaskAction(ctx.tasks, req.params.id, action, { tomorrowTime: config.TOMORROW_TIME });
    });
    api.delete<{ Params: { id: string } }>("/tasks/:id", async (req) => ctx.tasks.delete(req.params.id));
    api.post("/undo", async (req) => ctx.tasks.restore(z.object({ token: z.string().min(8).max(64) }).parse(req.body).token));
    api.post<{ Params: { id: string } }>("/tasks/:id/remarks", async (req) =>
      ctx.tasks.addRemark(req.params.id, Text(4000).parse(req.body).text, req.session?.k === "tg" ? "telegram" : "web"),
    );

    // --- projects & notes
    api.get("/projects", async () => projectStats(db, nag()));
    api.post("/projects", async (req, reply) => {
      const { name } = z.object({ name: z.string().trim().min(1).max(80) }).parse(req.body);
      const r = await ctx.tasks.createProject(name);
      const stats = projectStats(db, nag()).find((p) => p.slug === r.slug);
      return reply.status(r.created ? 201 : 200).send({ ...stats, path: r.path, created: r.created });
    });
    api.delete<{ Params: { slug: string }; Querystring: { keepTasks?: string } }>("/projects/:slug", async (req) =>
      ctx.tasks.deleteProject(req.params.slug, { keepTasks: req.query.keepTasks !== "false" && req.query.keepTasks !== "0" }),
    );
    api.get<{ Params: { slug: string } }>("/projects/:slug", async (req, reply) => {
      const p = db.select().from(projects).where(eq(projects.slug, req.params.slug)).get();
      if (!p) return reply.status(404).send({ error: "not_found" });
      const rows = listTasks(db, { projectSlug: p.slug, limit: 2000 }).filter((t) => t.status !== "cancelled" && !t.parentTaskId);
      const cards = toCards(db, rows, nag());
      return {
        ...projectStats(db, nag()).find((x) => x.slug === p.slug),
        openTasks: cards.filter((t) => t.status !== "done"),
        doneTasks: cards.filter((t) => t.status === "done").slice(0, 30),
      };
    });
    // What the quick-add box suggests: projects and tags already in use.
    api.get("/suggest", async () => ({
      projects: db.select({ slug: projects.slug, title: projects.title }).from(projects).orderBy(asc(projects.title)).all(),
      tags: (db.$client.prepare("SELECT value AS tag, count(*) AS n FROM tasks, json_each(tasks.tags) WHERE value NOT LIKE 'project/%' GROUP BY value ORDER BY n DESC LIMIT 30").all() as { tag: string }[]).map((r) => r.tag),
    }));
    api.get("/notes", async () =>
      db.select({ id: notes.id, title: notes.title, path: notes.path, updatedAt: notes.updatedAt }).from(notes).orderBy(asc(notes.path)).all(),
    );
    api.get("/notes/by-path", async (req, reply) => {
      const { path } = z.object({ path: VaultPath }).parse(req.query);
      const n = db.select({ id: notes.id }).from(notes).where(eq(notes.path, path)).get();
      return n ? noteDetail(db, n.id, nag()) : reply.status(404).send({ error: "not_found" });
    });
    api.get<{ Params: { id: string } }>("/notes/:id", async (req, reply) => noteDetail(db, req.params.id, nag()) ?? reply.status(404).send({ error: "not_found" }));
    api.put<{ Params: { id: string } }>("/notes/:id", async (req, reply) => {
      const body = z.object({ content: z.string().max(512 * 1024), checksum: z.string().regex(/^[0-9a-f]{64}$/) }).parse(req.body);
      const n = db.select({ path: notes.path }).from(notes).where(eq(notes.id, req.params.id)).get();
      if (!n) return reply.status(404).send({ error: "not_found" });
      await ctx.tasks.writeNote(n.path, body.content, body.checksum);
      return noteDetail(db, req.params.id, nag());
    });
    api.delete<{ Params: { id: string } }>("/notes/:id", async (req, reply) => {
      const n = db.select().from(notes).where(eq(notes.id, req.params.id)).get();
      if (!n) return reply.status(404).send({ error: "not_found" });
      return ctx.tasks.deleteNote(n.path);
    });
    api.post("/notes", async (req, reply) => {
      const body = z.object({ title: z.string().min(1).max(200), content: z.string().max(512 * 1024).default("") }).parse(req.body);
      const path = await ctx.tasks.captureNote(body.title, body.content);
      const n = db.select({ id: notes.id }).from(notes).where(eq(notes.path, path)).get();
      return reply.status(201).send(n ? noteDetail(db, n.id, nag()) : { path });
    });
    api.post("/log", async (req) => ({ path: await ctx.tasks.appendLog(Text(4000).parse(req.body).text) }));

    api.get("/version", async () => ({ ...updateInfo(), updateCommand: "scripts/update.sh" }));

    // --- settings (Settings page) and system info
    api.get("/prefs", async () => ctx.settings.prefs());
    api.get("/settings", async () => ({
      groups: ctx.settings.describe(ctx.appliedSettings),
      timezones: Intl.supportedValuesOf("timeZone"),
      canRestart: process.env.OMNICORE_DOCKER === "1",
    }));
    api.put("/settings", async (req, reply) => {
      const body = z.object({ values: z.record(z.string(), z.union([z.string().max(200), z.null()])) }).parse(req.body);
      try {
        const r = ctx.settings.set(body.values);
        // Read-per-use settings take effect now.
        if ("tomorrowTime" in body.values) config.TOMORROW_TIME = ctx.settings.get("tomorrowTime");
        return { ...r, groups: ctx.settings.describe(ctx.appliedSettings) };
      } catch (e) {
        if (e instanceof SettingError) return reply.status(400).send({ error: "invalid_setting", message: e.message });
        throw e;
      }
    });
    api.post("/settings/restart", async (_req, reply) => {
      if (process.env.OMNICORE_DOCKER !== "1") return reply.status(409).send({ error: "manual_restart", message: "Restart the app yourself to apply (outside Docker it can't restart itself)." });
      setTimeout(() => process.kill(process.pid, "SIGTERM"), 400).unref();
      return { restarting: true };
    });
    api.post("/reminders/pause", async (req) => {
      const { minutes } = z.object({ minutes: z.number().int().min(0).max(14 * 24 * 60) }).parse(req.body);
      ctx.settings.pause(minutes ? new Date(Date.now() + minutes * 60_000) : null);
      return { pausedUntil: ctx.settings.pausedUntil() };
    });
    api.get("/system", async () => ({
      version: updateInfo(),
      updateCommand: "scripts/update.sh",
      telegram: { status: opts.telegramStatus?.() ?? "disabled", miniApp: !!getMiniAppUrl() },
      ai: { ...aiFeatures(ctx), model: config.AI_PROVIDER === "none" ? null : config.AI_CHAT_MODEL },
      counts: {
        tasks: (db.$client.prepare("SELECT count(*) AS n FROM tasks WHERE status NOT IN ('done','cancelled')").get() as { n: number }).n,
        done: (db.$client.prepare("SELECT count(*) AS n FROM tasks WHERE status = 'done'").get() as { n: number }).n,
        notes: (db.$client.prepare("SELECT count(*) AS n FROM notes").get() as { n: number }).n,
        projects: (db.$client.prepare("SELECT count(*) AS n FROM projects").get() as { n: number }).n,
      },
      backups: listBackups(config.DATABASE_PATH).slice(0, 5),
      docker: process.env.OMNICORE_DOCKER === "1",
    }));
    api.post("/backup", async () => backupNow(config.DATABASE_PATH));

    // --- AI
    const deps = () => ({ db, ai: ctx.ai, semantic: ctx.semantic, nag: ctx.nag });
    api.get("/ai/status", async () => ({
      ...ctx.ai.status(),
      index: ctx.semantic ? { ...ctx.semantic.stats(), health: embedHealth() } : null,
      features: aiFeatures(ctx),
    }));
    api.post("/ai/ask", async (req) => ask(deps(), z.object({ q: z.string().min(1).max(500) }).parse(req.body).q));
    api.get("/search/semantic", async (req) => {
      const { q, k } = z.object({ q: z.string().min(2).max(200), k: z.coerce.number().int().min(1).max(30).default(8) }).parse(req.query);
      if (!ctx.semantic) return { hits: [] };
      const hint = parseTimeHint(q, config.TIMEZONE);
      const all = await ctx.semantic.search(q, k, hint ?? {});
      // "Related" should mean related: keep only hits close to the best match.
      const top = all[0]?.score ?? 0;
      const hits = all.filter((h) => h.score >= top * 0.8);
      return { timeRange: hint?.label ?? null, hits: describeHits(db, hits).map((h, i) => ({ ...h, score: Math.round((hits[i]!.score) * 1000) / 1000 })) };
    });
    api.post<{ Params: { id: string } }>("/tasks/:id/breakdown", async (req) => {
      const { hint } = z.object({ hint: z.string().max(300).optional() }).parse(req.body ?? {});
      ctx.tasks.get(req.params.id); // 404 early
      return suggestSubtasks(deps(), req.params.id, hint);
    });
    api.post<{ Params: { id: string } }>("/tasks/:id/subtasks", async (req, reply) => {
      const { titles } = z.object({ titles: z.array(z.string().min(1).max(200)).min(1).max(20) }).parse(req.body);
      return reply.status(201).send(await ctx.tasks.addSubtasks(req.params.id, titles));
    });
    api.post("/ai/digest", async (req) => {
      const { kind } = z.object({ kind: z.enum(["standup", "retro"]) }).parse(req.body);
      return runDigest(ctx, kind);
    });
    api.post("/ai/reindex", async (_req, reply) => {
      if (!ctx.semantic) return reply.status(503).send({ error: "ai_unavailable", reason: "disabled" });
      await runEmbedSync(ctx, { force: true });
      return { ...ctx.semantic.stats(), health: embedHealth() };
    });
    api.get("/graph", async () => graph(db));
    api.post("/vault/reindex", async () => ctx.indexer.fullScan());
  });
}
