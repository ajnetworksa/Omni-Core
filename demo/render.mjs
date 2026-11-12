import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
const S = JSON.parse(readFileSync(new URL("./out/session.json", import.meta.url)));
mkdirSync(new URL("./pages/", import.meta.url), { recursive: true });
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const tgHtml = (h) => h.replace(/\n/g, "<br>"); // bot output is already Telegram-HTML (escaped by the app)
const hhmm = (ms) => new Date(ms).toLocaleTimeString("en-GB", { timeZone: "Asia/Riyadh", hour: "2-digit", minute: "2-digit" });

// ---------- Telegram timeline -------------------------------------------------
const ME = 111;
const msgs = new Map(); // message_id -> bot message state
const timeline = [];
for (const c of S.calls) {
  if (c.method === "sendMessage") {
    const st = { kind: "bot", id: c.result.message_id, chat: Number(c.payload.chat_id), at: c.at, html: c.payload.text, kb: c.payload.reply_markup?.inline_keyboard, force: c.payload.reply_markup?.force_reply };
    msgs.set(st.id, st);
    timeline.push(st);
  } else if (c.method === "editMessageText") {
    const st = msgs.get(c.payload.message_id);
    if (st) {
      if (c.payload.entities !== undefined || !c.payload.parse_mode) st.html = st.html + "\n\n" + esc(c.payload.text.split("\n\n").pop()); // appended outcome; Telegram keeps original formatting via entities
      else st.html = c.payload.text;
      st.kb = c.payload.reply_markup?.inline_keyboard; st.edited = true;
    } else timeline.push({ kind: "note", at: c.at, chat: ME, text: "✏️ reminder updated: " + esc(c.payload.text.split("\n\n").pop()) });
  } else if (c.method === "editMessageReplyMarkup") {
    timeline.push({ kind: "kbswap", at: c.at, chat: ME, kb: c.payload.reply_markup.inline_keyboard });
  } else if (c.method === "answerCallbackQuery" && c.payload.text) {
    timeline.push({ kind: "toast", at: c.at, chat: ME, text: c.payload.text });
  } else if (c.method === "setMessageReaction") {
    timeline.push({ kind: "react", at: c.at, target: c.payload.message_id, emoji: c.payload.reaction?.[0]?.emoji });
  }
}
for (const e of S.events) timeline.push(e.kind === "tap" ? { kind: "tap", at: e.at, chat: e.chat, label: e.label, messageId: e.messageId } : { ...e });
timeline.sort((a, b) => a.at - b.at);
const reactions = Object.fromEntries(timeline.filter((x) => x.kind === "react").map((x) => [x.target, x.emoji]));

