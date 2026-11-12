import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// @ts-expect-error plain JS test helper
import { startMockAi } from "../../../tests/lib/mock-ai.mjs";
import {
  AiClient,
  AiUnavailableError,
  ask,
  chunkMarkdown,
  cleanTitle,
  DEFAULT_NAG_CONFIG,
  dailyDigest,
  extractTasks,
  nagFlavor,
  parseJsonReply,
  parseTimeHint,
  quickAddText,
  replaceSection,
  SemanticIndex,
  suggestSubtasks,
  tasks,
  todayInTz,
  addDays,
  type AiSettings,
  type NagConfig,
} from "../src/index.js";
import { setup } from "./helpers.js";

type Mock = { url: string; state: { calls: { kind: string; model?: string; system?: string }[] }; close(): Promise<void> };
let mock: Mock;
beforeAll(async () => {
  mock = await startMockAi();
});
afterAll(() => mock.close());

const nag: NagConfig = { ...DEFAULT_NAG_CONFIG, timeZone: "Asia/Riyadh" };
const TZ = "Asia/Riyadh";

function settings(over: Partial<AiSettings> = {}): AiSettings {
  return {
    provider: "ollama",
    baseUrl: mock.url,
    chatModel: "llama3.2:3b",
    embedModel: "nomic-embed-text",
    cloudMode: "off",
    timeoutMs: 5000,
    concurrency: 1,
    maxQueue: 4,
    ...over,
  };
}
const fail = (on: boolean) => fetch(`${mock.url}/__fail?on=${on ? 1 : 0}`);

async function fixture(opts: { engine?: "auto" | "js" } = {}) {
  const s = setup({ allowExtensions: opts.engine !== "js" });
  const today = todayInTz(TZ);
  s.write(
    "projects/homelab.md",
    `---\nproject: Homelab\n---\n# Homelab\n\n## Core switch\nWe decided to replace the core switch with an SG350 because the old one drops VLAN config after firmware updates.\n\n## Tasks\n- [ ] Replace core switch !p1 📅 ${today}\n- [x] Back up switch config ✅ ${addDays(today, -40)}\n- [ ] Migrate VLANs\n`,
  );
  s.write("notes/garden.md", "# Garden\n\nTomatoes need watering twice a week in summer. Basil prefers shade in the afternoon.\n");
  s.write(`daily/${today}.md`, `# ${today}\n\n## Log\n- 09:10 Router rebooted after a power blip\n`);
  await s.indexer.fullScan();
  const ai = new AiClient(settings());
  const semantic = new SemanticIndex(s.db, ai, TZ, { vector: opts.engine ?? "auto" });
  return { ...s, ai, semantic, deps: { db: s.db, ai, semantic, nag }, today };
}

describe("chunkMarkdown", () => {
  it("splits by heading, skips frontmatter and fences, strips task tokens", () => {
    const c = chunkMarkdown("---\ntitle: x\n---\n# Title only\nIntro line\n\n## A\nalpha ^oc-abc12345\n```\n# not a heading\n```\n\n## B\n- [ ] thing 📅 2026-01-01 ^oc-zzz\n## Empty\n# Lonely title\n");
    expect(c.map((x) => x.heading)).toEqual(["Title only", "A", "B", "Empty"]);
    expect(c[1]!.text).toContain("# not a heading");
    expect(c[1]!.text).not.toContain("^oc-");
    expect(c[2]!.text).toBe("- [ ] thing");
    expect(c.find((x) => x.text.includes("title: x"))).toBeUndefined();
  });

  it("keeps chunks under the size limit", () => {
    const long = Array.from({ length: 80 }, (_, i) => `Sentence number ${i} talks about something.`).join(" ");
    const c = chunkMarkdown(`# T\n\n${long}\n\nshort tail`);
    expect(c.length).toBeGreaterThan(2);
    expect(Math.max(...c.map((x) => x.text.length))).toBeLessThanOrEqual(910);
  });
});

