// 0.6 walkthrough: one Paper app on the web (desktop) and in Telegram (phone), clicking through
// every screen and checking delete + undo, updates, steps, settings and the guide.
//   node demo/ui-session.mjs   (wait for READY)   then   node demo/peek-app.mjs /tmp/shots
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { signInitData } from "../apps/server/dist/auth.js";
import { telegramStub } from "./tg-stub.mjs";
// Playwright from the project (npm i -D playwright), or a global install.
let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  ({ chromium } = createRequire("/opt/npm-tools/node_modules/")("playwright"));
}
const { base, token, bot } = JSON.parse(readFileSync(new URL("./ui-run/ready", import.meta.url)));
const out = process.argv[2] ?? "/tmp";
// CHROME_PATH (or /usr/bin/google-chrome if present); otherwise Playwright's own Chromium.
const exe = process.env.CHROME_PATH || (existsSync("/usr/bin/google-chrome") ? "/usr/bin/google-chrome" : undefined);
const b = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
const problems = [];
let ok = 0;
const check = (name, cond) => { if (cond) ok++; else problems.push(name); console.log(`${cond ? "✔" : "✘"} ${name}`); };
const errors = [];
const watch = (p) => { p.on("response", (r) => r.status() === 404 && errors.push(`404 ${r.url().replace(base, "")}`)); p.on("pageerror", (e) => errors.push(e.message)); p.on("console", (m) => m.type() === "error" && !/favicon|401/.test(m.text()) && errors.push(m.text())); };
const wait = (p, ms = 500) => p.waitForTimeout(ms);
const api = async (p, path, init) => (await p.request.fetch(base + path, { ...init, headers: { "x-omnicore": "1", ...(init?.headers ?? {}) } })).json();

// ------------------------------------------------------------------ web, desktop
{
  const ctx = await b.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1.5 });
  const p = await ctx.newPage();
  watch(p);
  await p.goto(base + "/"); await wait(p, 800);
  check("sign-in asks for a password and says where to find it", (await p.textContent("body")).includes("cat data/api-token"));
  await p.screenshot({ path: `${out}/web-0-signin.png` });
  await p.fill("#token", token); await p.click("button[type=submit]"); await wait(p, 1200);
  check("welcome guide on first visit", await p.getByRole("dialog", { name: "Welcome to OmniCore" }).isVisible());
  await p.screenshot({ path: `${out}/web-1-welcome.png` });
  await p.getByRole("button", { name: "Next" }).click(); await p.getByRole("button", { name: "Next" }).click(); await p.getByRole("button", { name: "Start" }).click(); await wait(p);
  check("sidebar with the same sections", ["Today", "Upcoming", "Projects", "Notes", "Settings", "Help & guide"].every((x) => p.getByRole("link", { name: x }).first()));
  check("plain words: Needs you now", await p.getByText("Needs you now").isVisible());
  await p.screenshot({ path: `${out}/web-2-today.png` });

  // a task
  await p.getByRole("link", { name: /Open “Replace core switch”/ }).click(); await wait(p, 900);
  check("task screen explains the reminders", (await p.textContent("body")).match(/Next reminder|Reminder due now|First reminder/) !== null);
  await p.screenshot({ path: `${out}/web-3-task.png`, fullPage: true });
  await p.fill("#update", "Waiting for the new SFP modules"); await p.getByRole("button", { name: "Save", exact: true }).click(); await wait(p, 900);
  check("update (remark) saved from the web", (await p.textContent("body")).includes("Waiting for the new SFP modules"));
  await p.fill("#new-step", "Label the cables"); await p.getByRole("button", { name: "Add", exact: true }).click(); await wait(p, 900);
  check("step added", (await p.textContent("body")).includes("Label the cables"));
  await p.getByRole("button", { name: "Back" }).click(); await wait(p, 700);

  // delete + undo
  const before = (await api(p, "/api/tasks?limit=2000")).length;
  await p.getByRole("link", { name: /Open “Backup NAS”/ }).click(); await wait(p, 800);
  await p.getByRole("button", { name: "Delete task" }).click(); await wait(p, 300);
  await p.screenshot({ path: `${out}/web-4-delete-confirm.png` });
  await p.getByRole("button", { name: "Delete", exact: true }).click(); await wait(p, 900);
  check("task deleted", (await api(p, "/api/tasks?limit=2000")).length === before - 1);
  await p.screenshot({ path: `${out}/web-5-undo-toast.png` });
  await p.getByRole("button", { name: "Undo" }).click(); await wait(p, 1000);
  check("undo brings it back", (await api(p, "/api/tasks?limit=2000")).length === before);

  // projects, settings, help, notes, board
  await p.getByRole("link", { name: "Projects" }).first().click(); await wait(p, 700);
  await p.screenshot({ path: `${out}/web-6-projects.png` });
  await p.getByRole("link", { name: "Settings" }).click(); await wait(p, 900);
  await p.screenshot({ path: `${out}/web-7-settings.png`, fullPage: true });
  await p.getByRole("radio", { name: "Dark" }).click(); await wait(p, 700);
  check("theme setting switches the whole app", (await p.evaluate(() => document.documentElement.dataset.theme)) === "dark");
  await p.getByRole("radio", { name: "Teal" }).click(); await wait(p, 600);
  check("accent setting applies", (await p.evaluate(() => document.documentElement.dataset.accent)) === "teal");
  await p.screenshot({ path: `${out}/web-8-settings-dark.png` });
  await p.selectOption("#set-everyOverdue", "15"); await wait(p, 700);
  check("reminder change asks for a restart", (await p.textContent("body")).includes("Waiting for a restart"));
  await p.getByRole("button", { name: "Until tomorrow" }).click(); await wait(p, 600);
  check("pause all reminders", !!(await api(p, "/api/prefs")).pausedUntil);
  await p.getByRole("button", { name: "Resume now" }).click(); await wait(p, 500);
  await p.getByRole("link", { name: "Help & guide" }).click(); await wait(p, 700);
  check("guide uses the real numbers", (await p.textContent("body")).includes("every 15 minutes"));
  await p.screenshot({ path: `${out}/web-9-help.png`, fullPage: true });
  await p.getByRole("link", { name: "Board" }).click(); await wait(p, 900);
  check("board in plain words", ["Someday", "To do", "Doing", "Waiting", "Done"].every((w) => p.getByRole("heading", { name: w })));
  await p.screenshot({ path: `${out}/web-10-board.png` });
  await p.getByRole("link", { name: "Notes" }).click(); await wait(p, 900);
  await p.screenshot({ path: `${out}/web-11-notes.png` });
  // back to light for the next run
  await api(p, "/api/settings", { method: "PUT", data: { values: { theme: null, accent: null, everyOverdue: null } } });
  await ctx.close();
}

