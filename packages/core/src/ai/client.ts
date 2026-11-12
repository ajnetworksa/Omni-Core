/**
 * AI provider layer: one small interface, three backends.
 *
 * - Local (default): Ollama, or any OpenAI-compatible server (LM Studio, llama.cpp, vLLM)
 *   through /v1/chat/completions and /v1/embeddings.
 * - Cloud (opt-in): Anthropic (native Messages API), OpenAI, or Gemini (OpenAI-compatible).
 * - Speech-to-text: any OpenAI-compatible /v1/audio/transcriptions endpoint
 *   (faster-whisper-server / Speaches locally, or OpenAI / Groq in the cloud).
 *
 * Cloud is never used unless `cloudMode` is "fallback" or "prefer". Embeddings and
 * reminder wording always stay local, so the vault index never leaves the machine.
 */

export type Role = "system" | "user" | "assistant";
export interface ChatImage {
  mime: string;
  /** base64 without the data: prefix */
  data: string;
}
export interface ChatMessage {
  role: Role;
  content: string;
  images?: ChatImage[];
}

export type Purpose = "ask" | "decompose" | "extract" | "vision" | "summary" | "nag";

export interface ChatOptions {
  purpose: Purpose;
  /** Ask the model for a JSON object (OpenAI response_format / Ollama format). */
  json?: boolean;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  /** Never send to a cloud provider (reminder wording, anything trivial). */
  localOnly?: boolean;
}

export interface ChatResult {
  text: string;
  provider: string;
  model: string;
}

export class AiUnavailableError extends Error {
  constructor(message: string, readonly reason: "disabled" | "unreachable" | "no-model" | "busy" = "unreachable") {
    super(message);
  }
}

export interface ChatBackend {
  readonly name: string;
  readonly model: string;
  readonly vision: boolean;
  chat(messages: ChatMessage[], opts: ChatOptions): Promise<ChatResult>;
}

export interface AiSettings {
  /** "ollama" | "openai" (any OpenAI-compatible local server) | "none" */
  provider: "ollama" | "openai" | "none";
  baseUrl: string;
  apiKey?: string;
  chatModel: string;
  embedModel: string;
  /** Local multimodal model for photos, e.g. "llama3.2-vision" or "qwen2.5vl". Optional. */
  visionModel?: string;
  cloud?: { provider: "anthropic" | "openai" | "gemini"; apiKey: string; model?: string; baseUrl?: string };
  cloudMode: "off" | "fallback" | "prefer";
  stt?: { baseUrl: string; apiKey?: string; model: string; language?: string };
  timeoutMs: number;
  /** Max concurrent model calls; local CPUs only run one generation well at a time. */
  concurrency: number;
  /** Requests waiting beyond this are refused with "busy" rather than piling up. */
  maxQueue: number;
}

const trimSlash = (s: string) => s.replace(/\/+$/, "");

/** Redact anything that looks like a key before it reaches logs or the UI. */
export function redact(s: string): string {
  return s.replace(/(sk-[A-Za-z0-9_-]{6})[A-Za-z0-9_-]+/g, "$1…").replace(/(key=)[^&\s]+/gi, "$1…");
}

async function postJson(url: string, body: unknown, headers: Record<string, string>, timeoutMs: number): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    const msg = e instanceof Error && e.name === "TimeoutError" ? `timed out after ${Math.round(timeoutMs / 1000)}s` : (e as Error).message;
    throw new AiUnavailableError(`${new URL(url).host}: ${msg}`);
  }
  const text = await res.text();
  if (!res.ok) {
    const reason = res.status === 404 && /model/i.test(text) ? "no-model" : "unreachable";
    throw new AiUnavailableError(`${new URL(url).host} ${res.status}: ${redact(text.slice(0, 300))}`, reason);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new AiUnavailableError(`${new URL(url).host}: invalid JSON response`);
  }
}

/** Ollama (/v1), LM Studio, llama.cpp, vLLM, OpenAI, Gemini — anything speaking the OpenAI chat API. */
export class OpenAICompatibleChat implements ChatBackend {
  constructor(
    readonly name: string,
    private baseUrl: string,
    readonly model: string,
    private apiKey: string | undefined,
    readonly vision: boolean,
    private defaultTimeout: number,
  ) {}

  async chat(messages: ChatMessage[], opts: ChatOptions): Promise<ChatResult> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages: messages.map((m) =>
        m.images?.length
          ? {
              role: m.role,
              content: [
                { type: "text", text: m.content },
                ...m.images.map((i) => ({ type: "image_url", image_url: { url: `data:${i.mime};base64,${i.data}` } })),
              ],
            }
          : { role: m.role, content: m.content },
      ),
      temperature: opts.temperature ?? 0.2,
      max_tokens: opts.maxTokens ?? 800,
      stream: false,
    };
    if (opts.json) body.response_format = { type: "json_object" };
    const headers: Record<string, string> = this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {};
    const r = (await postJson(`${trimSlash(this.baseUrl)}/chat/completions`, body, headers, opts.timeoutMs ?? this.defaultTimeout)) as {
      choices?: { message?: { content?: string | null } }[];
    };
    const text = r.choices?.[0]?.message?.content;
    if (typeof text !== "string") throw new AiUnavailableError(`${this.name}: empty response`);
    return { text, provider: this.name, model: this.model };
  }
}

