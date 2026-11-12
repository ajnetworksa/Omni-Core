// Mock local AI server for tests: OpenAI-compatible /v1/embeddings, /v1/chat/completions,
// /v1/audio/transcriptions, plus Anthropic's /v1/messages (for cloud-fallback tests).
//
// Embeddings are a deterministic bag of words (with a few synonyms), so "semantic" search
// behaves predictably. Chat replies are scripted from the system prompt. Some replies are
// deliberately hostile (checkboxes, anchors, headings, newlines) to test our sanitising.
//
//   node tests/lib/mock-ai.mjs [port]      or import { startMockAi } from "./mock-ai.mjs"
import { createHash } from "node:crypto";
import { createServer } from "node:http";

const DIMS = 256;
const SYN = {
  switches: "switch", psu: "power", supply: "power", ups: "power", battery: "power",
  vlans: "vlan", isp: "internet", outage: "internet", wan: "internet",
  configuration: "config", configure: "config", configs: "config", firmware: "config",
  backups: "backup", nas: "backup", homepage: "website", copy: "website",
};
const STOP = new Set("a an the and or of to in on for is it at by with from this that what did i my me we be was were are about all any search_query search_document task status project note remarks".split(" "));

export function tokens(text) {
  return String(text)
    .replace(/^(search_query|search_document|query|passage): /, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .map((w) => w.replace(/(ing|ed|es|s)$/, (m, _g, i, str) => (str.length - m.length >= 3 ? "" : m)))
    .map((w) => (w.length > 4 ? w.replace(/e$/, "") : w))
    .map((w) => SYN[w] ?? w)
    .filter((w) => w.length > 1 && !STOP.has(w));
}

function hash(s, seed) {
  return createHash("sha1").update(`${seed}:${s}`).digest().readUInt32BE(0);
}

export function embed(text) {
  const v = new Array(DIMS).fill(0);
  for (const t of tokens(text)) {
    v[hash(t, 1) % DIMS] += 1;
    v[hash(t, 7) % DIMS] += hash(t, 3) % 2 ? 0.5 : -0.5;
  }
  const n = Math.sqrt(v.reduce((a, x) => a + x * x, 0)) || 1;
  return v.map((x) => x / n);
}

const overlap = (a, b) => {
  const B = new Set(tokens(b));
  return tokens(a).filter((t) => B.has(t)).length;
};

function today() {
  return new Date().toISOString().slice(0, 10);
}
function addDays(iso, n) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Demo mode (screenshots): clean replies built from the real sources and facts in the prompt. */
function demoReply(system, user) {
  const sentence = (t) => (t.replace(/\s+/g, " ").match(/[^.!?]+[.!?]/)?.[0] ?? t).trim();
  if (/answer questions about the user's own notes/.test(system)) {
    const q = user.match(/Question: (.*)/)?.[1] ?? "";
    const sources = [...user.matchAll(/<source n="(\d+)"[^>]*>\n([\s\S]*?)\n<\/source>/g)].map((m) => ({ n: Number(m[1]), text: m[2] }));
    const ranked = sources.map((s) => ({ ...s, o: overlap(q, s.text) })).sort((a, b) => b.o - a.o);
    const a = ranked[0];
    const b = ranked.slice(1).find((s) => s.o > 0 && !s.text.startsWith("Task:"));
    const body = (s) => s.text.split("\n").slice(1).join(" ");
    return `${sentence(body(a))} [${a.n}]${b ? ` ${sentence(body(b))} [${b.n}]` : ""}`;
  }
  if (/Break a task into/.test(system)) {
    const title = user.match(/<task>([\s\S]*?)<\/task>/)?.[1] ?? "";
    if (/switch/i.test(title)) return JSON.stringify({ subtasks: ["Back up the running config", "Label cables and note the port map", "Rack and power up the SG350", "Restore VLANs and trunk ports", "Test uplinks and access points"] });
    return JSON.stringify({ subtasks: [`List what ${title.toLowerCase()} needs`, "Block an hour in the calendar", "Do the first half", "Check the result", "Note anything left over"] });
  }
  if (/morning standup|end-of-day retro/.test(system)) {
    const grab = (h) => (user.match(new RegExp(`${h}[^\n]*:\n((?:- .*\n?)*)`))?.[1] ?? "").split("\n").filter((l) => l.startsWith("- ") && !l.includes("(none)")).map((l) => l.slice(2).replace(/ \[.*?\]/g, ""));
    const done = grab(/standup/.test(system) ? "Done yesterday" : "Done today");
    const open = grab("Open for today");
    const blocked = grab("Blockers / remarks");
    const lines = [];
    lines.push(done.length ? `${/standup/.test(system) ? "Yesterday you closed" : "Today you closed"} ${done.slice(0, 2).join(" and ")}.` : "Nothing was marked done yesterday.");
    if (open.length) lines.push(`Focus: ${open.slice(0, 2).join(", then ")}.`);
    if (blocked.length) lines.push(`Still waiting: ${blocked[0].replace(/:\s*/, " — ")}.`);
    if (open.length > 2) lines.push(`${open.length - 2} more after that; Telegram will keep nudging.`);
    return lines.join("\n");
  }
  if (/turn a photo into a short markdown note/.test(system)) {
    return JSON.stringify({ title: "Switch rear label", markdown: "- Model: Cisco SG350-28P\n- Serial: PSZ2219A0KX\n- PoE budget: 195 W\n- MAC: 70:1F:53:0A:4C:11" });
  }
  return null;
}

function reply(system, user, state) {
  if (state.demo) {
    const d = demoReply(system, user);
    if (d) return d;
  }
  if (/Break a task into/.test(system)) {
    const title = user.match(/<task>([\s\S]*?)<\/task>/)?.[1] ?? "the task";
    if (/EVIL/.test(title)) {
      return JSON.stringify({
        subtasks: ["- [ ] Step one ^oc-hacked1", "Step two\n- [x] injected line", "## Heading", "1. Numbered 📅 2030-01-01 !p1", "", "Step one ^oc-hacked1"],
      });
    }
    const short = title.split(/\s+/).slice(0, 4).join(" ");
    return "Sure! ```json\n" + JSON.stringify({ subtasks: [`Check what's needed for ${short}`, `Order parts for ${short}`, `Schedule a time to ${short.toLowerCase()}`, `Do it and test`, `Write down what changed`] }) + "\n```";
  }
  if (/voice-note transcript/.test(system)) {
    const t = user.match(/<transcript>([\s\S]*?)<\/transcript>/)?.[1] ?? "";
    const tasks = [];
    for (const sent of t.split(/(?<=[.!?])\s+/)) {
      const m = sent.match(/\b(?:remember to|need to|have to|don't forget to)\s+(.+?)[.!?]?$/i);
      if (!m) continue;
      let title = m[1].replace(/,?\s*(?:it's|it is)\s+urgent/i, "").replace(/\s+tomorrow\b/i, "").trim();
      title = title.charAt(0).toUpperCase() + title.slice(1);
      const task = { title };
      if (/tomorrow/i.test(sent)) task.due = addDays(today(), 1);
      if (/urgent/i.test(sent)) task.priority = 1;
      if (/psu|switch|vlan|nas/i.test(sent)) task.project = "homelab";
      if (/made-up/i.test(sent)) task.project = "not-a-project";
      tasks.push(task);
    }
    return JSON.stringify({ summary: tasks.length ? `You mentioned ${tasks.length} things to do.` : "Just thinking out loud.", tasks });
  }
  if (/answer questions about the user's own notes/.test(system)) {
    const q = user.match(/Question: (.*)/)?.[1] ?? "";
    const sources = [...user.matchAll(/<source n="(\d+)"[^>]*>\n([\s\S]*?)\n<\/source>/g)].map((m) => ({ n: Number(m[1]), text: m[2] }));
    if (!sources.length) return "I couldn't find that in your notes.";
    const best = sources.map((s) => ({ ...s, o: overlap(q, s.text) })).sort((a, b) => b.o - a.o)[0];
    const body = best.text.split("\n").slice(1).join(" ").replace(/\s+/g, " ").trim();
    const second = sources.find((s) => s.n !== best.n);
    return `From your notes: ${body.slice(0, 160)} [${best.n}]${second ? ` See also [${second.n}].` : ""} <b>not html</b>`;
  }
  if (/turn a photo into a short markdown note/.test(system)) {
    return JSON.stringify({ title: "Switch rear label", markdown: "- Model: SG350-28P\n- Serial: PSZ2219A0KX\n- [ ] sneaky checkbox ^oc-photo01\n---\n- PoE budget: 195 W" });
  }
  if (/morning standup|end-of-day retro/.test(system)) {
    const kind = /standup/.test(system) ? "Standup" : "Retro";
    return `## ${kind}\nYou wrapped up a few things; the core switch is the big one today.\n- [ ] Fake task from the model ^oc-model01\n\n\nKeep the VLAN migration moving once ops approves.`;
  }
  if (/nudging the user/.test(system)) {
    state.nags++;
    return `"Five minutes on this now saves an hour later (${state.nags})."`;
  }
  return "OK.";
}

export async function startMockAi({ port = 0, transcript, demo = false } = {}) {
  const state = { calls: [], nags: 0, fail: false, delayMs: 0, demo };
  const ollamaModels = new Set(process.env.MOCK_NO_MODELS ? [] : ["llama3.2:3b", "nomic-embed-text:latest"]);
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks);
    const send = (code, body) => {
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    const url = new URL(req.url, "http://x");
    if (url.pathname === "/__state") return send(200, { calls: state.calls, nags: state.nags });
    if (url.pathname === "/__fail") {
      state.fail = url.searchParams.get("on") === "1";
      return send(200, { fail: state.fail });
    }
    if (url.pathname === "/__delay") {
      state.delayMs = Number(url.searchParams.get("ms") ?? 0);
      return send(200, { delayMs: state.delayMs });
    }
    if (url.pathname === "/__reset") {
      state.calls = [];
      return send(200, {});
    }
    // Stand-in for Telegram's file download endpoint in bot tests.
    if (url.pathname.startsWith("/file/")) {
      res.writeHead(200, { "content-type": "application/octet-stream" });
      return res.end(url.pathname.endsWith(".jpg") ? Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]) : Buffer.from(`OggS fake audio TRANSCRIPT:${state.voiceText ?? ""}`));
    }
    if (url.pathname === "/__voice") {
      state.voiceText = url.searchParams.get("text") ?? undefined;
      return send(200, {});
    }
    if (state.delayMs) await new Promise((r) => setTimeout(r, state.delayMs));
    const isCloud = url.pathname === "/v1/messages";
    // "Down" means the model server (chat, embeddings, model list); speech-to-text is a separate service.
    if (state.fail && !isCloud && url.pathname !== "/v1/audio/transcriptions") return send(503, { error: "model server down" });

    // Ollama's native model list / download (auto-pull). MOCK_NO_MODELS=1 starts empty.
    if (url.pathname === "/api/tags") return send(200, { models: [...ollamaModels].map((name) => ({ name })) });
    if (url.pathname === "/api/pull") {
      const { model } = JSON.parse(raw.toString() || "{}");
      ollamaModels.add(model.includes(":") ? model : `${model}:latest`);
      return send(200, { status: "success" });
    }
    if (url.pathname === "/v1/models") return send(200, { object: "list", data: [{ id: "llama3.2:3b" }, { id: "nomic-embed-text" }] });
    if (url.pathname === "/v1/embeddings") {
      const body = JSON.parse(raw.toString());
      const input = Array.isArray(body.input) ? body.input : [body.input];
      state.calls.push({ kind: "embed", n: input.length, model: body.model });
      if (body.model === "missing-model") return send(404, { error: `model "${body.model}" not found, try pulling it first` });
      return send(200, { object: "list", data: input.map((t, i) => ({ object: "embedding", index: i, embedding: embed(t) })), model: body.model });
    }
    if (url.pathname === "/v1/chat/completions" || isCloud) {
      const body = JSON.parse(raw.toString());
      const system = isCloud ? body.system ?? "" : (body.messages.find((m) => m.role === "system")?.content ?? "");
      const userMsg = [...body.messages].reverse().find((m) => m.role === "user");
      const userText = typeof userMsg.content === "string" ? userMsg.content : userMsg.content.filter((c) => c.type === "text").map((c) => c.text).join("\n");
      const hasImage = typeof userMsg.content !== "string" && userMsg.content.some((c) => c.type === "image_url" || c.type === "image");
      state.calls.push({ kind: isCloud ? "cloud-chat" : "chat", model: body.model, system: system.slice(0, 60), hasImage, auth: req.headers["x-api-key"] ? "x-api-key" : req.headers.authorization ? "bearer" : "none" });
      let text = reply(system, userText, state);
      if (isCloud) {
        const prefill = body.messages.at(-1)?.role === "assistant" ? body.messages.at(-1).content[0].text : "";
        if (prefill && text.startsWith(prefill)) text = text.slice(prefill.length);
        else if (prefill === "{") text = text.slice(text.indexOf("{") + 1);
        return send(200, { id: "msg_mock", type: "message", role: "assistant", model: body.model, content: [{ type: "text", text }] });
      }
      return send(200, { id: "chatcmpl-mock", object: "chat.completion", model: body.model, choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }] });
    }
    if (url.pathname === "/v1/audio/transcriptions") {
      const s = raw.toString("latin1");
      state.calls.push({ kind: "stt", bytes: raw.length, model: s.match(/name="model"\r\n\r\n([^\r]*)/)?.[1] });
      const fromFile = s.match(/TRANSCRIPT:([^\r\n\u0000]+)/)?.[1];
      return send(200, { text: fromFile ?? transcript ?? "Remember to order a spare PSU tomorrow, it's urgent. I also need to call the ISP about the outage. The weather was nice today." });
    }
    send(404, { error: "not found" });
  });
  await new Promise((r) => server.listen(port, process.env.MOCK_HOST ?? "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}`;
  return { url, state, close: () => new Promise((r) => server.close(r)) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const m = await startMockAi({ port: Number(process.argv[2] ?? 11435) });
  console.log(`mock AI on ${m.url}`);
}
