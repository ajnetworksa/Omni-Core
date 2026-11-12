// Shared helpers: start/stop the built server, HTTP client, check recorder.
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function localDate(tz, offsetDays = 0, now = new Date()) {
  const d = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const [y, m, dd] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, dd + offsetDays)).toISOString().slice(0, 10);
}
export function localHHMM(tz, now = new Date()) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);
}

export async function startServer({ env, port, logFile }) {
  const child = spawn(process.execPath, [join(ROOT, "apps/server/dist/boot.js")], {
    cwd: ROOT,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: "production", PORT: String(port), ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const log = [];
  child.stdout.on("data", (d) => log.push(d.toString()));
  child.stderr.on("data", (d) => log.push(d.toString()));
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error(`server exited early:\n${log.join("")}`);
    try {
      const r = await fetch(`${base}/health`);
      if (r.ok) break;
    } catch {}
    await sleep(150);
  }
  const stop = async () => {
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await new Promise((r) => child.once("exit", r));
    }
    if (logFile) {
      mkdirSync(dirname(logFile), { recursive: true });
      writeFileSync(logFile, log.join(""));
    }
  };
  return { child, base, log, stop };
}

export function client(base, token, defaults = {}) {
  const req = async (method, path, body, headers = {}) => {
    const d = typeof defaults === "function" ? defaults() : defaults;
    const res = await fetch(base + path, {
      method,
      headers: { ...(body !== undefined && { "content-type": "application/json" }), ...(token && { authorization: `Bearer ${token}` }), ...d, ...headers },
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {}
    return { status: res.status, json, text, headers: res.headers };
  };
  return {
    get: (p, h) => req("GET", p, undefined, h),
    post: (p, b, h) => req("POST", p, b ?? {}, h),
    patch: (p, b, h) => req("PATCH", p, b, h),
    raw: req,
  };
}

export class Checks {
  constructor(suite) {
    this.suite = suite;
    this.results = [];
    this.section = "";
  }
  group(name) {
    this.section = name;
    console.log(`\n## ${name}`);
  }
  async run(name, fn) {
    const t0 = Date.now();
    try {
      const detail = await fn();
      this.results.push({ section: this.section, name, ok: true, ms: Date.now() - t0, detail: detail ?? "" });
      console.log(`  ✔ ${name}${detail ? ` — ${detail}` : ""}`);
    } catch (e) {
      this.results.push({ section: this.section, name, ok: false, ms: Date.now() - t0, detail: e.message });
      console.log(`  ✘ ${name} — ${e.message}`);
    }
  }
  summary(outFile) {
    const failed = this.results.filter((r) => !r.ok);
    console.log(`\n${this.suite}: ${this.results.length - failed.length}/${this.results.length} passed`);
    if (outFile) {
      mkdirSync(dirname(outFile), { recursive: true });
      writeFileSync(outFile, JSON.stringify({ suite: this.suite, at: new Date().toISOString(), results: this.results }, null, 2));
    }
    return failed.length;
  }
}

export function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
export function eq(actual, expected, msg) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${msg ?? "mismatch"}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

export function freshDir(path) {
  rmSync(path, { recursive: true, force: true });
  mkdirSync(path, { recursive: true });
  return path;
}
