// Quick visual check: node demo/peek.mjs <path> <out.png> [w] [h] [mobile]
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const require = createRequire("/opt/npm-tools/node_modules/");
const { chromium } = require("playwright");
const [, , path, out, w = "1360", h = "860"] = process.argv;
const { base, token } = JSON.parse(readFileSync(new URL("./ui-run/ready", import.meta.url)));
const b = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const ctx = await b.newContext({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1.5 });
const p = await ctx.newPage();
const errors = [];
p.on("pageerror", (e) => errors.push(e.message));
p.on("console", (m) => m.type() === "error" && errors.push(m.text()));
await p.request.post(base + "/api/session", { data: { token } });
await p.goto(base + path);
await p.waitForTimeout(1200);
await p.screenshot({ path: out });
console.log("errors:", errors.length ? errors : "none");
await b.close();