const kbHtml = (kb, ghost) => kb ? `<div class="kb ${ghost ? "ghost" : ""}">${kb.map((r) => `<div class="kbrow">${r.map((b) => `<div class="kbbtn">${esc(b.text)}</div>`).join("")}</div>`).join("")}</div>` : "";
function bubble(x) {
  if (x.kind === "user") {
    const body = x.photo ? `<div class="photo"><div class="ph">📷<span>Rack photo</span></div><div>${esc(x.text)}</div></div>` : esc(x.text).replace(/\n/g, "<br>");
    const reply = x.reply_to ? `<div class="replyto">↩ reply to: Remark for Migrate VLANs</div>` : "";
    const r = reactions[x.id] ? `<span class="reaction">${reactions[x.id]}</span>` : "";
    return `<div class="row me"><div class="b me">${reply}${body}<span class="t">${hhmm(x.at)} ✓✓</span>${r}</div></div>`;
  }
  if (x.kind === "bot") return `<div class="row bot"><div class="wrap"><div class="b bot">${tgHtml(x.html)}<span class="t">${x.edited ? "edited " : ""}${hhmm(x.at)}</span></div>${x.force ? `<div class="force">↩ reply requested</div>` : ""}${kbHtml(x.kb)}</div></div>`;
  if (x.kind === "tap") return `<div class="sys tap">👆 tapped <b>${esc(x.label)}</b></div>`;
  if (x.kind === "toast") return `<div class="sys toast">${esc(x.text)}</div>`;
  if (x.kind === "kbswap") return `<div class="row bot"><div class="wrap"><div class="kbnote">keyboard switched to:</div>${kbHtml(x.kb, true)}</div></div>`;
  if (x.kind === "note") return `<div class="sys">${x.text}</div>`;
  return "";
}
const cut = (pred) => timeline.filter((x) => x.kind !== "react" && pred(x));
const firstReminderAt = timeline.find((x) => x.kind === "bot" && /Still in progress|Blocked|Overdue/.test(x.html))?.at ?? Infinity;
const todayAt = S.events.find((e) => e.text === "/today")?.at ?? Infinity;
const scenes = [
  ["tg-1-capture", "Capture: /start · /todo · + quick task · log · photo · /note", (x) => x.chat === ME && x.at < firstReminderAt],
  ["tg-2-reminders", "Nag engine: reminders + one-tap actions + remark by reply", (x) => x.chat === ME && x.at >= firstReminderAt && x.at < todayAt],
  ["tg-3-review", "Review: /today (one-tap done) · /project · /search", (x) => x.chat === ME && x.at >= todayAt],
  ["tg-4-stranger", "Security: a stranger messages the bot", (x) => x.chat === 999],
];
const tgCss = `
body{margin:0;background:#0e1621;font:15px/1.38 -apple-system,"Segoe UI",Roboto,"Noto Color Emoji",sans-serif;color:#f5f5f5}
.phone{width:440px;margin:0 auto;background:#0e1621 url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='40'%3E%3Ccircle cx='20' cy='20' r='1.2' fill='%231c2a3a'/%3E%3C/svg%3E")}
.top{position:sticky;top:0;display:flex;gap:12px;align-items:center;padding:10px 14px;background:#17212b;border-bottom:1px solid #0b1118}
.av{width:40px;height:40px;border-radius:50%;background:linear-gradient(135deg,#6ab3f3,#3a7bd5);display:grid;place-items:center;font-weight:700}
.nm{font-weight:600}.st{font-size:13px;color:#6c7883}.cap{font-size:12px;color:#8aa0b5;padding:8px 14px;background:#131c26;border-bottom:1px solid #0b1118}
.chat{padding:10px 10px 18px;display:flex;flex-direction:column;gap:6px}
.row{display:flex}.row.me{justify-content:flex-end}.wrap{max-width:86%}
.b{position:relative;padding:7px 10px 18px;border-radius:12px;max-width:86%;word-wrap:break-word;white-space:normal}
.b.me{background:#2b5278;border-bottom-right-radius:4px}.b.bot{background:#182533;border-bottom-left-radius:4px;max-width:100%}
.b code{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;color:#7fd1ff;background:#0f1a24;padding:0 3px;border-radius:4px}
.b i{color:#c9d6e2}.t{position:absolute;right:8px;bottom:3px;font-size:11px;color:#7d8b99}
.kb{display:flex;flex-direction:column;gap:4px;margin-top:4px}.kbrow{display:flex;gap:4px}
.kbbtn{flex:1;text-align:center;padding:8px 4px;border-radius:8px;background:rgba(36,52,70,.92);font-size:13.5px;color:#fff}
.kb.ghost .kbbtn{background:rgba(36,52,70,.6);outline:1px dashed #3d5a78}.kbnote{font-size:11px;color:#7d8b99;margin:2px 0}
.sys{align-self:center;font-size:12.5px;background:rgba(0,0,0,.35);color:#cfd8e3;padding:4px 10px;border-radius:12px}
.sys.toast{background:#253447;color:#fff;border:1px solid #33465c}.sys.tap{background:transparent;color:#8aa0b5}
.photo .ph{width:240px;height:150px;border-radius:8px;background:linear-gradient(135deg,#3a4a5c,#24313f);display:grid;place-items:center;font-size:34px;margin-bottom:4px}
.photo .ph span{display:block;font-size:12px;color:#9fb2c6}.replyto{font-size:12px;color:#8fc1ee;border-left:2px solid #6ab3f3;padding-left:6px;margin-bottom:4px}
.force{font-size:11px;color:#7d8b99;margin-top:2px}.reaction{position:absolute;left:-14px;bottom:-8px;background:#17212b;border-radius:10px;padding:1px 4px;font-size:13px}
.foot{font-size:11px;color:#55677a;text-align:center;padding:8px 0 14px}`;
for (const [file, title, pred] of scenes) {
  const items = cut(pred).map(bubble).join("\n");
  const stranger = file === "tg-4-stranger";
  writeFileSync(new URL(`./pages/${file}.html`, import.meta.url), `<!doctype html><meta charset=utf-8><style>${tgCss}</style>
<div class="phone"><div class="top"><div class="av">OC</div><div><div class="nm">OmniCore</div><div class="st">bot · @omnicore_bot${stranger ? " · seen by user 999 (not allow-listed)" : ""}</div></div></div>
<div class="cap">${esc(title)}</div><div class="chat">${items}</div>
<div class="foot">Rendered from the bot's actual Bot-API calls (live server, mock Telegram) · ${S.today}</div></div>`);
}

