// Screenshots of the Phase 4 AI UI: node demo/peek-ai.mjs (after demo/ui-session.mjs is READY)
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const require = createRequire("/opt/npm-tools/node_modules/");
const { chromium } = require("playwright");
const { base, token } = JSON.parse(readFileSync(new URL("./ui-run/ready", import.meta.url)));
const out = process.argv[2] ?? "/tmp";
const b = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const ctx = await b.newContext({ viewport: { width: 1360, height: 860 }, deviceScaleFactor: 1.5 });
const p = await ctx.newPage();
const errors = [];
p.on("pageerror", (e) => errors.push(e.message));
p.on("console", (m) => m.type() === "error" && errors.push(m.text()));
await p.request.post(base + "/api/session", { data: { token } });
const shot = async (name, wait = 700) => { await p.waitForTimeout(wait); await p.screenshot({ path: `${out}/ai-${name}.png` }); };

// 1. Ask
await p.goto(base + "/");
await p.getByText("Search or ask").waitFor({ timeout: 8000 }); // AI status loaded
await p.getByText("Search or ask").click();
await p.locator("#palette").waitFor();
await p.keyboard.press("Tab");
await p.keyboard.type("why did we decide to replace the core switch?");
await p.keyboard.press("Enter");
await p.getByText("Sources", { exact: false }).first().waitFor({ timeout: 8000 });
await shot("ask");
// 2. Search with related passages
await p.keyboard.press("Tab");
await p.locator("#palette").fill("");
await p.keyboard.type("firmware drops vlan");
await p.getByText("Related").first().waitFor({ timeout: 8000 });
await shot("related");
await p.keyboard.press("Escape");
// 3. Breakdown in the drawer
await p.getByRole("button", { name: /^Replace core switch/ }).first().click();
await p.getByRole("button", { name: /Suggest more subtasks|Break down/ }).click();
await p.getByText("Suggested subtasks").waitFor({ timeout: 8000 });
await p.getByLabel("Include “Test uplinks and access points”").uncheck();
await shot("breakdown");
await p.keyboard.press("Escape");
// 4. Standup in the daily-note rail
await p.goto(base + "/"); await p.waitForTimeout(700);
await p.getByRole("button", { name: /Write (standup|today's retro)/ }).click();
await p.locator("section[aria-label=Summary] p").first().waitFor({ timeout: 8000 });
await shot("standup", 1200);
console.log("errors:", errors.length ? errors : "none");
await b.close();
