// Mini App v0.5.3 walkthrough: Paper look, suggestions while typing, projects you can open/create.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { signInitData } from "../apps/server/dist/auth.js";
import { telegramStub } from "./tg-stub.mjs";
const require = createRequire("/opt/npm-tools/node_modules/");
const { chromium } = require("playwright");
const { base, bot } = JSON.parse(readFileSync(new URL("./ui-run/ready", import.meta.url)));
const out = process.argv[2] ?? "/tmp";
const b = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const errors = [];
const ok = [];
const check = (name, cond) => { (cond ? ok : errors).push(name); console.log(`${cond ? "✔" : "✘"} ${name}`); };
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
// Telegram in DARK mode: the page should still be Paper light by default.
await ctx.addInitScript(telegramStub({ initData: signInitData(bot, { id: 111, first_name: "Sabbir" }), dark: true }));
const p = await ctx.newPage();
p.on("pageerror", (e) => errors.push(e.message));
p.on("console", (m) => m.type() === "error" && errors.push(m.text()));
const shot = (n) => p.screenshot({ path: `${out}/tg2-${n}.png` });
const main = () => p.evaluate(() => window.Telegram.WebApp._main);
const bg = () => p.evaluate(() => getComputedStyle(document.querySelector(".tg")).backgroundColor);

await p.goto(base + "/tg"); await p.waitForTimeout(1500);
await shot("1-today");
check("Paper light even though Telegram is dark", (await bg()) === "rgb(247, 247, 245)");
check("Telegram header painted Paper", (await p.evaluate(() => window.Telegram.WebApp.chrome.header)) === "#f7f7f5");
check("main button is the Paper accent", (await main()).color === "#2f6feb");

// New task with suggestions
await p.click("#__tg_main"); await p.waitForTimeout(400);
await shot("2-add-empty");
await p.keyboard.type("Replace UPS battery @"); await p.waitForTimeout(300);
await shot("3-suggest-dates");
check("@ shows date suggestions", await p.getByRole("option", { name: /Tomorrow/ }).isVisible());
await p.getByRole("option", { name: /Tomorrow/ }).click(); await p.waitForTimeout(150);
await p.keyboard.type("18"); await p.waitForTimeout(250);
check("18 suggests 18:00", await p.getByRole("option", { name: /18:00/ }).isVisible());
await p.getByRole("option", { name: /18:00/ }).click();
await p.keyboard.type("!"); await p.waitForTimeout(250);
await p.getByRole("option", { name: /Urgent/ }).click();
await p.keyboard.type("#ho"); await p.waitForTimeout(300);
await shot("4-suggest-projects");
check("# suggests existing projects", await p.getByRole("option", { name: /Homelab/i }).first().isVisible());
await p.getByRole("option", { name: /Homelab/i }).first().click(); await p.waitForTimeout(500);
const text = await p.inputValue("#tg-add");
check(`text built from taps: "${text.trim()}"`, /^Replace UPS battery @tomorrow 18:00 !p1 #project\/homelab$/.test(text.trim()));
await shot("5-add-ready");
await p.click("#__tg_main"); await p.waitForTimeout(1200);
const tasks = await (await p.request.get(base + "/api/tasks?limit=2000")).json();
const t = tasks.filter((x) => x.title === "Replace UPS battery" && x.dueTime === "18:00").at(-1);
check("task saved with time, priority, project", !!t && t.priority === 1 && t.dueDate > new Date().toISOString().slice(0, 10) && t.tags.includes("project/homelab"));

// Projects: list → new project → open → add to it
await p.getByRole("tab", { name: "Projects" }).click(); await p.waitForTimeout(800);
await shot("6-projects");
check("main button says New project", (await main()).text === "New project");
await p.click("#__tg_main"); await p.waitForTimeout(300);
await p.keyboard.type("Garden shed"); await p.waitForTimeout(200);
await shot("7-new-project");
await p.click("#__tg_main"); await p.waitForTimeout(1200);
check("opened the new project", (await p.textContent("h1")) === "Garden shed");
await shot("8-project-empty");
await p.click("#__tg_main"); await p.waitForTimeout(300);
await p.keyboard.type("Buy timber @+3d"); await p.waitForTimeout(400);
await p.click("#__tg_main"); await p.waitForTimeout(1200);
check("task listed in the project", await p.getByText("Buy timber").isVisible());
const note = await (await p.request.get(base + "/api/notes/by-path?path=projects/garden-shed.md")).json();
check("task written into projects/garden-shed.md", note.content.includes("- [ ] Buy timber"));
await shot("9-project");

// Theme toggle → Paper night
await p.getByRole("tab", { name: "Today" }).click().catch(() => p.goto(base + "/tg"));
await p.waitForTimeout(600);
await p.getByRole("button", { name: /Theme/ }).click(); await p.waitForTimeout(400);
check("Paper night", (await bg()) === "rgb(22, 23, 26)");
await shot("10-today-night");
await p.reload(); await p.waitForTimeout(1500);
check("theme choice remembered", (await bg()) === "rgb(22, 23, 26)");
console.log(`\n${ok.length} ok, ${errors.length} problems`, errors);
await b.close();
