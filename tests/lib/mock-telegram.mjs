// Minimal Telegram Bot API double: enough for grammY long polling, messages, callbacks and files.
// The app under test is pointed at it via TELEGRAM_API_ROOT, so the real bot code runs unmodified.
import { createServer } from "node:http";

// 1x1 PNG
export const PNG = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000" +
  "1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082", "hex");

export function startMockTelegram({ port, token, botUsername = "omnicore_test_bot" }) {
  const calls = [];
  const queue = [];
  const waiters = [];
  const files = new Map(); // file_id -> { path, bytes }
  let updateId = 1;
  let messageId = 5000;

  const readBody = (req) =>
    new Promise((resolve) => {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        try {
          resolve(raw ? JSON.parse(raw) : {});
        } catch {
          resolve(Object.fromEntries(new URLSearchParams(raw)));
        }
      });
    });

  const ok = (res, result) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, result }));
  };
  const fail = (res, code, description) => {
    res.writeHead(code, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false, error_code: code, description }));
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    const fileMatch = url.pathname.match(/^\/file\/bot([^/]+)\/(.+)$/);
    if (fileMatch) {
      if (fileMatch[1] !== token) return fail(res, 401, "Unauthorized");
      const f = [...files.values()].find((x) => x.path === fileMatch[2] || x.path === decodeURIComponent(fileMatch[2]));
      if (!f) return fail(res, 404, "Not Found");
      res.writeHead(200, { "content-type": "application/octet-stream" });
      return res.end(f.bytes);
    }
    const m = url.pathname.match(/^\/bot([^/]+)\/(\w+)$/);
    if (!m) return fail(res, 404, "Not Found");
    if (m[1] !== token) return fail(res, 401, "Unauthorized");
    const method = m[2];
    const payload = await readBody(req);

    if (method === "getUpdates") {
      const offset = Number(payload.offset ?? 0);
      for (let i = queue.length - 1; i >= 0; i--) if (queue[i].update_id < offset) queue.splice(i, 1);
      if (!queue.length) await new Promise((r) => setTimeout(r, 300));
      return ok(res, queue.filter((u) => u.update_id >= offset));
    }
    const call = { method, payload, at: Date.now() };
    calls.push(call);
    let result = true;
    switch (method) {
      case "getMe":
        result = { id: 4242, is_bot: true, first_name: "OmniCore Test", username: botUsername, can_join_groups: false, can_read_all_group_messages: false, supports_inline_queries: false };
        break;
      case "sendMessage":
        result = { message_id: ++messageId, date: Math.floor(Date.now() / 1000), chat: { id: Number(payload.chat_id), type: "private" }, text: payload.text };
        break;
      case "getFile": {
        const f = files.get(payload.file_id);
        if (!f) return fail(res, 400, "Bad Request: invalid file_id");
        result = { file_id: payload.file_id, file_unique_id: payload.file_id, file_size: f.bytes.length, file_path: f.path };
        break;
      }
    }
    call.result = result;
    for (const w of [...waiters]) if (w.test(call)) w.resolve(call);
    ok(res, result);
  });

  const api = {
    calls,
    url: `http://127.0.0.1:${port}`,
    addFile(fileId, path, bytes = PNG) {
      files.set(fileId, { path, bytes });
    },
    inject(update) {
      const u = { update_id: updateId++, ...update };
      queue.push(u);
      return u;
    },
    nextMessageId: () => ++messageId,
    /** Index into `calls`; pass to waitFor to only match calls made after this point. */
    mark: () => calls.length,
    /** Resolve with the first matching call at index >= `since` (default: calls made from now on). */
    waitFor(method, pred = () => true, timeoutMs = 8000, since = calls.length) {
      const existing = calls.slice(since).find((c) => c.method === method && pred(c));
      if (existing) return Promise.resolve(existing);
      return new Promise((resolve, reject) => {
        const w = {
          test: (c) => c.method === method && pred(c),
          resolve: (c) => {
            clearTimeout(t);
            waiters.splice(waiters.indexOf(w), 1);
            resolve(c);
          },
        };
        const t = setTimeout(() => {
          waiters.splice(waiters.indexOf(w), 1);
          reject(new Error(`timeout waiting for ${method}`));
        }, timeoutMs);
        waiters.push(w);
      });
    },
    close: () => new Promise((r) => server.close(r)),
  };
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(api)));
}

// --- update builders -------------------------------------------------------
const chat = (id) => ({ id, type: "private", first_name: "Tester" });
const user = (id) => ({ id, is_bot: false, first_name: "Tester", username: `user${id}` });

export function textUpdate(tg, from, text, extra = {}) {
  const cmd = text.match(/^\/\w+/);
  return {
    message: {
      message_id: tg.nextMessageId(),
      date: Math.floor(Date.now() / 1000),
      chat: chat(from),
      from: user(from),
      text,
      ...(cmd && { entities: [{ type: "bot_command", offset: 0, length: cmd[0].length }] }),
      ...extra,
    },
  };
}

export function callbackUpdate(tg, from, data, message = { message_id: 1, text: "reminder" }) {
  return {
    callback_query: {
      id: String(Math.random()).slice(2),
      chat_instance: "ci",
      from: user(from),
      data,
      message: { date: Math.floor(Date.now() / 1000), chat: chat(from), ...message },
    },
  };
}

export function mediaUpdate(tg, from, kind, fileId, caption) {
  const media =
    kind === "photo"
      ? { photo: [{ file_id: `${fileId}_s`, file_unique_id: "s", width: 1, height: 1 }, { file_id: fileId, file_unique_id: fileId, width: 1, height: 1, file_size: 67 }] }
      : kind === "voice"
        ? { voice: { file_id: fileId, file_unique_id: fileId, duration: 2, file_size: 67 } }
        : { document: { file_id: fileId, file_unique_id: fileId, file_name: "spec.pdf", file_size: 67 } };
  return { message: { message_id: tg.nextMessageId(), date: Math.floor(Date.now() / 1000), chat: chat(from), from: user(from), ...(caption && { caption }), ...media } };
}
