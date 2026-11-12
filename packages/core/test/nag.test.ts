import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  applyTaskAction,
  DEFAULT_NAG_CONFIG,
  evaluateNag,
  remindersLog,
  runNagTick,
  tasks,
  type NagConfig,
  type Notifier,
  type ReminderPayload,
  type Task,
} from "../src/index.js";
import { setup } from "./helpers.js";

const cfg: NagConfig = { ...DEFAULT_NAG_CONFIG, timeZone: "Asia/Riyadh" };
const Z = (iso: string) => new Date(iso);

// Due 2026-11-11 09:00 Riyadh == 06:00Z
const base: Task = {
  id: "t1", projectId: null, milestoneId: null, noteId: null, parentTaskId: null,
  title: "Replace UPS battery", status: "ready", priority: 4, dueDate: "2026-11-11", dueTime: "09:00",
  tags: [], rolloverCount: 0, remarks: [], pinned: false, progress: 0, snoozedUntil: null,
  lastActionAt: null, recurrence: null, anchor: null, lineNumber: null, rawLine: null, ordinal: null,
  completedAt: null, createdAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-01T00:00:00Z",
};
const none = { done: 0, total: 0 };
const ev = (t: Partial<Task>, last: string | null, now: string, c = cfg) =>
  evaluateNag({ ...base, ...t }, none, last ? Z(last) : null, Z(now), c);

describe("evaluateNag", () => {
  it("is silent before the due window and for closed/backlog tasks", () => {
    expect(ev({}, null, "2026-11-11T05:59:00Z")).toBeNull();
    expect(ev({ status: "done" }, null, "2026-11-11T08:00:00Z")).toBeNull();
    expect(ev({ status: "backlog" }, null, "2026-11-11T08:00:00Z")).toBeNull();
    expect(ev({ dueDate: null }, null, "2026-11-11T08:00:00Z")).toBeNull();
  });

  it("fires at the due time, then every 30 min while overdue", () => {
    expect(ev({}, null, "2026-11-11T06:00:00Z")).toMatchObject({ state: "overdue", send: true });
    expect(ev({}, "2026-11-11T06:00:00Z", "2026-11-11T06:29:00Z")!.send).toBe(false);
    expect(ev({}, "2026-11-11T06:00:00Z", "2026-11-11T06:30:00Z")!.send).toBe(true);
  });

  it("uses the default due time when none is set", () => {
    expect(ev({ dueTime: null }, null, "2026-11-11T05:59:00Z")).toBeNull();
    expect(ev({ dueTime: null }, null, "2026-11-11T06:00:00Z")!.send).toBe(true);
  });

  it("escalates faster for p1 and chronic rollovers", () => {
    expect(ev({ priority: 1 }, null, "2026-11-11T06:00:00Z")!.intervalMin).toBe(15);
    expect(ev({ priority: 1, rolloverCount: 3 }, null, "2026-11-11T06:00:00Z")!.intervalMin).toBe(10); // floor
  });

  it("classifies partial and remark states with their own cadence", () => {
    expect(ev({ progress: 50 }, null, "2026-11-11T06:00:00Z")).toMatchObject({ state: "partial", intervalMin: 60 });
    expect(evaluateNag(base, { done: 2, total: 5 }, null, Z("2026-11-11T06:00:00Z"), cfg)!.state).toBe("partial");
    const remark = { remarks: [{ at: "2026-11-11T05:00:00Z", text: "Awaiting parts", source: "telegram" as const }] };
    expect(ev(remark, null, "2026-11-11T06:00:00Z")).toMatchObject({ state: "remark", intervalMin: 120 });
    expect(ev({ status: "blocked" }, null, "2026-11-11T06:00:00Z")!.state).toBe("remark");
  });

  it("user actions reset the timer; snoozes and mutes suppress, then fire when they end", () => {
    expect(ev({ lastActionAt: "2026-11-11T06:20:00Z" }, "2026-11-11T06:00:00Z", "2026-11-11T06:35:00Z")!.send).toBe(false);
    const snoozed = { snoozedUntil: "2026-11-11T07:00:00Z" };
    expect(ev(snoozed, "2026-11-11T06:00:00Z", "2026-11-11T06:45:00Z")!.send).toBe(false);
    expect(ev(snoozed, "2026-11-11T06:00:00Z", "2026-11-11T07:00:00Z")!.send).toBe(true);
  });

  it("respects quiet hours (23:00–07:00 local)", () => {
    const late = { dueTime: "22:00" }; // 19:00Z
    expect(ev(late, null, "2026-11-11T19:30:00Z")!.send).toBe(true); // 22:30 local
    expect(ev(late, "2026-11-11T19:30:00Z", "2026-11-11T20:30:00Z")!.send).toBe(false); // 23:30 local
    expect(ev(late, "2026-11-11T19:30:00Z", "2026-11-12T04:00:00Z")!.send).toBe(true); // 07:00 local
  });

  it("a reschedule starts fresh: old reminders don't delay the new due time", () => {
    expect(ev({ dueDate: "2026-11-12" }, "2026-11-11T23:50:00Z", "2026-11-12T06:00:00Z")!.send).toBe(true);
  });
});

