/**
 * Database backups (the vault is plain files; back it up with git, Syncthing or your NAS).
 *
 *   node apps/server/dist/backup.js                 # snapshot → data/backups/app-<time>.db
 *   node apps/server/dist/backup.js --label pre-update-abc123 --keep 10
 *   node apps/server/dist/backup.js --restore data/backups/app-….db   (server must be stopped)
 *   node apps/server/dist/backup.js --list
 *
 * Snapshots use SQLite's online backup API, so they're consistent even while the server runs.
 * Prints the snapshot path on the last line, for scripts.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

const emit = process.emitWarning.bind(process);
process.emitWarning = ((w: string | Error, ...rest: unknown[]) => {
  if ((typeof w === "string" ? w : w.message).includes("SQLite is an experimental feature")) return;
  return (emit as (...a: unknown[]) => void)(w, ...rest);
}) as typeof process.emitWarning;

// Imported after the warning filter above (static imports would run first).
const { backup, DatabaseSync } = await import("node:sqlite");
await import("dotenv/config");
(await import("./privileges.js")).dropPrivileges();
const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const dbPath = resolve(process.env.DATABASE_PATH ?? "./data/app.db");
const dir = resolve(opt("--dir") ?? join(dirname(dbPath), "backups"));
const keep = Number(opt("--keep") ?? 20);

function list(): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /^app-.*\.db$/.test(f))
    .map((f) => join(dir, f))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
}

if (args.includes("--list")) {
  for (const f of list()) console.log(`${basename(f)}\t${(statSync(f).size / 1024).toFixed(0)} KB\t${statSync(f).mtime.toISOString()}`);
  process.exit(0);
}

const restore = opt("--restore");
if (restore) {
  const src = resolve(restore);
  if (!existsSync(src)) throw new Error(`No such backup: ${src}`);
  // Refuse if something holds the database: a write lock means the server is running.
  if (existsSync(dbPath)) {
    const probe = new DatabaseSync(dbPath);
    try {
      probe.exec("PRAGMA busy_timeout = 0; BEGIN IMMEDIATE; ROLLBACK;");
    } catch {
      throw new Error("The database is in use — stop the server before restoring.");
    } finally {
      probe.close();
    }
  }
  const check = new DatabaseSync(src, { readOnly: true });
  const ok = (check.prepare("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check;
  check.close();
  if (ok !== "ok") throw new Error(`Backup failed its integrity check: ${ok}`);
  for (const ext of ["-wal", "-shm"]) rmSync(dbPath + ext, { force: true });
  mkdirSync(dirname(dbPath), { recursive: true });
  copyFileSync(src, dbPath);
  console.log(`restored ${basename(src)} → ${dbPath}`);
  process.exit(0);
}

if (!existsSync(dbPath)) {
  console.log(`no database at ${dbPath} yet — nothing to back up`);
  process.exit(0);
}
mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
const label = (opt("--label") ?? "").replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 60);
const out = join(dir, `app-${stamp}${label ? `-${label}` : ""}.db`);
const db = new DatabaseSync(dbPath);
try {
  await backup(db, out);
} finally {
  db.close();
}
const removed = list().slice(Math.max(1, keep));
for (const f of removed) rmSync(f, { force: true });
console.log(`backup: ${(statSync(out).size / 1024).toFixed(0)} KB${removed.length ? `, pruned ${removed.length} old` : ""}`);
console.log(out);
