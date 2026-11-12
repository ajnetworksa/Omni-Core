// Renders the AI E2E run's Telegram exchanges as a chat screenshot: node demo/render-ai-chat.mjs [outDir]
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
const require = createRequire("/opt/npm-tools/node_modules/");
const { chromium } = require("playwright");
const out = process.argv[2] ?? "/tmp";
const src = new URL(process.argv[3] ?? "../tests/.run/ai-e2e/telegram.json", import.meta.url);
const run = JSON.parse(readFileSync(src));
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const hhmm = (ms) => new Date(ms).toLocaleTimeString("en-GB", { timeZone: "Asia/Riyadh", hour: "2-digit", minute: "2-digit" });

// Merge user messages and bot replies by time; apply message edits to the message they edit.
const bot = [];
const byId = new Map();
for (const c of run.bot) {
  if (c.method === "sendMessage") {
    const m = { at: c.at, html: c.payload.text, kb: c.payload.reply_markup?.inline_keyboard, id: c.result?.message_id };
    bot.push(m);
    byId.set(m.id, m);
  } else {
    // the bot edits the voice message in place after a tap: show the appended outcome on the latest voice reply
    const target = [...bot].reverse().find((m) => m.html.startsWith("🎤") && m.kb);
    if (target) { target.html += "\n\n" + esc(c.payload.text.split("\n\n").pop()); target.kb = undefined; }
  }
}
const items = [...run.user.map((u) => ({ ...u, who: "me" })), ...bot.map((b) => ({ ...b, who: "bot" }))].sort((a, b) => a.at - b.at || (a.who === "bot" ? -1 : 1));

function scene(pred) {
  // a scene = a user message matching pred and everything until the next user message (taps included)
  const i = items.findIndex((x) => x.who === "me" && pred(x));
  const out = [items[i]];
  for (const x of items.slice(i + 1)) {
    if (x.who === "me" && !x.tap) break;
    if (!x.tap) out.push(x);
  }
  return out;
}
const scenes = [
  scene((x) => x.text?.startsWith("/ask")),
  scene((x) => x.voice).slice(0, 2),
  scene((x) => x.photo),
  scene((x) => x.text === "/standup"),
];
const bubble = (x) => {
  if (x.who === "me") {
    const body = x.voice ? `<div class="voice"><span class="play">▶</span><span class="wave">${"▁▃▅▇▅▃▂▄▆▃▁▂▅▇▆▄▂".split("").map((c) => `<i>${c}</i>`).join("")}</span><span>0:06</span></div>`
      : x.photo ? `<div class="photo">📷 photo</div>${x.caption ? `<div>${esc(x.caption)}</div>` : ""}`
      : esc(x.text);
    return `<div class="row me"><div class="b me">${body}<span class="t">${hhmm(x.at)}</span></div></div>`;
  }
  const kb = x.kb ? `<div class="kb">${x.kb.map((r) => `<div class="kr">${r.map((b) => `<span>${esc(b.text)}</span>`).join("")}</div>`).join("")}</div>` : "";
  return `<div class="row"><div class="b">${x.html.replace(/\n/g, "<br>")}<span class="t">${hhmm(x.at)}</span></div>${kb}</div>`;
};
const html = `<!doctype html><meta charset="utf-8"><style>
body{margin:0;font:15px/1.38 -apple-system,"Segoe UI",Roboto,sans-serif;background:#0e1621;color:#f5f5f5}
.top{position:sticky;top:0;background:#17212b;padding:12px 16px;font-weight:600;border-bottom:1px solid #0b121a}
.top small{display:block;font-weight:400;color:#6c7883;font-size:13px}
.chat{padding:12px 10px 20px;display:flex;flex-direction:column;gap:6px;background:#0e1621}
.row{display:flex;flex-direction:column;align-items:flex-start}.row.me{align-items:flex-end}
.b{max-width:82%;background:#182533;border-radius:14px 14px 14px 4px;padding:7px 10px 6px;position:relative}
.b.me{background:#2b5278;border-radius:14px 14px 4px 14px}
.b code{font-family:ui-monospace,Menlo,monospace;font-size:13px;color:#7fc6ff}.b i{color:#c5d0da}.b b{color:#fff}
.t{float:right;margin:6px 0 -4px 10px;font-size:11px;color:#6c8aa3}
.kb{max-width:82%;width:82%;margin-top:3px}.kr{display:flex;gap:3px;margin-top:3px}
.kr span{flex:1;text-align:center;background:rgba(36,56,76,.85);border-radius:8px;padding:7px 4px;font-size:14px;font-weight:500}
.voice{display:flex;align-items:center;gap:8px}.play{width:30px;height:30px;border-radius:50%;background:#fff;color:#2b5278;display:flex;align-items:center;justify-content:center;font-size:12px}
.wave i{color:#8fb7dc;font-style:normal;letter-spacing:-1px}.photo{width:220px;height:130px;border-radius:10px;background:linear-gradient(135deg,#33475b,#1f2c3a);display:flex;align-items:center;justify-content:center;color:#9fb4c8;margin-bottom:4px}
.sep{align-self:center;background:rgba(0,0,0,.35);color:#cfd8e0;font-size:12px;border-radius:10px;padding:2px 10px;margin:6px 0}
</style><div class="top">OmniCore<small>bot</small></div><div class="chat">${scenes.map((s, i) => (i ? '<div class="sep">later</div>' : "") + s.map(bubble).join("")).join("")}</div>`;
const file = new URL("chat.html", src);
writeFileSync(file, html);
const b = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const p = await (await b.newContext({ viewport: { width: 430, height: 900 }, deviceScaleFactor: 2 })).newPage();
await p.goto(file.href);
await p.screenshot({ path: `${out}/ai-telegram.png`, fullPage: true });
await b.close();
console.log("ok");
