import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { requestUpdate, UpdateBusyError, UpdaterMissingError, updaterStatus, updateDir } from "../src/updater.js";

const dir = () => mkdtempSync(join(tmpdir(), "omni-upd-"));
const beat = (d: string, at = new Date()) => writeFileSync(join(d, "updater.json"), JSON.stringify({ at: at.toISOString() }));

describe("Settings → Update (helper hand-off)", () => {
  it("lives next to the database", () => expect(updateDir("/data/app.db")).toBe("/data/.update"));

  it("refuses without a running helper, and says how to turn it on", () => {
    const d = dir();
    expect(updaterStatus(d)).toMatchObject({ available: false, busy: false, state: "idle" });
    expect(() => requestUpdate(d, "update")).toThrow(UpdaterMissingError);
    beat(d, new Date(Date.now() - 60_000)); // stale heartbeat = helper stopped
    expect(() => requestUpdate(d, "check")).toThrow(/COMPOSE_PROFILES/);
  });

  it("queues one request at a time and reports what the helper wrote", () => {
    const d = dir();
    beat(d);
    expect(requestUpdate(d, "check")).toMatchObject({ available: true, busy: true, state: "queued", kind: "check" });
    expect(JSON.parse(readFileSync(join(d, "request.json"), "utf8")).kind).toBe("check");
    expect(() => requestUpdate(d, "update")).toThrow(UpdateBusyError);

    // the helper picks it up…
    rmSync(join(d, "request.json"));
    writeFileSync(join(d, "status.json"), JSON.stringify({ state: "running", kind: "update", startedAt: new Date().toISOString() }));
    expect(updaterStatus(d)).toMatchObject({ busy: true, state: "running", kind: "update" });
    // …and finishes; the log is shown without colour codes
    writeFileSync(join(d, "status.json"), JSON.stringify({ state: "failed", kind: "update", startedAt: "x", finishedAt: "y", code: 1, error: "xx git fetch failed" }));
    writeFileSync(join(d, "last.log"), "\x1b[1m==>\x1b[0m fetching\n\nxx git fetch failed\n");
    expect(updaterStatus(d)).toMatchObject({ busy: false, state: "failed", error: "xx git fetch failed", log: ["==> fetching", "xx git fetch failed"] });
    // a new request reports its own kind, not the previous run's
    writeFileSync(join(d, "status.json"), JSON.stringify({ state: "updated", kind: "update" }));
    expect(requestUpdate(d, "check")).toMatchObject({ state: "queued", kind: "check" });
  });

  it("a run the helper never finished doesn't block the buttons forever", () => {
    const d = dir();
    beat(d);
    writeFileSync(join(d, "status.json"), JSON.stringify({ state: "running", kind: "update", startedAt: new Date(Date.now() - 30 * 60_000).toISOString() }));
    expect(updaterStatus(d)).toMatchObject({ busy: false, state: "failed" });
  });
});