/** Anthropic Messages API (native; supports images). */
export class AnthropicChat implements ChatBackend {
  readonly name = "anthropic";
  readonly vision = true;
  constructor(
    private apiKey: string,
    readonly model: string,
    private baseUrl: string,
    private defaultTimeout: number,
  ) {}

  async chat(messages: ChatMessage[], opts: ChatOptions): Promise<ChatResult> {
    const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
    const turns = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role,
        content: [
          ...(m.images ?? []).map((i) => ({ type: "image", source: { type: "base64", media_type: i.mime, data: i.data } })),
          { type: "text", text: m.content },
        ],
      }));
    if (opts.json) turns.push({ role: "assistant", content: [{ type: "text", text: "{" }] });
    const r = (await postJson(
      `${trimSlash(this.baseUrl)}/v1/messages`,
      { model: this.model, max_tokens: opts.maxTokens ?? 800, temperature: opts.temperature ?? 0.2, system, messages: turns },
      { "x-api-key": this.apiKey, "anthropic-version": "2023-06-01" },
      opts.timeoutMs ?? this.defaultTimeout,
    )) as { content?: { type: string; text?: string }[] };
    const text = (r.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
    if (!text) throw new AiUnavailableError("anthropic: empty response");
    return { text: opts.json ? `{${text}` : text, provider: this.name, model: this.model };
  }
}

/** Small FIFO semaphore with a bounded queue. */
class Gate {
  private active = 0;
  private waiting: (() => void)[] = [];
  constructor(
    private max: number,
    private maxQueue: number,
  ) {}
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) {
      if (this.waiting.length >= this.maxQueue) throw new AiUnavailableError("The AI is busy with other requests — try again in a moment.", "busy");
      await new Promise<void>((r) => this.waiting.push(r));
    }
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.waiting.shift()?.();
    }
  }
}

export interface AiStatus {
  enabled: boolean;
  local?: { provider: string; chatModel: string; embedModel: string; visionModel?: string };
  cloud?: { provider: string; model: string; mode: "fallback" | "prefer" };
  speechToText: boolean;
  vision: boolean;
}

/**
 * Routes each request: local first (or cloud first in "prefer" mode), the other as fallback
 * when allowed. Embeddings and transcription have their own single backend.
 */
export class AiClient {
  readonly local?: ChatBackend;
  readonly localVision?: ChatBackend;
  readonly cloud?: ChatBackend;
  private gate: Gate;

  constructor(readonly settings: AiSettings) {
    const s = settings;
    this.gate = new Gate(Math.max(1, s.concurrency), Math.max(0, s.maxQueue));
    if (s.provider !== "none") {
      const base = s.provider === "ollama" ? `${trimSlash(s.baseUrl)}/v1` : trimSlash(s.baseUrl);
      this.local = new OpenAICompatibleChat(s.provider, base, s.chatModel, s.apiKey, false, s.timeoutMs);
      if (s.visionModel) this.localVision = new OpenAICompatibleChat(s.provider, base, s.visionModel, s.apiKey, true, s.timeoutMs);
    }
    if (s.cloud && s.cloudMode !== "off") {
      const c = s.cloud;
      if (c.provider === "anthropic") {
        this.cloud = new AnthropicChat(c.apiKey, c.model ?? "claude-haiku-5-5", c.baseUrl ?? "https://api.anthropic.com", s.timeoutMs);
      } else {
        const base = c.baseUrl ?? (c.provider === "gemini" ? "https://generativelanguage.googleapis.com/v1beta/openai" : "https://api.openai.com/v1");
        const model = c.model ?? (c.provider === "gemini" ? "gemini-2.5-flash" : "gpt-5-mini");
        this.cloud = new OpenAICompatibleChat(c.provider, base, model, c.apiKey, true, s.timeoutMs);
      }
    }
  }

  get enabled(): boolean {
    return !!(this.local || this.cloud);
  }
  get canEmbed(): boolean {
    return this.settings.provider !== "none";
  }
  get canTranscribe(): boolean {
    return !!this.settings.stt;
  }
  get canSeeImages(): boolean {
    return !!(this.localVision || this.cloud?.vision);
  }

  status(): AiStatus {
    const s = this.settings;
    return {
      enabled: this.enabled,
      local: this.local ? { provider: s.provider, chatModel: s.chatModel, embedModel: s.embedModel, visionModel: s.visionModel } : undefined,
      cloud: this.cloud ? { provider: this.cloud.name, model: this.cloud.model, mode: s.cloudMode as "fallback" | "prefer" } : undefined,
      speechToText: this.canTranscribe,
      vision: this.canSeeImages,
    };
  }

