import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  endOfLocalDay,
  insertUnderHeading,
  nextOccurrence,
  parseRecurrence,
  parseTaskText,
  tasks,
  todayInTz,
  zonedToInstant,
} from "../src/index.js";
import { setup } from "./helpers.js";

describe("recurrence rules", () => {
  it("parses the Obsidian Tasks subset", () => {
    expect(parseRecurrence("every day")).toMatchObject({ kind: "interval", unit: "day", n: 1 });
    expect(parseRecurrence("every 2 weeks when done")).toMatchObject({ unit: "week", n: 2, whenDone: true });
    expect(parseRecurrence("every weekday")).toMatchObject({ kind: "weekday" });
    expect(parseRecurrence("every monday, thursday")).toMatchObject({ kind: "days", days: [1, 4] });
    expect(parseRecurrence("whenever")).toBeNull();
  });

  it("computes next dates (Fri+Sat weekend by default)", () => {
    // 2026-11-12 is a Thursday
    expect(nextOccurrence(parseRecurrence("every weekday")!, "2026-11-12", "2026-11-12")).toBe("2026-11-15"); // → Sunday
    expect(nextOccurrence(parseRecurrence("every weekday")!, "2026-11-12", "2026-11-12", [0, 6])).toBe("2026-11-13");
    expect(nextOccurrence(parseRecurrence("every month")!, "2026-01-31", "2026-01-31")).toBe("2026-02-28");
    expect(nextOccurrence(parseRecurrence("every 3 days when done")!, "2026-11-01", "2026-11-11")).toBe("2026-11-14");
    expect(nextOccurrence(parseRecurrence("every monday")!, "2026-11-12", "2026-11-12")).toBe("2026-11-16");
  });

  it("extracts 🔁 and ✅ tokens from task text", () => {
    expect(parseTaskText("Water plants 🔁 every 2 days 📅 2026-11-12 ✅ 2026-11-11 #home")).toMatchObject({
      title: "Water plants",
      recurrence: "every 2 days",
      dueDate: "2026-11-12",
      doneDate: "2026-11-11",
      tags: ["home"],
    });
  });
});

describe("recurring completion", () => {
  it("inserts the next occurrence above, like Obsidian Tasks", async () => {
    const s = setup();
    s.write("a.md", "- [ ] Backup NAS 🔁 every week 📅 2026-11-10 #homelab\n");
    await s.indexer.indexFile("a.md");
    const t = s.db.select().from(tasks).get()!;
    await s.service.update(t.id, { status: "done" });
    const lines = s.read("a.md").split("\n");
    expect(lines[0]).toMatch(/^- \[ \] Backup NAS 🔁 every week 📅 2026-11-17 #homelab \^oc-/);
    expect(lines[1]).toMatch(new RegExp(`^- \\[x\\] Backup NAS 🔁 every week 📅 2026-11-10 #homelab ✅ ${todayInTz("Asia/Riyadh")} \\^oc-`));
    const all = s.db.select().from(tasks).all();
    expect(all).toHaveLength(2);
    expect(all.find((x) => x.id === t.id)!.status).toBe("done");
    expect(all.find((x) => x.id !== t.id)).toMatchObject({ status: "ready", dueDate: "2026-11-17", recurrence: "every week" });
  });
});

describe("capture", () => {
  it("appends timestamped log lines to today's daily note", async () => {
    const s = setup();
    // Anchor to *today* so the task created "now" lands in the same daily note.
    const today = todayInTz("Asia/Riyadh");
    const now = zonedToInstant(today, "12:05", "Asia/Riyadh");
    const path = await s.service.appendLog("Spoke to ISP, ticket #4411", now);
    await s.service.appendLog("multi\nline", zonedToInstant(today, "13:00", "Asia/Riyadh"));
    await s.service.create({ text: "A task" });
    const file = s.read(path);
    expect(file).toMatch(/## Tasks\n- \[ \] A task \^oc-[a-z0-9]+\n\n## Log\n- 12:05 Spoke to ISP, ticket #4411\n- 13:00 multi ↩ line\n/);
  });

  it("creates and appends inbox notes", async () => {
    const s = setup();
    const p = await s.service.captureNote("Router Ideas", "Use VLAN 30 for IoT");
    await s.service.captureNote("Router Ideas", "- [ ] Buy managed switch");
    const text = s.read(p);
    expect(p).toBe("inbox/router-ideas.md");
    expect(text).toContain("# Router Ideas\n\nUse VLAN 30 for IoT");
    expect(text).toMatch(/### \d{4}-\d{2}-\d{2} \d{2}:\d{2}\n- \[ \] Buy managed switch/);
    expect(s.db.select().from(tasks).where(eq(tasks.title, "Buy managed switch")).get()).toBeTruthy();
  });

  it("insertUnderHeading creates missing headings", () => {
    expect(insertUnderHeading("# Note\n\nbody\n", "Log", "- x")).toBe("# Note\n\nbody\n\n## Log\n- x\n");
  });
});

describe("time zones", () => {
  it("converts local wall time to an instant", () => {
    expect(zonedToInstant("2026-11-11", "09:00", "Asia/Riyadh").toISOString()).toBe("2026-11-11T06:00:00.000Z");
    expect(zonedToInstant("2026-07-01", "09:00", "Europe/London").toISOString()).toBe("2026-07-01T08:00:00.000Z");
    expect(endOfLocalDay("Asia/Riyadh", new Date("2026-11-11T22:00:00Z")).toISOString()).toBe("2026-11-12T20:59:59.999Z");
  });
});
