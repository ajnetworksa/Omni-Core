import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { noteLinks, notes, projects, rollover, TaskLineConflictError, tasks, todayInTz, todayView } from "../src/index.js";
import { setup } from "./helpers.js";

describe("indexer", () => {
  it("indexes tasks, stamps anchors, and is idempotent", async () => {
    const s = setup();
    s.write("inbox/a.md", "# A\n\n- [ ] First\n- [x] Second\n");
    expect(await s.indexer.indexFile("inbox/a.md")).toBe("indexed");
    const text = s.read("inbox/a.md");
    expect(text).toMatch(/^- \[ \] First \^oc-[a-z0-9]{8}$/m);
    expect(text).toMatch(/^- \[x\] Second \^oc-[a-z0-9]{8}$/m);
    expect(await s.indexer.indexFile("inbox/a.md")).toBe("unchanged");
    const rows = s.db.select().from(tasks).all();
    expect(rows.map((r) => [r.title, r.status])).toEqual([["First", "ready"], ["Second", "done"]]);
  });

  it("keeps task ids and DB-only state across external edits", async () => {
    const s = setup();
    s.write("a.md", "- [ ] Alpha\n- [ ] Beta\n");
    await s.indexer.indexFile("a.md");
    const beta = s.db.select().from(tasks).where(eq(tasks.title, "Beta")).get()!;
    s.service.addRemark(beta.id, "Awaiting parts", "telegram");

    // User inserts a line above, renames Beta and ticks it in Obsidian.
    const edited = s.read("a.md").replace("- [ ] Beta", "- [x] Beta renamed");
    s.write("a.md", "- [ ] New top\n" + edited);
    await s.indexer.indexFile("a.md");

    const after = s.db.select().from(tasks).where(eq(tasks.id, beta.id)).get()!;
    expect(after.title).toBe("Beta renamed");
    expect(after.status).toBe("done");
    expect(after.completedAt).toBeTruthy();
    expect(after.remarks[0]!.text).toBe("Awaiting parts");
    expect(s.db.select().from(tasks).all()).toHaveLength(3);
  });

  it("matches anchor-less tasks by text when anchors are disabled", async () => {
    const s = setup({ writeAnchors: false });
    s.write("a.md", "- [ ] Alpha\n");
    await s.indexer.indexFile("a.md");
    const id = s.db.select().from(tasks).get()!.id;
    s.write("a.md", "intro\n\n- [x] Alpha\n");
    await s.indexer.indexFile("a.md");
    expect(s.db.select().from(tasks).get()!).toMatchObject({ id, status: "done", lineNumber: 2 });
    expect(s.read("a.md")).not.toContain("^oc-");
  });

  it("deletes tasks removed from the file and notes removed from disk", async () => {
    const s = setup();
    s.write("a.md", "- [ ] One\n- [ ] Two\n");
    await s.indexer.indexFile("a.md");
    s.write("a.md", s.read("a.md").split("\n").slice(1).join("\n"));
    await s.indexer.indexFile("a.md");
    expect(s.db.select().from(tasks).all().map((t) => t.title)).toEqual(["Two"]);
    await s.indexer.removeFile("a.md");
    expect(s.db.select().from(tasks).all()).toHaveLength(0);
  });

  it("resolves wikilinks, including ones that were dangling", async () => {
    const s = setup();
    s.write("a.md", "Links to [[B]] and [[Nowhere]]\n");
    await s.indexer.fullScan();
    expect(s.db.select().from(noteLinks).all().every((l) => l.targetNoteId === null)).toBe(true);
    s.write("b.md", "I am B\n");
    await s.indexer.indexFile("b.md");
    const b = s.db.select().from(notes).where(eq(notes.path, "b.md")).get()!;
    const link = s.db.select().from(noteLinks).where(eq(noteLinks.targetTitle, "B")).get()!;
    expect(link.targetNoteId).toBe(b.id);
  });

  it("assigns projects from frontmatter and #project/ tags", async () => {
    const s = setup();
    s.write("p.md", "---\nproject: Homelab\n---\n- [ ] From fm\n- [ ] Override #project/bigbomb\n");
    await s.indexer.indexFile("p.md");
    const slugs = Object.fromEntries(s.db.select().from(projects).all().map((p) => [p.id, p.slug]));
    const t = s.db.select().from(tasks).all();
    expect(t.map((x) => slugs[x.projectId!])).toEqual(["homelab", "bigbomb"]);
  });
});