  private order(opts: ChatOptions, needsVision: boolean): ChatBackend[] {
    const local = needsVision ? this.localVision : this.local;
    const cloud = opts.localOnly || (needsVision && !this.cloud?.vision) ? undefined : this.cloud;
    const list = this.settings.cloudMode === "prefer" ? [cloud, local] : [local, cloud];
    return list.filter((b): b is ChatBackend => !!b);
  }

  async chat(messages: ChatMessage[], opts: ChatOptions): Promise<ChatResult> {
    const needsVision = messages.some((m) => m.images?.length);
    const backends = this.order(opts, needsVision);
    if (!backends.length) {
      throw new AiUnavailableError(needsVision ? "No image-capable model is configured (set AI_VISION_MODEL or a cloud provider)." : "AI is turned off.", "disabled");
    }
    return this.gate.run(async () => {
      let last: unknown;
      for (const b of backends) {
        try {
          return await b.chat(messages, opts);
        } catch (e) {
          last = e;
          if (!(e instanceof AiUnavailableError)) throw e;
          console.warn(`[ai] ${b.name}/${b.model} failed (${opts.purpose}): ${e.message}`);
        }
      }
      throw last instanceof Error ? last : new AiUnavailableError("AI request failed");
    });
  }

  /** Is the local model server answering? (GET /v1/models, 5 s timeout.) */
  async ping(): Promise<boolean> {
    const s = this.settings;
    if (s.provider === "none") return false;
    const base = s.provider === "ollama" ? `${trimSlash(s.baseUrl)}/v1` : trimSlash(s.baseUrl);
    try {
      const res = await fetch(`${base}/models`, { headers: s.apiKey ? { authorization: `Bearer ${s.apiKey}` } : {}, signal: AbortSignal.timeout(5000) });
      return res.ok;
    } catch {
      return false;
    }
  }

  /** Always local. Returns one vector per input. */
  async embed(texts: string[], timeoutMs = this.settings.timeoutMs): Promise<Float32Array[]> {
    const s = this.settings;
    if (s.provider === "none") throw new AiUnavailableError("Embeddings need a local AI provider.", "disabled");
    if (!texts.length) return [];
    const base = s.provider === "ollama" ? `${trimSlash(s.baseUrl)}/v1` : trimSlash(s.baseUrl);
    const headers: Record<string, string> = s.apiKey ? { authorization: `Bearer ${s.apiKey}` } : {};
    const r = (await postJson(`${base}/embeddings`, { model: s.embedModel, input: texts }, headers, timeoutMs)) as {
      data?: { embedding: number[]; index?: number }[];
    };
    const data = r.data ?? [];
    if (data.length !== texts.length) throw new AiUnavailableError(`embeddings: expected ${texts.length} vectors, got ${data.length}`);
    return [...data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).map((d) => normalize(Float32Array.from(d.embedding)));
  }

  async transcribe(audio: Uint8Array, filename: string, mime: string): Promise<string> {
    const stt = this.settings.stt;
    if (!stt) throw new AiUnavailableError("Speech-to-text is not configured (STT_BASE_URL).", "disabled");
    const form = new FormData();
    form.append("file", new Blob([audio as BlobPart], { type: mime }), filename);
    form.append("model", stt.model);
    if (stt.language) form.append("language", stt.language);
    form.append("response_format", "json");
    let res: Response;
    try {
      res = await fetch(`${trimSlash(stt.baseUrl)}/audio/transcriptions`, {
        method: "POST",
        headers: stt.apiKey ? { authorization: `Bearer ${stt.apiKey}` } : {},
        body: form,
        signal: AbortSignal.timeout(Math.max(this.settings.timeoutMs, 120_000)),
      });
    } catch (e) {
      throw new AiUnavailableError(`speech-to-text: ${(e as Error).message}`);
    }
    const body = await res.text();
    if (!res.ok) throw new AiUnavailableError(`speech-to-text ${res.status}: ${redact(body.slice(0, 200))}`);
    try {
      const j = JSON.parse(body) as { text?: string };
      return (j.text ?? "").trim();
    } catch {
      return body.trim();
    }
  }
}

export function normalize(v: Float32Array): Float32Array {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < v.length; i++) v[i]! /= n;
  return v;
}

/**
 * Parse a model's JSON reply. Small local models sometimes wrap JSON in prose or ``` fences,
 * so take the outermost {...} block.
 */
export function parseJsonReply<T = unknown>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const src = fenced ? fenced[1]! : text;
  const start = src.indexOf("{");
  const end = src.lastIndexOf("}");
  if (start < 0 || end <= start) throw new AiUnavailableError("The model didn't return JSON.");
  try {
    return JSON.parse(src.slice(start, end + 1)) as T;
  } catch {
    throw new AiUnavailableError("The model returned malformed JSON.");
  }
}