for (const engine of ["auto", "js"] as const) {
  describe(`SemanticIndex (${engine})`, () => {
    it("embeds notes and tasks, then only what changed", async () => {
      const f = await fixture({ engine });
      if (engine === "auto") expect(f.semantic.engine).toBe("sqlite-vec");
      else expect(f.semantic.engine).toBe("js");
      const r1 = await f.semantic.sync();
      expect(r1.embedded).toBe(r1.total);
      expect(r1.total).toBe(3 + 3); // 3 notes + 3 tasks
      const r2 = await f.semantic.sync();
      expect(r2).toMatchObject({ embedded: 0, removed: 0, skipped: r1.total });

      f.write("notes/garden.md", "# Garden\n\nTomatoes now get drip irrigation.\n");
      await f.indexer.fullScan();
      expect((await f.semantic.sync()).embedded).toBe(1);

      const hits = await f.semantic.search("why did we decide to replace the core switch?", 5);
      expect(hits[0]!.heading).toBe("Core switch");
      expect(hits[0]!.text).toContain("SG350");
      expect(hits.some((h) => h.source === "task" && h.text.startsWith("Task: Replace core switch"))).toBe(true);
      // checkbox lines live in task chunks, not duplicated in the note's chunks
      expect(hits.filter((h) => h.source === "note").some((h) => h.text.includes("- [ ]"))).toBe(false);

      // delete a note: its chunks and its tasks' chunks go
      await f.indexer.removeFile("notes/garden.md");
      const r4 = await f.semantic.sync();
      expect(r4.removed).toBeGreaterThan(0);
      expect((await f.semantic.search("tomatoes irrigation", 10)).some((h) => h.text.includes("Tomatoes"))).toBe(false);
    });

    it("filters by date (\"last quarter\" style)", async () => {
      const f = await fixture({ engine });
      await f.semantic.sync();
      const since = addDays(f.today, -60);
      const hits = await f.semantic.search("switch config backup", 10, { since, until: addDays(f.today, -30) });
      expect(hits.length).toBeGreaterThan(0);
      expect(hits.every((h) => h.day! >= since)).toBe(true);
      expect(hits[0]!.text).toContain("Back up switch config");
    });

    it("rebuilds when the embedding model changes", async () => {
      const f = await fixture({ engine });
      await f.semantic.sync();
      const other = new SemanticIndex(f.db, new AiClient(settings({ embedModel: "mxbai-embed-large" })), TZ, { vector: engine });
      const r = await other.sync();
      expect(r.embedded).toBe(r.total);
      expect(other.stats().model).toBe("mxbai-embed-large");
    });
  });
}

