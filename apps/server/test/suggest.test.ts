import { describe, expect, it } from "vitest";
import { suggestFor } from "../../web/src/tg/suggest.js";

const ctx = { today: "2026-11-12", projects: [{ slug: "emo", title: "emo" }, { slug: "home-lab", title: "Home Lab" }], tags: ["homelab", "errand"] };
const ins = (w: string) => suggestFor(w, ctx).map((s) => s.insert || (s.pickDate ? "pick" : ""));

describe("quick-add suggestions (Mini App)", () => {
  it("@ → dates, filtered as you type", () => {
    expect(ins("@")).toEqual(["@today", "@tomorrow", "@+2d", "@+3d", "@+7d", "pick"]);
    expect(ins("@to")).toEqual(["@today", "@tomorrow"]);
    expect(ins("@tom")).toEqual(["@tomorrow"]);
    expect(suggestFor("@", ctx)[1]!.hint).toBe("Fri 13 Nov");
  });
  it("! → priorities", () => {
    expect(ins("!")).toEqual(["!p1", "!p2", "!p3", "!p4"]);
    expect(ins("!p2")).toEqual(["!p2"]);
  });
  it("# → projects, tags, and creating a new project", () => {
    expect(ins("#")).toEqual(["#project/emo", "#project/home-lab", "#homelab", "#errand"]);
    expect(ins("#project/")).toEqual(["#project/emo", "#project/home-lab"]);
    expect(ins("#home")).toEqual(["#project/home-lab", "#homelab", "#project/home"]);
    expect(suggestFor("#project/garden", ctx).map((s) => s.label)).toEqual(["New project “garden”"]);
  });
  it("numbers → times; every → repeats; plain words → nothing", () => {
    expect(ins("9")).toEqual(["09:00", "09:30", "21:00", "21:30"]);
    expect(ins("18:3")).toEqual(["18:30"]);
    expect(ins("25")).toEqual([]);
    expect(ins("ev")).toEqual(["🔁 every day", "🔁 every weekday", "🔁 every week", "🔁 every month"]);
    expect(ins("every w")).toEqual(["🔁 every weekday", "🔁 every week"]);
    expect(ins("battery")).toEqual([]);
  });
});