describe("write-back", () => {
  it("toggling status rewrites only the checkbox char and preserves CRLF", async () => {
    const s = setup();
    s.write("a.md", "---\r\ntitle: X\r\n---\r\n- [ ] Keep   odd  spacing #tag\r\nfooter\r\n");
    await s.indexer.indexFile("a.md");
    const before = s.read("a.md");
    const t = s.db.select().from(tasks).get()!;
    await s.service.update(t.id, { status: "done" });
    const after = s.read("a.md");
    const today = todayInTz("Asia/Riyadh");
    expect(after).toBe(before.replace("- [ ] Keep", "- [x] Keep").replace(" ^oc-", ` ✅ ${today} ^oc-`));
    expect(s.service.get(t.id).status).toBe("done");
    // Re-opening removes the completion date again.
    await s.service.update(t.id, { status: "ready" });
    expect(s.read("a.md")).toBe(before);
  });

  it("with done-dates disabled, completing flips only the checkbox", async () => {
    const s = setup({ writeDoneDate: false });
    s.write("a.md", "- [ ] Exact\n");
    await s.indexer.indexFile("a.md");
    const before = s.read("a.md");
    await s.service.update(s.db.select().from(tasks).get()!.id, { status: "done" });
    expect(s.read("a.md")).toBe(before.replace("[ ]", "[x]"));
  });

  it("finds the line by anchor after it moved, and keeps fine-grained statuses", async () => {
    const s = setup();
    s.write("a.md", "- [ ] Target\n");
    await s.indexer.indexFile("a.md");
    const t = s.db.select().from(tasks).get()!;
    s.write("a.md", "# Heading\n\nprose\n\n" + s.read("a.md"));
    // Simulate the watcher not having fired yet: DB still has the old lineNumber.
    await s.service.update(t.id, { status: "backlog" });
    expect(s.service.get(t.id).status).toBe("backlog");
    await s.service.update(t.id, { status: "blocked" });
    expect(s.read("a.md")).toMatch(/^- \[!\] Target/m);
  });

  it("rewrites metadata when due date / priority change", async () => {
    const s = setup();
    s.write("a.md", "  - [ ] Thing !p3 #x\n");
    await s.indexer.indexFile("a.md");
    const t = s.db.select().from(tasks).get()!;
    await s.service.update(t.id, { dueDate: "2026-12-01", priority: 1 });
    expect(s.read("a.md")).toMatch(/^ {2}- \[ \] Thing !p1 📅 2026-12-01 #x \^oc-/m);
    expect(s.service.get(t.id)).toMatchObject({ dueDate: "2026-12-01", priority: 1 });
  });

  it("raises a conflict when the line can't be found", async () => {
    const s = setup({ writeAnchors: false });
    s.write("a.md", "- [ ] Gone soon\n");
    await s.indexer.indexFile("a.md");
    const t = s.db.select().from(tasks).get()!;
    s.write("a.md", "- [ ] Something else entirely\n");
    await expect(s.service.update(t.id, { status: "done" })).rejects.toBeInstanceOf(TaskLineConflictError);
  });

  it("creates tasks in today's daily note under ## Tasks", async () => {
    const s = setup();
    const t1 = await s.service.create({ text: "Replace UPS battery !p1 @today #homelab" });
    const t2 = await s.service.create({ text: "Second one", projectSlug: "Homelab" });
    const today = todayInTz("Asia/Riyadh");
    const file = s.read(`daily/${today}.md`);
    expect(file).toContain("tags: [daily]");
    const lines = file.split("\n");
    const h = lines.indexOf("## Tasks");
    expect(lines[h + 1]).toMatch(new RegExp(`^- \\[ \\] Replace UPS battery !p1 📅 ${today} #homelab \\^oc-`));
    expect(lines[h + 2]).toMatch(/^- \[ \] Second one #project\/homelab \^oc-/);
    expect(t1).toMatchObject({ title: "Replace UPS battery", priority: 1, dueDate: today });
    expect(t2.projectId).toBeTruthy();
  });
});

describe("rollover", () => {
  it("moves open overdue tasks forward, bumps the count, and writes the date to disk", async () => {
    const s = setup();
    s.write("a.md", "- [ ] Late 📅 2026-11-10\n- [x] Done 📅 2026-11-10\n- [ ] Future 📅 2026-11-20\n");
    await s.indexer.indexFile("a.md");
    const r = await rollover(s.db, s.service, { fromDate: "2026-11-11", toDate: "2026-11-12" });
    expect(r.migrated).toHaveLength(1);
    const late = s.db.select().from(tasks).where(eq(tasks.title, "Late")).get()!;
    expect(late).toMatchObject({ dueDate: "2026-11-12", rolloverCount: 1 });
    expect(s.read("a.md")).toMatch(/^- \[ \] Late 📅 2026-11-12 \^oc-/m);
    // Re-index from disk must not undo it.
    s.write("a.md", s.read("a.md") + "\n");
    await s.indexer.indexFile("a.md");
    expect(s.db.select().from(tasks).where(eq(tasks.id, late.id)).get()).toMatchObject({ dueDate: "2026-11-12", rolloverCount: 1 });
  });

  it("todayView buckets overdue, due today and pinned", async () => {
    const s = setup();
    const today = todayInTz("Asia/Riyadh");
    s.write("a.md", `- [ ] Old 📅 2020-01-01\n- [ ] Now 📅 ${today}\n- [ ] Pin me\n`);
    await s.indexer.indexFile("a.md");
    const pin = s.db.select().from(tasks).where(eq(tasks.title, "Pin me")).get()!;
    await s.service.update(pin.id, { pinned: true });
    const v = todayView(s.db, "Asia/Riyadh");
    expect([v.overdue, v.dueToday, v.pinned].map((b) => b.map((t) => t.title))).toEqual([["Old"], ["Now"], ["Pin me"]]);
  });
});

describe("anchor collisions", () => {
  const anchorOf = (s: string, title: string) => s.split("\n").find((l) => l.includes(title))!.match(/\^(oc-[a-z0-9]+)/)![1];

  it("copy-pasting a task line inside one file gives the copy a fresh anchor", async () => {
    const s = setup();
    s.write("a.md", "- [ ] Original\n");
    await s.indexer.indexFile("a.md");
    const line = s.read("a.md").trim();
    s.write("a.md", `${line}\n${line.replace("Original", "Copy")}\n`);
    expect(await s.indexer.indexFile("a.md")).toBe("indexed");
    const [l1, l2] = s.read("a.md").trim().split("\n");
    expect(anchorOf(l1!, "Original")).not.toBe(anchorOf(l2!, "Copy"));
    expect(s.db.select().from(tasks).all()).toHaveLength(2);
  });

  it("copying a line into another note keeps both tasks", async () => {
    const s = setup();
    s.write("a.md", "- [ ] Shared\n");
    await s.indexer.indexFile("a.md");
    s.write("b.md", s.read("a.md"));
    expect(await s.indexer.indexFile("b.md")).toBe("indexed");
    expect(anchorOf(s.read("a.md"), "Shared")).not.toBe(anchorOf(s.read("b.md"), "Shared"));
    expect(s.db.select().from(tasks).all()).toHaveLength(2);
  });

  it.each(["dest-first", "source-first"])("moving a line (cut, then paste; %s) keeps the task id and its DB-only state", async (order) => {
    const s = setup();
    s.write("a.md", "- [ ] Mover\n- [ ] Stays\n");
    await s.indexer.indexFile("a.md");
    const mover = s.db.select().from(tasks).where(eq(tasks.title, "Mover")).get()!;
    s.service.addRemark(mover.id, "keep me", "web");
    const line = s.read("a.md").split("\n")[0]!;
    s.write("a.md", s.read("a.md").replace(line + "\n", "")); // cut (source saved first)
    s.write("b.md", `# B\n${line}\n`); // paste
    await s.indexer.indexFile(order === "dest-first" ? "b.md" : "a.md");
    await s.indexer.indexFile(order === "dest-first" ? "a.md" : "b.md");
    const after = s.db.select().from(tasks).where(eq(tasks.title, "Mover")).all();
    expect(after).toHaveLength(1);
    expect(after[0]!.id).toBe(mover.id);
    expect(after[0]!.remarks[0]!.text).toBe("keep me");
    const b = s.db.select().from(notes).where(eq(notes.path, "b.md")).get()!;
    expect(after[0]!.noteId).toBe(b.id);
  });

  it("concurrent indexing of the cut and paste files never loses the task (race regression)", async () => {
    for (let round = 0; round < 25; round++) {
      const s = setup();
      s.write("a.md", "# A\n- [ ] Racer\n- [ ] Other\n");
      await s.indexer.indexFile("a.md");
      const racer = s.db.select().from(tasks).where(eq(tasks.title, "Racer")).get()!;
      const line = s.read("a.md").split("\n")[1]!;
      s.write("a.md", s.read("a.md").replace(line + "\n", ""));
      s.write("b.md", `# B\n${line}\n`);
      // Exactly what the watcher does: both debounced events fire at about the same time.
      const order = round % 2 ? ["a.md", "b.md"] : ["b.md", "a.md"];
      await Promise.all(order.map((f) => s.indexer.indexFile(f)));
      const after = s.db.select().from(tasks).where(eq(tasks.title, "Racer")).all();
      expect(after.map((t) => t.id)).toEqual([racer.id]);
    }
  });

  it("renaming a file (unlink + add) keeps task ids and remarks", async () => {
    const s = setup();
    s.write("old.md", "- [ ] Survivor\n");
    await s.indexer.indexFile("old.md");
    const t = s.db.select().from(tasks).get()!;
    s.service.addRemark(t.id, "still here", "web");
    s.write("new.md", s.read("old.md"));
    await s.indexer.removeFile("old.md");
    await s.indexer.indexFile("new.md");
    const after = s.db.select().from(tasks).all();
    expect(after.map((x) => [x.id, x.remarks.length])).toEqual([[t.id, 1]]);
  });

  it("without anchors enabled, duplicates never break indexing", async () => {
    const s = setup({ writeAnchors: false });
    s.write("a.md", "- [ ] X ^oc-same0001\n- [ ] Y ^oc-same0001\n");
    expect(await s.indexer.indexFile("a.md")).toBe("indexed");
    expect(s.db.select().from(tasks).all()).toHaveLength(2);
  });
});