describe("Ask", () => {
  it("answers from sources with citations and has no side effects", async () => {
    const f = await fixture();
    await f.semantic.sync();
    const before = f.db.select().from(tasks).all().length;
    const r = await ask(f.deps, "why did we decide to replace the core switch?");
    expect(r.answer).toContain("SG350");
    expect(r.cited.length).toBeGreaterThan(0);
    const first = r.sources.find((s) => s.n === r.cited[0])!;
    expect(first.title).toBe("homelab");
    expect(first.path).toBe("projects/homelab.md");
    expect(f.db.select().from(tasks).all().length).toBe(before);
  });

  it("says so when the index is empty", async () => {
    const f = await fixture();
    const r = await ask(f.deps, "anything about bees?");
    expect(r.sources).toEqual([]);
    expect(r.answer).toMatch(/couldn't find/);
  });
});

describe("Task breakdown", () => {
  it("suggests subtasks and writes them nested under the task", async () => {
    const f = await fixture();
    const parent = f.db.select().from(tasks).where(eq(tasks.title, "Replace core switch")).get()!;
    const s = await suggestSubtasks(f.deps, parent.id);
    expect(s.subtasks.length).toBe(5);
    const created = await f.service.addSubtasks(parent.id, s.subtasks.slice(0, 2));
    expect(created.map((c) => c.parentTaskId)).toEqual([parent.id, parent.id]);
    // added after existing children on the next call
    const more = await f.service.addSubtasks(parent.id, ["Label the new ports"]);
    expect(more[0]!.parentTaskId).toBe(parent.id);
    const text = f.read("projects/homelab.md");
    const lines = text.split("\n");
    const i = lines.findIndex((l) => l.includes("Replace core switch"));
    expect(lines[i + 1]).toMatch(/^ {4}- \[ \] Check what's needed/);
    expect(lines[i + 3]).toMatch(/^ {4}- \[ \] Label the new ports \^oc-/);
    expect(lines[i + 4]).toMatch(/^- \[x\] Back up switch config/);
  });

  it("flattens hostile model output into safe single lines", async () => {
    const f = await fixture();
    const t = await f.service.create({ text: "EVIL task" });
    const s = await suggestSubtasks(f.deps, t.id);
    expect(s.subtasks).toEqual(["Step one", "Step two - [x] injected line", "## Heading", "Numbered"]);
    for (const x of s.subtasks) {
      expect(x).not.toMatch(/\n|\^oc-|📅|!p1/);
    }
    await f.service.addSubtasks(t.id, s.subtasks);
    const kids = f.db.select().from(tasks).where(eq(tasks.parentTaskId, t.id)).all();
    expect(kids.length).toBe(4);
    expect(f.db.select().from(tasks).all().filter((x) => x.title.includes("injected")).length).toBe(1); // one line, not a second task
  });

  it("cleanTitle and quickAddText", () => {
    expect(cleanTitle("  - [ ] 2) Order PSU !p2 📅 2026-01-01 ^oc-12345678 ")).toBe("Order PSU");
    expect(cleanTitle("x".repeat(200)).length).toBe(120);
    expect(quickAddText({ title: "Order PSU", dueDate: "2026-11-13", dueTime: "10:00", priority: 1, projectSlug: "homelab" })).toBe("Order PSU !p1 📅 2026-11-13 10:00 #project/homelab");
  });
});

describe("Voice → tasks", () => {
  it("extracts action items with dates, priority and known projects only", async () => {
    const f = await fixture();
    const r = await extractTasks(f.deps, "Remember to order a spare PSU tomorrow, it's urgent. I also need to call the ISP about the outage. Need to file the made-up report. The weather was nice.");
    expect(r.tasks.map((t) => t.title)).toEqual(["Order a spare PSU", "Call the ISP about the outage", "File the made-up report"]);
    expect(r.tasks[0]).toMatchObject({ dueDate: addDays(todayInTz(TZ), 1), priority: 1, projectSlug: "homelab" });
    expect(r.tasks[2]!.projectSlug).toBeUndefined(); // unknown project dropped
  });
});

describe("Standup / retro", () => {
  it("sanitises model text (no headings, checkboxes or anchors)", async () => {
    const f = await fixture();
    const d = await dailyDigest(f.deps, "standup");
    expect(d.ai).toBe(true);
    expect(d.text).not.toMatch(/^#/m);
    expect(d.text).not.toMatch(/\[ \]|\^oc-/);
    expect(d.text).not.toMatch(/\n\n\n/);
    expect(d.text.split("\n")[0]).toMatch(/^You wrapped up/); // the "## Standup" line is gone, not left as text
    expect(d.text).toContain("- Fake task from the model");
  });

  it("falls back to a template when the model is down", async () => {
    const f = await fixture();
    await fail(true);
    try {
      const d = await dailyDigest(f.deps, "retro");
      expect(d.ai).toBe(false);
      expect(d.text).toMatch(/Still open: \d/);
      expect(d.text).toMatch(/Tomorrow, start with: Replace core switch/);
    } finally {
      await fail(false);
    }
  });

  it("is empty when there's nothing to say", async () => {
    const s = setup();
    const d = await dailyDigest({ db: s.db, ai: new AiClient(settings()), nag }, "standup");
    expect(d.empty).toBe(true);
  });

  it("replaceSection replaces in place or appends", () => {
    const a = replaceSection("# D\n\n## Log\n- 1\n\n## Standup\nold\nold2\n\n## Tasks\n- [ ] x\n", "Standup", "new");
    expect(a).toBe("# D\n\n## Log\n- 1\n\n## Standup\nnew\n\n## Tasks\n- [ ] x\n");
    expect(replaceSection("# D\n\n## Log\n- 1\n", "Retro", "r1\nr2")).toBe("# D\n\n## Log\n- 1\n\n## Retro\nr1\nr2\n");
  });
});

describe("Routing and limits", () => {
  it("falls back to the cloud only when allowed, and never for reminder wording", async () => {
    const f = await fixture();
    const cloud = new AiClient(settings({ cloudMode: "fallback", cloud: { provider: "anthropic", apiKey: "sk-ant-test", baseUrl: mock.url, model: "claude-haiku-5-5" } }));
    await fail(true);
    try {
      await expect(new AiClient(settings()).chat([{ role: "user", content: "hi" }], { purpose: "ask" })).rejects.toBeInstanceOf(AiUnavailableError);
      const r = await cloud.chat([{ role: "system", content: "Break a task into" }, { role: "user", content: "<task>Fix it</task>" }], { purpose: "decompose", json: true });
      expect(r.provider).toBe("anthropic");
      expect(parseJsonReply<{ subtasks: string[] }>(r.text).subtasks.length).toBe(5);
      await fetch(`${mock.url}/__reset`);
      const t = f.db.select().from(tasks).get()!;
      expect(await nagFlavor({ db: f.db, ai: cloud, nag }, t, "overdue", 1)).toBeNull();
      const st = (await (await fetch(`${mock.url}/__state`)).json()) as { calls: { kind: string }[] };
      expect(st.calls.filter((c) => c.kind === "cloud-chat")).toEqual([]);
    } finally {
      await fail(false);
    }
  });

  it("refuses with 'busy' instead of queueing forever", async () => {
    const ai = new AiClient(settings({ maxQueue: 0 }));
    await fetch(`${mock.url}/__delay?ms=300`);
    try {
      const a = ai.chat([{ role: "user", content: "x" }], { purpose: "ask" });
      await expect(ai.chat([{ role: "user", content: "y" }], { purpose: "ask" })).rejects.toMatchObject({ reason: "busy" });
      await a;
    } finally {
      await fetch(`${mock.url}/__delay?ms=0`);
    }
  });

  it("reports a missing model clearly", async () => {
    const ai = new AiClient(settings({ embedModel: "missing-model" }));
    await expect(ai.embed(["x"])).rejects.toMatchObject({ reason: "no-model" });
  });

  it("is off with provider none and no cloud", async () => {
    const ai = new AiClient(settings({ provider: "none" }));
    expect(ai.enabled).toBe(false);
    await expect(ai.chat([{ role: "user", content: "x" }], { purpose: "ask" })).rejects.toMatchObject({ reason: "disabled" });
  });
});

describe("parseTimeHint", () => {
  const now = new Date("2026-11-12T09:00:00Z"); // Thursday
  it.each([
    ["tasks from last quarter", "2026-07-01", "2026-09-30"],
    ["what did I do this week", "2026-11-09", "2026-11-12"],
    ["last week", "2026-11-02", "2026-11-08"],
    ["notes from last month", "2026-10-01", "2026-10-31"],
    ["decisions in march", "2026-03-01", "2026-03-31"],
    ["in december", "2025-12-01", "2025-12-31"],
    ["past 10 days", "2026-11-02", "2026-11-12"],
    ["yesterday", "2026-11-11", "2026-11-11"],
  ])("%s", (q, since, until) => {
    expect(parseTimeHint(q, TZ, now)).toMatchObject({ since, until });
  });
  it("January: last month / last quarter cross the year", () => {
    const jan = new Date("2027-01-15T09:00:00Z");
    expect(parseTimeHint("last month", TZ, jan)).toMatchObject({ since: "2026-12-01", until: "2026-12-31" });
    expect(parseTimeHint("last quarter", TZ, jan)).toMatchObject({ since: "2026-10-01", until: "2026-12-31" });
  });
  it("no hint", () => expect(parseTimeHint("core switch", TZ, now)).toBeNull());
});
