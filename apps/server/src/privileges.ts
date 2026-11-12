import { chownSync, existsSync, lstatSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/**
 * Docker starts the app as root. Before anything else, boot.ts calls this to create the data
 * and vault folders, give them to the app user and switch to that user, so there's no
 * host-side setup (no chown, no PUID needed).
 *
 * The app user is PUID/PGID if set, otherwise whoever owns the vault folder on the host
 * (1000 when Docker has just created it as root). Outside the Docker image, or when not root, nothing happens.
 */
export function prepareAndDropPrivileges(env: NodeJS.ProcessEnv = process.env): { uid: number; gid: number } | undefined {
  if (!isRoot()) return undefined;
  const dataDir = dirname(resolve(env.DATABASE_PATH ?? "./data/app.db"));
  const vault = resolve(env.VAULT_PATH ?? "./vault");
  const dirs = [dataDir, vault, ...(existsSync("/config") ? ["/config"] : [])];
  for (const d of [dataDir, ...["daily", "inbox", "projects", "attachments"].map((s) => join(vault, s))]) mkdirSync(d, { recursive: true });

  const vaultOwner = statSync(vault);
  const uid = num(env.PUID) ?? (vaultOwner.uid !== 0 ? vaultOwner.uid : 1000);
  const gid = num(env.PGID) ?? (vaultOwner.uid !== 0 ? vaultOwner.gid : uid);
  for (const d of dirs) {
    const st = statSync(d);
    if (st.uid !== uid || st.gid !== gid) chownTree(d, uid, gid);
  }
  switchTo(uid, gid);
  return { uid, gid };
}

/**
 * For one-off commands run as root (`docker compose exec omnicore-app node …backup.js`), which
 * skip boot.ts: become the owner of the data folder so new files aren't root-owned on the host.
 */
export function dropPrivileges(env: NodeJS.ProcessEnv = process.env): void {
  if (!isRoot()) return;
  const dataDir = dirname(resolve(env.DATABASE_PATH ?? "./data/app.db"));
  if (!existsSync(dataDir)) return;
  const st = statSync(dataDir);
  if (st.uid !== 0) switchTo(st.uid, st.gid);
}

/** Only inside the OmniCore image (it sets OMNICORE_DOCKER=1): a root install outside Docker is left alone. */
const isRoot = () => process.env.OMNICORE_DOCKER === "1" && typeof process.getuid === "function" && process.getuid() === 0;
const num = (v: string | undefined) => (v && /^\d+$/.test(v.trim()) ? Number(v.trim()) : undefined);

function switchTo(uid: number, gid: number) {
  if (uid === 0) return;
  process.setgroups?.([]);
  process.setgid!(gid);
  process.setuid!(uid);
  process.env.HOME = "/tmp";
}

function chownTree(path: string, uid: number, gid: number) {
  chownSync(path, uid, gid);
  if (!lstatSync(path).isDirectory()) return;
  for (const name of readdirSync(path)) {
    const p = join(path, name);
    if (lstatSync(p).isSymbolicLink()) continue;
    chownTree(p, uid, gid);
  }
}
