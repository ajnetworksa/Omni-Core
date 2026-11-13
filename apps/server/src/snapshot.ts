import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

/** Database snapshots from inside the running app (Settings → Back up now). Same files as backup.js. */
export function backupDir(dbPath: string) {
  return join(dirname(resolve(dbPath)), "backups");
}

export function listBackups(dbPath: string) {
  const dir = backupDir(dbPath);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /^app-.*\.db$/.test(f))
    .map((f) => {
      const st = statSync(join(dir, f));
      return { name: f, bytes: st.size, at: st.mtime.toISOString() };
    })
    .sort((a, b) => b.at.localeCompare(a.at));
}

export async function backupNow(dbPath: string, label = "manual", keep = 20) {
  const { backup, DatabaseSync } = await import("node:sqlite");
  const dir = backupDir(dbPath);
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
  const out = join(dir, `app-${stamp}-${label.replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 40)}.db`);
  // Own short-lived connection (SQLite's online backup is consistent while the app keeps writing).
  const src = new DatabaseSync(resolve(dbPath));
  try {
    await backup(src, out);
  } finally {
    src.close();
  }
  for (const old of listBackups(dbPath).slice(Math.max(1, keep))) rmSync(join(dir, old.name), { force: true });
  return { name: basename(out), bytes: statSync(out).size };
}