class FakeNotifier implements Notifier {
  readonly channel = "test";
  sent: ReminderPayload[] = [];
  private n = 0;
  async sendReminder(p: ReminderPayload) {
    this.sent.push(p);
    return [{ chatId: "42", messageId: ++this.n }];
  }
}

describe("runNagTick", () => {
  it("sends due reminders once per interval, most urgent first, capped per tick", async () => {
    const s = setup();
    s.write(
      "projects/ups.md",
      "---\nproject: Homelab\n---\n" +
        "- [ ] Low 📅 2026-11-11 09:00\n" +
        "- [ ] Urgent !p1 📅 2026-11-11 09:00\n" +
        "- [/] Half done 📅 2026-11-11 08:00\n" +
        "  - [x] sub a\n  - [ ] sub b\n" +
        "- [ ] Later 📅 2026-11-11 18:00\n" +
        "- [x] Finished 📅 2026-11-11 08:00\n",
    );
    await s.indexer.indexFile("projects/ups.md");
    const n = new FakeNotifier();
    const r1 = await runNagTick(s.db, n, { ...cfg, maxPerTick: 2 }, Z("2026-11-11T06:05:00Z"));
    expect(r1).toMatchObject({ due: 3, sent: 2 });
    // Same priority → the one overdue longest goes first.
    expect(n.sent.map((p) => p.task.title)).toEqual(["Urgent", "Half done"]);
    expect(n.sent[1]!).toMatchObject({ state: "partial", subtasks: { done: 1, total: 2 } });
    expect(n.sent[0]!).toMatchObject({ projectTitle: "Homelab", notePath: "projects/ups.md", reminderCount: 0 });

    const r2 = await runNagTick(s.db, n, cfg, Z("2026-11-11T06:06:00Z"));
    expect(r2.sent).toBe(1);
    expect(n.sent.at(-1)!).toMatchObject({ state: "overdue", task: { title: "Low" } });

    expect((await runNagTick(s.db, n, cfg, Z("2026-11-11T06:10:00Z"))).sent).toBe(0);
    const r4 = await runNagTick(s.db, n, cfg, Z("2026-11-11T06:21:00Z")); // p1 interval 15m
    expect(n.sent.at(-1)!).toMatchObject({ reminderCount: 1 });
    expect(r4.sent).toBe(1);
    expect(s.db.select().from(remindersLog).all()).toHaveLength(4);
  });
});

describe("applyTaskAction", () => {
  it("partial / snooze / tomorrow / mute update file and DB", async () => {
    const s = setup();
    s.write("a.md", "- [ ] Fix NAS fan 📅 2026-11-11 09:00\n");
    await s.indexer.indexFile("a.md");
    const id = s.db.select().from(tasks).get()!.id;
    const now = Z("2026-11-11T07:00:00Z");

    await applyTaskAction(s.service, id, "p50", { now });
    expect(s.read("a.md")).toMatch(/^- \[\/\] Fix NAS fan/);
    expect(s.service.get(id)).toMatchObject({ status: "in_progress", progress: 50 });

    await applyTaskAction(s.service, id, "snooze1h", { now });
    expect(s.service.get(id).snoozedUntil).toBe("2026-11-11T08:00:00.000Z");

    const r = await applyTaskAction(s.service, id, "tomorrow", { now });
    expect(r.summary).toContain("tomorrow 08:00");
    expect(s.read("a.md")).toMatch(/📅 2026-11-12 08:00/);
    expect(s.service.get(id).snoozedUntil).toBeNull();

    await applyTaskAction(s.service, id, "mute", { now });
    expect(s.service.get(id).snoozedUntil).toBe("2026-11-11T20:59:59.999Z");

    await applyTaskAction(s.service, id, "done", { now });
    expect(s.db.select().from(tasks).where(eq(tasks.id, id)).get()!.status).toBe("done");
  });
});

describe("todayView timezone", () => {
  it("counts a task completed just after local midnight (still 'yesterday' in UTC) as done today", async () => {
    const { todayView } = await import("../src/index.js");
    const s = setup();
    s.write("a.md", "- [ ] Late-night task\n");
    await s.indexer.indexFile("a.md");
    const id = s.db.select().from(tasks).get()!.id;
    // 00:30 Riyadh on the 12th == 21:30 UTC on the 11th
    s.db.update(tasks).set({ status: "done", completedAt: "2026-11-11T21:30:00.000Z" }).where(eq(tasks.id, id)).run();
    const v = todayView(s.db, "Asia/Riyadh", new Date("2026-11-11T21:45:00Z"));
    expect(v.date).toBe("2026-11-12");
    expect(v.completed.map((t) => t.title)).toEqual(["Late-night task"]);
  });
});