// ------------------------------------------------------------------ Telegram Mini App, phone (Telegram in dark mode)
{
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await ctx.addInitScript(telegramStub({ initData: signInitData(bot, { id: 111, first_name: "Sabbir" }), dark: true }));
  await ctx.addInitScript(() => localStorage.setItem("oc-welcomed", "1"));
  const p = await ctx.newPage();
  watch(p);
  const main = () => p.evaluate(() => window.Telegram.WebApp._main);
  await p.goto(base + "/tg"); await wait(p, 1500);
  check("Mini App: same Today screen", await p.getByText("Needs you now").isVisible());
  check("Mini App: Paper light by default", (await p.evaluate(() => document.documentElement.dataset.theme)) === "light");
  check("Mini App: main button = New task", (await main()).text === "New task");
  await p.screenshot({ path: `${out}/tg-1-today.png` });
  await p.getByRole("tab", { name: "More" }).click(); await wait(p, 600);
  await p.screenshot({ path: `${out}/tg-2-more.png` });
  await p.getByRole("button", { name: /Settings/ }).click(); await wait(p, 900);
  check("Mini App: settings", (await p.textContent("body")).includes("Pause all reminders"));
  await p.screenshot({ path: `${out}/tg-3-settings.png` });
  await p.evaluate(() => window.Telegram.WebApp._back.cbs.forEach((cb) => cb())); await wait(p, 600);
  await p.getByRole("tab", { name: "Today" }).click(); await wait(p, 700);
  await p.getByRole("link", { name: /Open “Draft homepage copy”/ }).click(); await wait(p, 900);
  check("Mini App: Done is Telegram's main button", (await main()).text === "✓ Done");
  await p.screenshot({ path: `${out}/tg-4-task.png` });
  await p.fill("#update", "Waiting on the logo files"); await p.getByRole("button", { name: "Save", exact: true }).click(); await wait(p, 900);
  check("Mini App: update saved", (await p.textContent("body")).includes("Waiting on the logo files"));
  await p.getByRole("button", { name: /Later/ }).click(); await wait(p, 400);
  await p.screenshot({ path: `${out}/tg-5-later.png` });
  await p.getByRole("button", { name: /In 1 hour/ }).click(); await wait(p, 900);
  check("Mini App: Later → in 1 hour", (await p.textContent("body")).includes("Quiet until"));
  await p.getByRole("button", { name: "Delete task" }).click(); await wait(p, 300);
  await p.getByRole("button", { name: "Delete", exact: true }).click(); await wait(p, 1000);
  check("Mini App: deleted, back on Today", !(await p.textContent("body")).includes("Draft homepage copy") || (await p.getByText("Deleted: Draft homepage copy").isVisible()));
  await p.screenshot({ path: `${out}/tg-6-deleted.png` });
  await ctx.close();
}

console.log(`\n${ok} ok, ${problems.length} problems`, problems);
console.log("page errors:", errors.length ? [...new Set(errors)] : "none");
await b.close();
