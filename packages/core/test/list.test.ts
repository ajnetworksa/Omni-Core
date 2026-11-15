import { describe, expect, it } from "vitest";
import { tasks } from "../src/db/schema.js";
import { parsePreview, splitTaskList } from "../src/index.js";
import { setup } from "./helpers.js";

describe("typed lists become separate tasks", () => {
  it.each([
    ["1. Buy milk 2. Call ISP @tomorrow", ["Buy milk", "Call ISP @tomorrow"]],
    ["1 buy milk 2 call ISP 3 fix router !p1", ["buy milk", "call ISP", "fix router !p1"]],
    ["1) a 2) b", ["a", "b"]],
    ["1.milk 2.eggs 3.bread", ["milk", "eggs", "bread"]],
    ["1. a\n2. b", ["a", "b"]],
    ["Groceries:\n- milk\n- eggs", ["milk", "eggs"]],
    ["- [ ] x\n- [ ] y", ["x", "y"]],
    ["line one\nline two", ["line one", "line two"]],
  ])("%j → %j", (input, out) => expect(splitTaskList(input)).toEqual(out));

  it.each(["1 hour meeting", "Buy 2 apples", "Call 1 2 3", "1.5kg rice", "3. eggs", "1. a 2) b", "Meet at 1. Then 2. done", "Order SFP modules !p1 @today"])(
    "leaves %j as one task",
    (input) => expect(splitTaskList(input)).toEqual([input]),
  );

  it("caps a list at 30 items and ignores empty input", () => {
    expect(splitTaskList(Array.from({ length: 40 }, (_, i) => `t${i}`).join("\n"))).toHaveLength(30);
    expect(splitTaskList("   ")).toEqual([]);
  });

  it("previews the list and createMany writes one line per item, each with its own date", async () => {
    const s = setup();
    expect(parsePreview("1. Buy milk 2. Call ISP !p1", "Asia/Riyadh").items).toEqual(["Buy milk", "Call ISP"]);
    expect(parsePreview("Buy milk", "Asia/Riyadh").items).toBeNull();
    const made = await s.service.createMany({ text: "1. Buy milk 📅 2026-12-01 2. Call ISP !p1" });
    expect(made.map((t) => [t.title, t.dueDate, t.priority])).toEqual([["Buy milk", "2026-12-01", 4], ["Call ISP", null, 1]]);
    expect(s.db.select().from(tasks).all()).toHaveLength(2);
    const one = await s.service.createMany({ text: "Just one" });
    expect(one.map((t) => t.title)).toEqual(["Just one"]);
  });
});
