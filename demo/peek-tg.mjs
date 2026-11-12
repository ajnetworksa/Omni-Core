import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { signInitData } from "../apps/server/dist/auth.js";
import { telegramStub } from "./tg-stub.mjs";
const require = createRequire("/opt/npm-tools/node_modules/");
const { chromium } = require("playwright");
const { base, token, bot } = JSON.parse(readFileSync(new URL("./ui-run/ready", import.meta.url)));
const b = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const errors = [];
const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

// 1) Inside Telegram (dark theme), authenticating with signed initData, no web cookie.
for (const dark of [true, false]) {
  const ctx = await b.newContext(phone);
  await ctx.addInitScript(telegramStub({ initData: signInitData(bot, { id: 111, first_name: "Sabbir" }), dark }));
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await p.goto(base + "/tg"); await p.waitForTimeout(1500);
  await p.screenshot({ path: `/tmp/t-today-${dark ? "dark" : "light"}.png` });
  const cookie = (await ctx.cookies()).find((c) => c.name === "oc_session");
  console.log(dark ? "dark" : "light", "session cookie via initData:", !!cookie, cookie?.httpOnly, cookie?.sameSite);
  await p.getByText("Replace core switch").first().click(); await p.waitForTimeout(1200);
  await p.screenshot({ path: `/tmp/t-task-${dark ? "dark" : "light"}.png` });
  const main = await p.evaluate(() => window.Telegram.WebApp._main);
  console.log("main button on task:", main.text, main.visible);
  if (dark) {
    await p.goBack(); await p.waitForTimeout(600);
    await p.click("#__tg_main"); await p.waitForTimeout(400);
    await p.keyboard.type("Call ISP about fibre @tomorrow 10:00 !p2 #homelab"); await p.waitForTimeout(800);
    await p.screenshot({ path: `/tmp/t-add-dark.png` });
    await p.click("#__tg_main"); await p.waitForTimeout(1200);
    const created = await (await p.request.get(base + "/api/tasks?limit=2000")).json();
    console.log("created via Mini App:", created.some((t) => t.title === "Call ISP about fibre"));
    await p.getByRole("tab", { name: "Projects" }).click(); await p.waitForTimeout(900);
    await p.screenshot({ path: `/tmp/t-projects-dark.png` });
  }
  await ctx.close();
}
// 2) Forged initData is refused.
{
  const ctx = await b.newContext(phone);
  await ctx.addInitScript(telegramStub({ initData: signInitData("4242:WRONG", { id: 111 }), dark: false }));
  const p = await ctx.newPage();
  await p.goto(base + "/tg"); await p.waitForTimeout(1500);
  console.log("forged initData screen:", (await p.textContent("body")).slice(0, 80));
  await ctx.close();
}
console.log("errors:", errors.length ? errors : "none");
await b.close();
