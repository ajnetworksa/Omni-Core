import { createRequire } from "node:module";
const require = createRequire("/opt/npm-tools/node_modules/");
const { chromium } = require("playwright");
const pages = [
  ["01-telegram-capture", "tg-1-capture", 440],
  ["02-telegram-reminders", "tg-2-reminders", 440],
  ["03-telegram-today-project-search", "tg-3-review", 440],
  ["04-telegram-stranger-blocked", "tg-4-stranger", 440],
  ["05-vault-daily-note", "vault-daily-2026-11-11", 860],
  ["06-vault-homelab-project", "vault-projects-homelab", 860],
  ["07-vault-inbox-note", "vault-inbox-rack-layout", 860],
  ["08-api-responses", "api", 900],
  ["09-security-probes", "security", 900],
  ["10-tests-unit", "term-unit", 980],
  ["11-tests-e2e", "term-e2e", 980],
  ["12-tests-security", "term-security", 980],
];
const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const ctx = await browser.newContext({ deviceScaleFactor: 2 });
const p = await ctx.newPage();
for (const [out, src, w] of pages) {
  await p.setViewportSize({ width: w, height: 900 });
  await p.goto(`file://${process.cwd()}/pages/${src}.html`);
  await p.waitForTimeout(150);
  await p.screenshot({ path: `shots/${out}.png`, fullPage: true });
  const h = await p.evaluate(() => document.documentElement.scrollHeight);
  console.log(out, w + "x" + h);
}
await browser.close();
