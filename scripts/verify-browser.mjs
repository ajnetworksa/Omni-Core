// Used by `npm run verify -- --browser`: starts the demo server (demo data, mock Telegram/AI),
// runs the click-through walkthrough (demo/peek-app.mjs) and fails unless every check passed
// with no page errors. Screenshots: tests/.run/verify/shots/ — look at them for UI changes.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const ready = join(root, "demo/ui-run/ready");
const shots = join(root, "tests/.run/verify/shots");
rmSync(shots, { recursive: true, force: true });
mkdirSync(shots, { recursive: true });
rmSync(ready, { force: true });

const session = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "demo/ui-session.mjs"], { cwd: root, stdio: "ignore" });
const stop = () => session.kill("SIGTERM");
process.on("exit", stop);
for (let i = 0; i < 90 && !existsSync(ready); i++) await new Promise((r) => setTimeout(r, 1000));
if (!existsSync(ready)) {
  console.error("demo server didn't start (demo/ui-session.mjs)");
  process.exit(1);
}

const walk = spawn(process.execPath, ["demo/peek-app.mjs", shots], { cwd: root });
let out = "";
walk.stdout.on("data", (d) => { out += d; process.stdout.write(d); });
walk.stderr.on("data", (d) => { out += d; process.stderr.write(d); });
const code = await new Promise((r) => walk.on("close", r));
stop();
const m = out.match(/(\d+) ok, (\d+) problems/);
const clean = /page errors: none/.test(out);
if (code === 0 && m && m[2] === "0" && clean) {
  console.log(`${m[1]}/${m[1]} passed (walkthrough), no page errors · screenshots in tests/.run/verify/shots`);
  process.exit(0);
}
console.error(`walkthrough failed: ${m ? `${m[2]} problems` : "did not finish"}${clean ? "" : ", page errors"}`);
process.exit(1);
