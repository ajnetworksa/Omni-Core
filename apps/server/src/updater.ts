/**
 * Settings → Update. The app can't rebuild its own container, so the optional updater helper
 * (docker/updater, COMPOSE_PROFILES=…,updater) does it. They talk through files in data/.update/:
 * the app writes request.json; the helper writes updater.json (heartbeat), status.json and last.log.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export type UpdateKind = "check" | "update";
export interface UpdaterStatus {
  /** The helper is running (heartbeat in the last 20 s). */
  available: boolean;
  /** A request is waiting or running. */
  busy: boolean;
  state: "idle" | "queued" | "running" | "uptodate" | "available" | "updated" | "failed";
  kind: UpdateKind | null;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  /** Last lines of the update script's output. */
  log: string[];
}

export class UpdateBusyError extends Error {}
export class UpdaterMissingError extends Error {}

const HEARTBEAT_MS = 20_000;
const STALE_RUN_MS = 20 * 60_000;

export function updateDir(databasePath: string): string {
  return join(dirname(resolve(databasePath)), ".update");
}

function readJson(path: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}
const str = (v: unknown) => (typeof v === "string" && v ? v : null);

export function updaterStatus(dir: string, now = Date.now()): UpdaterStatus {
  const beat = readJson(join(dir, "updater.json"));
  const beatAt = Date.parse(str(beat?.at) ?? "");
  const available = Number.isFinite(beatAt) && now - beatAt < HEARTBEAT_MS;
  const st = readJson(join(dir, "status.json"));
  const request = readJson(join(dir, "request.json"));
  const queued = !!request || existsSync(join(dir, "request.json"));
  let state = (str(st?.state) ?? "idle") as UpdaterStatus["state"];
  const startedAt = str(st?.startedAt);
  // A run that never finished (helper stopped mid-way) shouldn't block the buttons forever.
  if (state === "running" && (!available || (startedAt && now - Date.parse(startedAt) > STALE_RUN_MS))) state = "failed";
  if (queued) state = "queued";
  let log: string[] = [];
  try {
    log = readFileSync(join(dir, "last.log"), "utf8")
      .replace(/\x1b\[[0-9;]*m/g, "")
      .split("\n")
      .filter((l) => l.trim())
      .slice(-30);
  } catch {
    /* no log yet */
  }
  return {
    available,
    busy: state === "queued" || state === "running",
    state,
    kind: ((queued ? str(request?.kind) : str(st?.kind)) as UpdateKind | null) ?? null,
    startedAt,
    finishedAt: str(st?.finishedAt),
    error: str(st?.error) ?? (state === "failed" && str(st?.state) === "running" ? "The update helper stopped before finishing." : null),
    log,
  };
}

export function requestUpdate(dir: string, kind: UpdateKind, now = Date.now()): UpdaterStatus {
  const s = updaterStatus(dir, now);
  if (!s.available) throw new UpdaterMissingError("The update helper isn't running. Add updater to COMPOSE_PROFILES in .env, then run: docker compose up -d");
  if (s.busy) throw new UpdateBusyError("An update or check is already running.");
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `request.${process.pid}.tmp`);
  writeFileSync(tmp, `${JSON.stringify({ kind, at: new Date(now).toISOString() })}\n`, { mode: 0o666 });
  renameSync(tmp, join(dir, "request.json"));
  return updaterStatus(dir, now);
}
