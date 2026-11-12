import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AppContext } from "./context.js";
import { VERSION } from "./version.js";
import { apiRoutes } from "./routes/api.js";
import { registerSecurityHeaders, safeRequestSerializer } from "./security.js";

/** The HTTP surface (API + web app), without scheduler or Telegram, so tests can inject requests. */
export async function buildHttp(
  ctx: AppContext,
  opts: { telegramStatus?: () => string; logger?: boolean } = {},
): Promise<FastifyInstance> {
  const { config } = ctx;
  const app = Fastify({
    logger:
      opts.logger === false
        ? false
        : { level: config.NODE_ENV === "production" ? "info" : "debug", serializers: { req: safeRequestSerializer } },
    bodyLimit: 1024 * 1024,
    trustProxy: config.TRUST_PROXY,
  });
  registerSecurityHeaders(app);
  if (config.CORS_ORIGINS.length) await app.register(cors, { origin: config.CORS_ORIGINS, credentials: true });
  // Version/commit only for callers on this machine or the local network (update.sh, Docker's
  // healthcheck). Anything that came through a proxy/tunnel, or from a public address, gets the
  // minimal answer, so the exact version isn't advertised to the internet.
  app.get("/health", async (req) => {
    const viaProxy = !!(req.headers["cf-connecting-ip"] || req.headers["x-forwarded-for"]);
    const base = { ok: true, time: new Date().toISOString(), telegram: opts.telegramStatus?.() ?? "disabled" };
    return !viaProxy && isPrivateAddress(req.socket.remoteAddress ?? "") ? { ...base, version: VERSION.version, sha: VERSION.sha } : base;
  });
  await app.register((api) => apiRoutes(api, ctx), { prefix: "/api" });

  // Web app + Telegram Mini App: one single-page app; /tg/* is the Mini App.
  const webDist = resolve(config.WEB_DIST ?? join(dirname(fileURLToPath(import.meta.url)), "../../web/dist"));
  if (existsSync(join(webDist, "index.html"))) {
    await app.register(fastifyStatic, { root: webDist, wildcard: true, index: ["index.html"], dotfiles: "deny" });
    app.setNotFoundHandler((req, reply) => {
      const path = req.url.split("?")[0]!;
      if (req.method === "GET" && !path.startsWith("/api/") && !path.startsWith("/telegram/") && !/\.[a-z0-9]+$/i.test(path)) {
        return reply.type("text/html; charset=utf-8").sendFile("index.html");
      }
      return reply.status(404).send({ error: "not_found" });
    });
    app.log.info(`web app: serving ${webDist}`);
  } else {
    app.log.warn(`web app not built (${webDist}); run \`npm run build\``);
  }
  return app;
}

/** Loopback, RFC 1918, CGNAT, link-local and IPv6 ULA/loopback addresses. */
export function isPrivateAddress(ip: string): boolean {
  const v4 = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  const m = v4.match(/^(\d+)\.(\d+)\.\d+\.\d+$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254);
  }
  const v6 = ip.toLowerCase();
  return v6 === "::1" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe80:");
}
