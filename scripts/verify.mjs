#!/usr/bin/env node
// One command that proves the project works. Any AI assistant (or person) must run it and show
// its final summary before saying a change is done — "it should work" doesn't count.
//
//   npm run verify            everything: build, unit, E2E, security, AI, (browser walkthrough if available)
//   npm run verify:quick      build + unit tests (~1 min) — what the pre-push hook runs
//   npm run verify -- --docker   also build the Docker image and check it starts healthy
//   npm run verify -- --browser  also click through the web app + Mini App in Chrome (Playwright)
//
// Exit code 0 only if every step that ran passed. Logs: tests/.run/verify/<step>.log
// Report:  tests/.run/verify/REPORT.md (paste its contents as proof).
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
process.chdir(root);
const args = new Set(process.argv.slice(2));
const quick = args.has("--quick");
const docker = args.has("--docker");
const logDir = join(root, "tests/.run/verify");
mkdirSync(logDir, { recursive: true });
const NODE = `node --disable-warning=ExperimentalWarning`;

const have = (cmd) => spawnSync(cmd, ["--version"], { shell: true, stdio: "ignore" }).status === 0;
const git = (a) => spawnSync("git", a, { encoding: "utf8", shell: false });

/** @type {{ name: string, cmd?: string, fn?: () => string | null, timeout: number, skip?: string }[]} */
const steps = [
  { name: "repo hygiene", fn: hygiene, timeout: 10_000 },
  { name: "typecheck (core + server)", cmd: "npx tsc -b", timeout: 300_000 },
  { name: "web app build (typecheck + bundle)", cmd: "npm run build -w @omnicore/web", timeout: 300_000 },
  { name: "unit tests (core + server)", cmd: "npm test", timeout: 600_000 },
];
if (!quick) {
  steps.push(
    { name: "E2E feature tests", cmd: `${NODE} tests/e2e.mjs`, timeout: 900_000 },
    { name: "security tests", cmd: `${NODE} tests/security.mjs`, timeout: 600_000 },
    { name: "AI end-to-end tests", cmd: `${NODE} tests/ai-e2e.mjs`, timeout: 900_000 },
    { name: "config docs up to date", fn: configDocs, timeout: 30_000 },
    browserStep(),
  );
}
if (docker) steps.push(dockerStep());