// ---------- Obsidian-style vault notes ---------------------------------------
function md(src) {
  const lines = src.replace(/\r/g, "").split("\n");
  let i = 0, out = [], fm = [];
  if (lines[0] === "---") { i = 1; while (i < lines.length && lines[i] !== "---") fm.push(lines[i++]); i++; }
  if (fm.length) out.push(`<div class="props"><div class="ph">Properties</div>${fm.map((l) => { const [k, ...v] = l.split(":"); return `<div class="prop"><span class="k">${esc(k)}</span><span class="v">${esc(v.join(":").trim())}</span></div>`; }).join("")}</div>`);
  let fence = false;
  const inline = (s) => esc(s)
    .replace(/\^(oc-[a-z0-9]+)/g, '<span class="anchor">^$1</span>')
    .replace(/!\[\[(.+?)\]\]/g, '<span class="embed">🖼 $1</span>')
    .replace(/\[\[(.+?)\]\]/g, '<span class="wl">$1</span>')
    .replace(/(^|\s)(#[\p{L}\p{N}_/-]+)/gu, '$1<span class="tag">$2</span>')
    .replace(/(📅|🔁|✅)/g, '<span class="sig">$1</span>')
    .replace(/(!p[1-4])/g, '<span class="pri">$1</span>');
  for (; i < lines.length; i++) {
    const l = lines[i];
    if (/^```/.test(l)) { fence = !fence; out.push(fence ? '<pre class="code">' : "</pre>"); continue; }
    if (fence) { out.push(esc(l) + "\n"); continue; }
    let m;
    if ((m = l.match(/^(#{1,6})\s+(.*)/))) { out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`); continue; }
    if ((m = l.match(/^(\s*)[-*+]\s+\[(.)\]\s+(.*)$/))) {
      const ch = m[2], cls = { " ": "open", x: "done", X: "done", "/": "half", "!": "blocked", "-": "cancel" }[ch] ?? "done";
      out.push(`<div class="task ${cls}" style="margin-left:${m[1].length * 11}px"><span class="cb">${{ done: "✓", half: "◐", blocked: "!", cancel: "–", open: "" }[cls]}</span><span class="tt">${inline(m[3])}</span></div>`); continue;
    }
    if ((m = l.match(/^(\s*)- (.*)$/))) { out.push(`<div class="li" style="margin-left:${m[1].length * 11}px">• ${inline(m[2])}</div>`); continue; }
    out.push(l.trim() ? `<p>${inline(l)}</p>` : "");
  }
  return out.join("\n");
}
const obsCss = `body{margin:0;background:#1e1e1e;font:15px/1.55 Inter,-apple-system,"Segoe UI",Roboto,"Noto Color Emoji",sans-serif;color:#dcddde}
.win{width:860px;margin:0 auto;display:grid;grid-template-columns:220px 1fr;min-height:100vh}.side{background:#262626;border-right:1px solid #333;padding:14px 10px;font-size:13px;color:#999}
.side b{color:#ccc;display:block;margin:8px 0 4px}.side .f{padding:3px 8px;border-radius:4px}.side .f.on{background:#3a3a3a;color:#fff}
.main{padding:8px 34px 40px}.tab{font-size:13px;color:#aaa;border-bottom:1px solid #333;padding:8px 0;margin-bottom:12px}
h1{font-size:26px;margin:.4em 0}h2{font-size:20px;margin:1em 0 .3em;color:#e8e8e8}h3{font-size:16px;color:#ccc}
p{margin:.35em 0}.props{background:#252525;border:1px solid #333;border-radius:6px;padding:8px 12px;margin:6px 0 14px;font-size:13px}.ph{color:#888;font-size:12px;margin-bottom:4px}
.prop{display:flex;gap:18px}.k{width:90px;color:#999}.v{color:#ddd}.task{display:flex;gap:9px;align-items:flex-start;margin:3px 0}
.cb{flex:none;width:15px;height:15px;margin-top:4px;border:1.5px solid #777;border-radius:3px;display:grid;place-items:center;font-size:11px;font-weight:700}
.done .cb{background:#7f6df2;border-color:#7f6df2;color:#fff}.done .tt{color:#888;text-decoration:line-through}.half .cb{border-color:#e0a83c;color:#e0a83c}
.blocked .cb{border-color:#e05252;color:#e05252}.cancel .tt{text-decoration:line-through;color:#777}.cancel .cb{color:#777}
.wl{color:#a88bfa}.tag{color:#a88bfa;background:#2d2640;border-radius:10px;padding:0 6px;font-size:13px}.anchor{color:#555;font-size:12px}
.pri{color:#e0a83c;font-size:13px}.embed{color:#7aa2f7;background:#1f2a3d;border-radius:4px;padding:0 5px;font-size:13px}.li{margin:2px 0}
pre.code{background:#262626;border-radius:6px;padding:8px 12px;font:13px ui-monospace,Menlo,Consolas,monospace;color:#bbb;white-space:pre-wrap}
.foot{font-size:11px;color:#666;margin-top:18px}`;
const fileList = Object.keys(S.vault);
for (const [rel, src] of Object.entries(S.vault)) {
  const slug = "vault-" + rel.replace(/[^a-z0-9]+/gi, "-").replace(/-md$/, "");
  writeFileSync(new URL(`./pages/${slug}.html`, import.meta.url), `<!doctype html><meta charset=utf-8><style>${obsCss}</style><div class="win"><div class="side"><b>vault</b>${["daily/", "inbox/", "projects/", "attachments/"].map((d) => `<div class="f">📁 ${d}</div>${fileList.filter((f) => f.startsWith(d)).map((f) => `<div class="f ${f === rel ? "on" : ""}" style="padding-left:22px">📄 ${esc(f.slice(d.length))}</div>`).join("")}${d === "attachments/" ? S.attachments.filter((a) => /\./.test(a)).map((a) => `<div class="f" style="padding-left:22px">🖼 ${esc(String(a).split("/").pop())}</div>`).join("") : ""}`).join("")}</div>
<div class="main"><div class="tab">📄 ${esc(rel)}</div>${md(src)}<div class="foot">Actual file contents written by OmniCore (rendered Obsidian-style) · ${S.today}</div></div></div>`);
}

// ---------- API / security cards ---------------------------------------------
const trim = (v, d = 0) => Array.isArray(v) ? (v.length > 3 && d === 0 ? [...v.slice(0, 3).map((x) => trim(x, d + 1)), `… ${v.length - 3} more`] : v.map((x) => trim(x, d + 1))) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, typeof x === "string" && x.length > 90 ? x.slice(0, 87) + "…" : trim(x, d + 1)])) : v;
const jsonHtml = (v) => esc(JSON.stringify(trim(v), null, 2)).replace(/&quot;([^&]+?)&quot;:/g, '<span class="key">"$1"</span>:').replace(/: &quot;(.*?)&quot;/g, ': <span class="str">"$1"</span>').replace(/: (\d+|true|false|null)/g, ': <span class="num">$1</span>');
const card = (x) => `<div class="card"><div class="req"><span class="m">${x.method}</span> <span class="p">${esc(x.path)}</span><span class="lbl">${esc(x.label)}</span><span class="s s${String(x.status)[0]}">${x.status}</span></div>${x.headers && Object.keys(x.headers).length ? `<div class="hd">${Object.entries(x.headers).map(([k, v]) => `<div><span>${esc(k)}:</span> ${esc(v)}</div>`).join("")}</div>` : ""}<pre>${jsonHtml(x.body)}</pre></div>`;
const apiCss = `body{margin:0;background:#0d1117;font:14px -apple-system,"Segoe UI",Roboto,sans-serif;color:#c9d1d9}.wrap{width:900px;margin:0 auto;padding:18px}
h1{font-size:18px;margin:4px 0 14px}.sub{color:#8b949e;font-size:13px;margin:-8px 0 14px}.card{background:#161b22;border:1px solid #30363d;border-radius:8px;margin-bottom:12px;overflow:hidden}
.req{display:flex;gap:10px;align-items:center;padding:9px 12px;border-bottom:1px solid #30363d;font-family:ui-monospace,Menlo,Consolas,monospace}.m{color:#d2a8ff;font-weight:700}.p{color:#79c0ff}
.lbl{margin-left:auto;color:#8b949e;font-family:-apple-system,Segoe UI,sans-serif;font-size:12.5px}.s{padding:2px 8px;border-radius:10px;font-weight:700;font-size:12px}
.s2{background:#1f6f3c;color:#aff5c3}.s4{background:#6e2b2b;color:#ffb4b4}.s5{background:#7a5b00}.hd{padding:6px 12px;border-bottom:1px solid #30363d;font:12px ui-monospace,Menlo,Consolas,monospace;color:#8b949e}.hd span{color:#d2a8ff}
pre{margin:0;padding:10px 12px;font:12.5px/1.45 ui-monospace,Menlo,Consolas,monospace;white-space:pre-wrap;max-height:380px;overflow:hidden}.key{color:#7ee787}.str{color:#a5d6ff}.num{color:#ffa657}`;
writeFileSync(new URL("./pages/api.html", import.meta.url), `<!doctype html><meta charset=utf-8><style>${apiCss}</style><div class="wrap"><h1>OmniCore REST API: live responses (Bearer token)</h1><div class="sub">Long arrays trimmed to 3 items · captured ${S.today}</div>${S.apiShots.map(card).join("")}</div>`);
writeFileSync(new URL("./pages/security.html", import.meta.url), `<!doctype html><meta charset=utf-8><style>${apiCss}</style><div class="wrap"><h1>Security probes against the live server</h1><div class="sub">Each request sent to the running app · captured ${S.today}</div>${S.secShots.map(card).join("")}</div>`);

