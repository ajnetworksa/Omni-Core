import { mkdirSync, mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderTaskLine, singleLine, tasks, Vault, VaultPathError } from "../src/index.js";
import { setup } from "./helpers.js";

describe("vault path guard", () => {
  const v = new Vault(mkdtempSync(join(tmpdir(), "vg-")));
  it.each(["../x.md", "a/../../x.md", "/etc/x.md", "C:/x.md", "\\\\server\\x.md", "a\0.md", ""])("rejects %j", (p) => {
    expect(() => v.abs(p)).toThrow(VaultPathError);
  });
  it("refuses writes into protected folders and through symlinks", async () => {
    await expect(v.writeAtomic(".obsidian/x.md", "x")).rejects.toBeInstanceOf(VaultPathError);
    await expect(v.writeAtomic(".git/x.md", "x")).rejects.toBeInstanceOf(VaultPathError);
    const outside = mkdtempSync(join(tmpdir(), "out-"));
    symlinkSync(outside, v.abs("link"), "dir");
    await expect(v.writeAtomic("link/x.md", "x")).rejects.toBeInstanceOf(VaultPathError);
    await expect(v.writeAtomic("link/deeper/new/x.md", "x")).rejects.toBeInstanceOf(VaultPathError);
    mkdirSync(v.abs("ok"), { recursive: true });
    await expect(v.writeAtomic("ok/new/x.md", "x")).resolves.toBeUndefined();
  });
});

describe("markdown injection", () => {
  it("singleLine strips newlines and control characters", () => {
    expect(singleLine("a\r\n- [x] b\u2028c\u0007")).toBe("a - [x] b c");
  });
  it("renderTaskLine can never produce more than one line", () => {
    const l = renderTaskLine({ title: "x\n- [ ] y", tags: ["a\nb"] });
    expect(l.split("\n")).toHaveLength(1);
  });
  it("PATCH-style title updates are single-lined before reaching the file", async () => {
    const s = setup();
    s.write("a.md", "- [ ] Safe\n");
    await s.indexer.indexFile("a.md");
    const id = s.db.select().from(tasks).get()!.id;
    await s.service.update(id, { title: "Renamed\n- [x] injected" });
    expect(s.read("a.md").trim().split("\n")).toHaveLength(1);
    expect(s.db.select().from(tasks).all()).toHaveLength(1);
  });
});

describe("first run", () => {
  it("writes work when the vault folder doesn't exist yet", async () => {
    const v = new Vault(join(mkdtempSync(join(tmpdir(), "fr-")), "not", "yet", "vault"));
    await expect(v.writeAtomic("daily/2026-11-11.md", "x")).resolves.toBeUndefined();
  });
});