/** Things that broke real deploys before: stray files, secrets in git, leftover old screens. */
function hygiene() {
  const problems = [];
  if (!existsSync(join(root, ".git"))) return null; // not a git checkout (e.g. inside Docker): nothing to check
  const tracked = git(["ls-files"]).stdout.split("\n").filter(Boolean);
  for (const f of tracked) {
    if ((/^\.env(\..+)?$/.test(f) && f !== ".env.example") || (/^(data|vault|config|redis-data|ollama)\//.test(f) && !f.endsWith(".gitkeep"))) problems.push(`tracked by git but must not be: ${f}`);
    if (/\.(zip|db|db-wal|db-shm)$/.test(f)) problems.push(`binary/archive tracked by git: ${f}`);
  }
  // Source files that exist on disk but aren't in git: they'd be missing on the server (or are leftovers).
  const untracked = git(["ls-files", "--others", "--exclude-standard", "apps", "packages", "scripts", "tests"]).stdout.split("\n").filter(Boolean);
  for (const f of untracked) if (/\.(ts|tsx|mjs|js|css|sql)$/.test(f)) problems.push(`not in git (add it, or delete it if it's a leftover): ${f}`);
  return problems.length ? problems.join("\n") : null;
}

function configDocs() {
  const before = readFileSync("docs/CONFIGURATION.md", "utf8");
  const r = spawnSync(process.execPath, ["scripts/config-docs.mjs"], { encoding: "utf8" });
  if (r.status !== 0) return r.stderr || "config-docs failed";
  const after = readFileSync("docs/CONFIGURATION.md", "utf8");
  return before === after ? null : "docs/CONFIGURATION.md was out of date; it has been regenerated — review and commit it";
}

function browserStep() {
  // Clicks through the real web app and Mini App in Chrome (Playwright). Opt-in: needs
  // `npm i -D playwright && npx playwright install chromium` once.
  const name = "browser walkthrough (web + Mini App)";
  if (!args.has("--browser")) return { name, timeout: 0, skip: "add --browser to run it (needs Playwright)" };
  return { name, cmd: `${process.execPath} scripts/verify-browser.mjs`, timeout: 600_000 };
}

function dockerStep() {
  if (!have("docker")) return { name: "Docker image builds and starts healthy", timeout: 0, skip: "docker not installed here" };
  if (spawnSync("docker", ["info"], { stdio: "ignore" }).status !== 0) return { name: "Docker image builds and starts healthy", timeout: 0, fn: () => "Docker is installed but not running (start Docker, then run again)" };
  return {
    name: "Docker image builds and starts healthy",
    cmd: [
      "docker build -t omnicore-verify:local .",
      "docker rm -f omnicore-verify >/dev/null 2>&1 || true",
      "docker run -d --name omnicore-verify -e API_TOKEN=verify-token-0123456789 -p 127.0.0.1:3999:3000 omnicore-verify:local",
      `${process.execPath} -e "let n=0;const t=setInterval(async()=>{n++;try{const r=await fetch('http://127.0.0.1:3999/health');if(r.ok){console.log('healthy');clearInterval(t);process.exit(0)}}catch{}if(n>60){console.log('not healthy after 60s');process.exit(1)}},1000)"`,
    ].join(" && ") + "; s=$?; docker logs omnicore-verify 2>&1 | tail -20; docker rm -f omnicore-verify >/dev/null 2>&1; exit $s",
    timeout: 1_200_000,
  };
}

function run(step) {
  return new Promise((done) => {
    const started = Date.now();
    if (step.skip) return done({ ...step, status: "SKIP", note: step.skip, ms: 0 });
    if (step.fn) {
      try {
        const problem = step.fn();
        return done({ ...step, status: problem ? "FAIL" : "PASS", note: problem ?? "", ms: Date.now() - started });
      } catch (e) {
        return done({ ...step, status: "FAIL", note: String(e), ms: Date.now() - started });
      }
    }
    const log = join(logDir, `${step.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.log`);
    let out = "";
    const child = spawn(step.cmd, { shell: process.platform === "win32" ? true : "/bin/bash", env: { ...process.env, FORCE_COLOR: "0", CI: "1" } });
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    const timer = setTimeout(() => {
      out += `\n[verify] timed out after ${step.timeout / 1000}s\n`;
      child.kill("SIGKILL");
    }, step.timeout);
    child.on("close", (code) => {
      clearTimeout(timer);
      out = out.replace(/\x1b\[[0-9;]*m/g, ""); // strip colours
      writeFileSync(log, out);
      // Pull the suite's own count line ("56/56 passed", "Tests 71 passed") into the report.
      const counts = [...out.matchAll(/(\d+\/\d+ passed|Tests\s+\d+ passed[^\n]*|\d+ passed \(\d+\))/g)].map((m) => m[1].replace(/\s+/g, " ").trim());
      done({ ...step, status: code === 0 ? "PASS" : "FAIL", note: code === 0 ? [...new Set(counts)].join("; ") : `exit ${code} — last lines:\n${out.trim().split("\n").slice(-25).join("\n")}`, ms: Date.now() - started, log });
    });
  });
}

const results = [];
for (const s of steps) {
  process.stdout.write(`▶ ${s.name} … `);
  const r = await run(s);
  results.push(r);
  console.log(`${r.status}${r.ms ? ` (${Math.round(r.ms / 1000)}s)` : ""}${r.status === "PASS" && r.note ? ` — ${r.note}` : r.status === "SKIP" ? ` — ${r.note}` : ""}`);
  if (r.status === "FAIL") {
    console.log(r.note.split("\n").map((l) => `   ${l}`).join("\n"));
    if (r.log) console.log(`   full log: ${r.log}`);
  }
}

const failed = results.filter((r) => r.status === "FAIL");
const sha = git(["rev-parse", "--short", "HEAD"]).stdout?.trim() || "no-git";
const dirty = git(["status", "--porcelain"]).stdout?.trim() ? " (with uncommitted changes)" : "";
const version = JSON.parse(readFileSync("package.json", "utf8")).version;
const report = [
  `# Verify report — ${new Date().toISOString()}`,
  ``,
  `Version ${version} · commit ${sha}${dirty} · mode: ${quick ? "quick" : "full"}${docker ? " + docker" : ""} · node ${process.version} · ${process.platform}`,
  ``,
  `| Step | Result | Time | Details |`,
  `|---|---|---|---|`,
  ...results.map((r) => `| ${r.name} | ${r.status} | ${r.ms ? `${Math.round(r.ms / 1000)}s` : "–"} | ${(r.status === "FAIL" ? r.note.split("\n")[0] : r.note).replace(/\|/g, "/")} |`),
  ``,
  failed.length ? `**VERIFY: FAIL** — ${failed.map((r) => r.name).join(", ")}` : `**VERIFY: PASS** — ${results.filter((r) => r.status === "PASS").length} passed, ${results.filter((r) => r.status === "SKIP").length} skipped`,
].join("\n");
writeFileSync(join(logDir, "REPORT.md"), report + "\n");
console.log(`\n${report}\n\n(report saved to tests/.run/verify/REPORT.md)`);
process.exit(failed.length ? 1 : 0);