// ---------- terminal pages ------------------------------------------------------
const term = (title, txt) => `<!doctype html><meta charset=utf-8><style>body{margin:0;background:#0c0c0c}.t{width:980px;margin:0 auto;background:#111;border:1px solid #333;border-radius:8px;overflow:hidden;font:12.5px/1.5 ui-monospace,"Cascadia Mono",Menlo,Consolas,monospace;color:#ccc}
.bar{background:#222;padding:6px 10px;color:#aaa;font:12px -apple-system,Segoe UI,sans-serif}.bar i{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:5px;background:#555}
pre{margin:0;padding:10px 14px;white-space:pre-wrap}.ok{color:#4ec97b}.bad{color:#f16b6b}.h{color:#e5c07b;font-weight:700}.dim{color:#777}.sum{color:#fff;font-weight:700}</style>
<div class="t"><div class="bar"><i></i><i></i><i></i> ${esc(title)}</div><pre>${esc(txt.replace(/\x1b\[[0-9;]*m/g, ""))
  .replace(/^(\s*(?:✓|✔).*)$/gm, '<span class="ok">$1</span>').replace(/^(\s*(?:✘|×).*)$/gm, '<span class="bad">$1</span>')
  .replace(/^(## .*)$/gm, '<span class="h">$1</span>').replace(/^(.*(?:passed|Tests ).*)$/gm, '<span class="sum">$1</span>')}</pre></div>`;
const rd = (f) => readFileSync(new URL(`./out/${f}`, import.meta.url), "utf8");
const unit = rd("unit-core.txt").split("\n").filter((l) => /✓|×|Test Files|Tests |Duration/.test(l)).map((l) => l.replace(/\s+\d+ms$/, "")).join("\n");
writeFileSync(new URL("./pages/term-unit.html", import.meta.url), term("npm test: packages/core (vitest)", unit + "\n\n" + rd("unit-bot.txt").split("\n").filter((l) => /✓|×|Tests /.test(l)).map((l) => l.replace(/\s+\d+ms$/, "")).join("\n")));
writeFileSync(new URL("./pages/term-e2e.html", import.meta.url), term("npm run test:e2e", rd("e2e.txt")));
writeFileSync(new URL("./pages/term-security.html", import.meta.url), term("npm run test:security", rd("security.txt")));
console.log("pages written");
