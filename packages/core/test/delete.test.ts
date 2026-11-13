import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { projects, tasks } from "../src/db/schema.js";
import { setup } from "./helpers.js";

describe("delete & undo", () => {
  it("deletes a task with its subtasks and puts it back exactly, same id and remarks", async () => {
    const s = setup();
    s.write("projects/lab.md", "# Lab\n\n- [ ] Before\n- [ ] Rack switch 📅 2026-11-20\n  - [ ] Order rails\n  - [ ] Cable\n- [ ] After\n");
    await s.indexer.fullScan();
    const t = s.db.select().from(tasks).all().find((x) => x.title === "Rack switch")!;
    s.service.addRemark(t.id, "Rails on backorder", "web");
    const before = s.read("projects/lab.md");

    const r = await s.service.delete(t.id);
    expect(r).toMatchObject({ title: "Rack switch", removed: 3 });
    expect(s.read("projects/lab.md")).toMatch(/- \[ \] Before[^\n]*\n- \[ \] After/);
    expect(s.db.select().from(tasks).all().map((x) => x.title).sort()).toEqual(["After", "Before"]);

    await s.service.restore(r.undo!);
    expect(s.read("projects/lab.md")).toBe(before);
    const back = s.service.get(t.id);
    expect(back.remarks.map((x) => x.text)).toEqual(["Rails on backorder"]);
    expect(s.service.children(t.id)).toHaveLength(2);
    await expect(s.service.restore(r.undo!)).rejects.toThrow(/Nothing to undo/);
  });

  it("deletes a note into .trash/ and restores it", async () => {
    const s = setup();
    s.write("inbox/idea.md", "# Idea\n\n- [ ] Try it\n");
    await s.indexer.fullScan();
    const r = await s.service.deleteNote("inbox/idea.md");
    expect(r.trash).toBe(".trash/inbox/idea.md");
    expect(existsSync(join(s.vault.root, "inbox/idea.md"))).toBe(false);
    expect(s.db.select().from(tasks).all()).toHaveLength(0);
    await s.service.restore(r.undo);
    expect(s.read("inbox/idea.md")).toContain("Try it");
    expect(s.db.select().from(tasks).all()).toHaveLength(1);
  });

  it("deleting a project keeps its tasks (moved/untagged) or deletes them", async () => {
    for (const keepTasks of [true, false]) {
      const s = setup();
      await s.service.createProject("Garden");
      await s.service.create({ text: "Buy timber", projectSlug: "garden" }); // goes into projects/garden.md
      await s.service.create({ text: "Paint shed #project/garden" }); // daily note, tagged
      const r = await s.service.deleteProject("garden", { keepTasks });
      expect(s.db.select().from(projects).all()).toHaveLength(0);
      expect(existsSync(join(s.vault.root, ".trash/projects/garden.md"))).toBe(true);
      const left = s.db.select().from(tasks).all();
      if (keepTasks) {
        expect(r).toMatchObject({ tasksKept: 2, tasksDeleted: 0 });
        expect(left.map((t) => t.title).sort()).toEqual(["Buy timber", "Paint shed"]);
        expect(left.every((t) => !t.tags.includes("project/garden") && !t.projectId)).toBe(true);
      } else {
        expect(r).toMatchObject({ tasksKept: 0, tasksDeleted: 2 });
        expect(left).toHaveLength(0);
      }
    }
  });
});
