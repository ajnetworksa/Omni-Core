import { describe, expect, it } from "vitest";
import { parseNote, parseQuickAdd, setLineCheckbox, statusFromChar } from "../src/index.js";

const NOTE = `---
title: Core Switch Upgrade
project: Homelab
tags: [network]
---
# Plan

See [[Network Map]] and [[Vendors#Juniper|juniper]].

- [ ] Order SFP modules !p1 📅 2026-11-12 14:00 #network ^oc-aaaa1111
  - [x] Compare vendors
  - [/] Get quote
- [-] Cancelled thing
* [ ] Star bullet

\`\`\`md
- [ ] not a task inside a fence
[[Not A Link]]
\`\`\`

1. [ ] Numbered task
`;

describe("parseNote", () => {
  const n = parseNote("projects/core-switch.md", NOTE);

  it("reads frontmatter title and project", () => {
    expect(n.title).toBe("Core Switch Upgrade");
    expect(n.frontmatter.project).toBe("Homelab");
  });

  it("extracts tasks with absolute line numbers, skipping fences", () => {
    expect(n.tasks.map((t) => t.title)).toEqual([
      "Order SFP modules",
      "Compare vendors",
      "Get quote",
      "Cancelled thing",
      "Star bullet",
      "Numbered task",
    ]);
    expect(n.tasks[0]!.line).toBe(9);
    expect(NOTE.split("\n")[9]).toBe(n.tasks[0]!.rawLine);
  });

  it("parses inline metadata", () => {
    const t = n.tasks[0]!;
    expect(t).toMatchObject({ priority: 1, dueDate: "2026-11-12", dueTime: "14:00", tags: ["network"], anchor: "oc-aaaa1111" });
  });

  it("maps statuses and nesting", () => {
    expect(n.tasks.map((t) => t.status)).toEqual(["ready", "done", "in_progress", "cancelled", "ready", "ready"]);
    expect(n.tasks[1]!.parentOrdinal).toBe(0);
    expect(n.tasks[2]!.parentOrdinal).toBe(0);
    expect(n.tasks[3]!.parentOrdinal).toBeUndefined();
  });

  it("extracts wikilinks with headings, ignoring fenced ones", () => {
    expect(n.links.map((l) => [l.target, l.heading])).toEqual([
      ["Network Map", undefined],
      ["Vendors", "Juniper"],
    ]);
  });

  it("handles CRLF files", () => {
    const crlf = parseNote("a.md", "- [ ] one\r\n- [x] two\r\n");
    expect(crlf.eol).toBe("\r\n");
    expect(crlf.tasks.map((t) => t.rawLine)).toEqual(["- [ ] one", "- [x] two"]);
  });

  it("falls back to filename for title and survives broken YAML", () => {
    const b = parseNote("inbox/Quick Idea.md", "---\nfoo: [unclosed\n---\n- [ ] x\n");
    expect(b.title).toBe("Quick Idea");
    expect(b.tasks).toHaveLength(1);
  });
});

describe("line helpers", () => {
  it("flips only the checkbox char", () => {
    const l = "    - [ ] Do the thing [not a box] ^oc-1";
    expect(setLineCheckbox(l, "x")).toBe("    - [x] Do the thing [not a box] ^oc-1");
  });
  it("unknown markers count as done", () => {
    expect(statusFromChar(">")).toBe("done");
  });
});

describe("parseQuickAdd", () => {
  const now = new Date("2026-11-11T22:30:00Z"); // 01:30 on the 12th in Riyadh
  it("resolves @today in the configured timezone", () => {
    expect(parseQuickAdd("Call ISP @today !p2", "Asia/Riyadh", now)).toMatchObject({ title: "Call ISP", dueDate: "2026-11-12", priority: 2 });
  });
  it("supports @tomorrow with a time and @+Nd", () => {
    expect(parseQuickAdd("Backup @tomorrow 08:00", "Asia/Riyadh", now)).toMatchObject({ dueDate: "2026-11-13", dueTime: "08:00" });
    expect(parseQuickAdd("Renew cert @+7d", "Asia/Riyadh", now).dueDate).toBe("2026-11-19");
  });
});
