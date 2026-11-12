import { createServer, type Server } from "node:http";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { composeDefaults, loadConfig } from "../src/config.js";
import { ensureApiToken } from "../src/token.js";
import { ensureModels } from "../src/ai.js";
import type { AppContext } from "../src/context.js";

describe("compose defaults (COMPOSE_PROFILES → OMNICORE_PROFILES)", () => {
  it("does nothing outside Docker", () => {
    const e = composeDefaults({ TIMEZONE: "UTC" });
    expect(e.AI_PROVIDER).toBeUndefined();
    expect(e.REDIS_URL).toBeUndefined();
  });

  it("points at the bundled services for the extras switched on", () => {
    const c = loadConfig({ OMNICORE_PROFILES: "ai, tunnel,redis" });
    expect(c.AI_PROVIDER).toBe("ollama");
    expect(c.OLLAMA_BASE_URL).toBe("http://omnicore-ollama:11434");
    expect(c.REDIS_URL).toBe("redis://omnicore-redis:6379");
  });

  it("turns AI off quietly when no model server is configured", () => {
    expect(loadConfig({ OMNICORE_PROFILES: "" }).AI_PROVIDER).toBe("none");
    expect(loadConfig({ OMNICORE_PROFILES: "tunnel", OLLAMA_BASE_URL: "" }).AI_PROVIDER).toBe("none");
  });

  it("lets explicit settings win", () => {
    const c = loadConfig({ OMNICORE_PROFILES: "ai", OLLAMA_BASE_URL: "http://host.docker.internal:11434", REDIS_URL: "" });
    expect(c.OLLAMA_BASE_URL).toBe("http://host.docker.internal:11434");
    expect(c.REDIS_URL).toBeUndefined();
    expect(loadConfig({ OMNICORE_PROFILES: "", OLLAMA_BASE_URL: "http://host.docker.internal:11434" }).AI_PROVIDER).toBe("ollama");
  });
});

describe("generated web password", () => {
  const dir = mkdtempSync(join(tmpdir(), "oc-token-"));
  const cfg = (extra: Record<string, string> = {}) => loadConfig({ DATABASE_PATH: join(dir, "app.db"), ...extra });

  it("is not used on localhost or when API_TOKEN is set", () => {
    expect(ensureApiToken(cfg())).toBeUndefined();
    const c = cfg({ HOST: "0.0.0.0", API_TOKEN: "set-by-me-0123456789" });
    expect(ensureApiToken(c)).toBeUndefined();
    expect(c.API_TOKEN).toBe("set-by-me-0123456789");
  });

  it("is created once, private, and reused", () => {
    const a = cfg({ HOST: "0.0.0.0" });
    expect(ensureApiToken(a)).toEqual({ path: join(dir, "api-token"), created: true });
    expect(a.API_TOKEN!.length).toBeGreaterThanOrEqual(32);
    expect(statSync(join(dir, "api-token")).mode & 0o777).toBe(0o600);
    const b = cfg({ HOST: "0.0.0.0" });
    expect(ensureApiToken(b)?.created).toBe(false);
    expect(b.API_TOKEN).toBe(a.API_TOKEN);
  });

  it("replaces an empty or truncated file", () => {
    writeFileSync(join(dir, "api-token"), "short\n");
    const c = cfg({ HOST: "0.0.0.0" });
    expect(ensureApiToken(c)?.created).toBe(true);
    expect(readFileSync(join(dir, "api-token"), "utf8").trim()).toBe(c.API_TOKEN);
  });
});

describe("Ollama model auto-download", () => {
  let server: Server;
  let base = "";
  const have = new Set(["llama3.2:3b"]);
  const pulls: string[] = [];
  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        res.setHeader("content-type", "application/json");
        if (req.url === "/api/tags") return res.end(JSON.stringify({ models: [...have].map((name) => ({ name })) }));
        if (req.url === "/api/pull") {
          const { model } = JSON.parse(body);
          pulls.push(model);
          if (model === "no-such-model") return res.end(JSON.stringify({ error: "pull model manifest: file does not exist" }));
          have.add(model.includes(":") ? model : `${model}:latest`);
          return res.end(JSON.stringify({ status: "success" }));
        }
        res.statusCode = 404;
        res.end("{}");
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterAll(() => server.close());

  const ctxWith = (env: Record<string, string>) => ({ config: loadConfig({ OLLAMA_BASE_URL: base, ...env }), semantic: undefined }) as unknown as AppContext;

  it("pulls only what's missing, then nothing", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    await ensureModels(ctxWith({}));
    expect(pulls).toEqual(["nomic-embed-text"]);
    await ensureModels(ctxWith({}));
    expect(pulls).toEqual(["nomic-embed-text"]);
    expect(log.mock.calls.flat().join("\n")).toMatch(/downloading model nomic-embed-text/);
    log.mockRestore();
  });

  it("reports a bad model name without throwing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    await ensureModels(ctxWith({ AI_CHAT_MODEL: "no-such-model" }));
    expect(warn.mock.calls.flat().join("\n")).toMatch(/couldn't download no-such-model: pull model manifest/);
    warn.mockRestore();
    info.mockRestore();
  });

  it("can be switched off", async () => {
    pulls.length = 0;
    await ensureModels(ctxWith({ AI_AUTO_PULL: "false", AI_VISION_MODEL: "llava" }));
    expect(pulls).toEqual([]);
  });
});

describe("quick tunnel", () => {
  it("is switched on by the quicktunnel extra unless PUBLIC_URL is set", () => {
    expect(loadConfig({ OMNICORE_PROFILES: "quicktunnel" }).QUICK_TUNNEL_METRICS).toBe("http://omnicore-quicktunnel:2000");
    expect(loadConfig({ OMNICORE_PROFILES: "quicktunnel", PUBLIC_URL: "https://ws.example.com" }).QUICK_TUNNEL_METRICS).toBeUndefined();
    expect(loadConfig({ OMNICORE_PROFILES: "tunnel" }).QUICK_TUNNEL_METRICS).toBeUndefined();
  });

  it("reports the address once per change and ignores anything that isn't a trycloudflare host", async () => {
    const { watchQuickTunnel } = await import("../src/quicktunnel.js");
    let host: unknown = "";
    const server = createServer((req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(req.url === "/quicktunnel" ? JSON.stringify({ hostname: host }) : "{}");
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const seen: string[] = [];
    const w = watchQuickTunnel(base, (u) => void seen.push(u), 40);
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    await wait(150);
    host = "evil.example.com";
    await wait(150);
    host = "Calm-River-Words.trycloudflare.com";
    await wait(2300);
    host = "new-words-here.trycloudflare.com";
    await wait(200);
    w.stop();
    server.close();
    expect(seen).toEqual(["https://calm-river-words.trycloudflare.com", "https://new-words-here.trycloudflare.com"]);
  });
});

describe("PUBLIC_URL is forgiving", () => {
  it("fixes common .env slips and never stops the server", async () => {
    const { normalizePublicUrl } = await import("../src/config.js");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(normalizePublicUrl("tg.example.com")).toBe("https://tg.example.com");
    expect(normalizePublicUrl('"https://tg.example.com/"')).toBe("https://tg.example.com");
    expect(normalizePublicUrl("https://tg.example.com   # mini app")).toBe("https://tg.example.com");
    expect(normalizePublicUrl("")).toBeUndefined();
    expect(normalizePublicUrl("not a url")).toBeUndefined();
    expect(loadConfig({ PUBLIC_URL: "http//broken" }).PUBLIC_URL).toBeUndefined();
    warn.mockRestore();
  });
});
