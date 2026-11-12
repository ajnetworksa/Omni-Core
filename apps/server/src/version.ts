/**
 * What's running, and whether GitHub has something newer.
 *
 * Version comes from the root package.json. The commit comes from OMNICORE_GIT_SHA (set at
 * image build time) or, for a git checkout, from .git directly — no git binary needed.
 * The update check is opt-in: set UPDATE_CHECK_REPO=owner/repo.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

function readGitSha(): string | null {
  try {
    const git = join(ROOT, ".git");
    if (!existsSync(git)) return null;
    const head = readFileSync(join(git, "HEAD"), "utf8").trim();
    if (!head.startsWith("ref: ")) return /^[0-9a-f]{40}$/.test(head) ? head : null;
    const ref = head.slice(5);
    const loose = join(git, ref);
    if (existsSync(loose)) return readFileSync(loose, "utf8").trim();
    const packed = readFileSync(join(git, "packed-refs"), "utf8");
    return packed.split("\n").find((l) => l.endsWith(` ${ref}`))?.split(" ")[0] ?? null;
  } catch {
    return null;
  }
}

function readVersion(): string {
  try {
    return (JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { version: string }).version;
  } catch {
    return "0.0.0";
  }
}

const envSha = process.env.OMNICORE_GIT_SHA;
export const VERSION = {
  version: readVersion(),
  sha: (envSha && envSha !== "unknown" ? envSha : readGitSha())?.slice(0, 12) ?? null,
  builtAt: process.env.OMNICORE_BUILT_AT || null,
  startedAt: new Date().toISOString(),
};

/** 1.2.10 > 1.2.9; "v" prefixes and pre-release tails are tolerated. */
export function newerThan(a: string, b: string): boolean {
  const parse = (v: string) => v.replace(/^v/, "").split(/[-+]/)[0]!.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i++) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  }
  return false;
}

export interface LatestRelease {
  version: string;
  url: string;
  publishedAt: string | null;
  notes: string;
}

const state: { latest: LatestRelease | null; checkedAt: string | null; error: string | null } = { latest: null, checkedAt: null, error: null };

export function updateInfo() {
  return {
    ...VERSION,
    latest: state.latest,
    checkedAt: state.checkedAt,
    checkError: state.error,
    updateAvailable: !!state.latest && newerThan(state.latest.version, VERSION.version),
  };
}

/** Ask GitHub for the newest release (falls back to the newest tag). Never throws. */
export async function checkForUpdate(repo: string, apiRoot = "https://api.github.com"): Promise<LatestRelease | null> {
  const headers = { accept: "application/vnd.github+json", "user-agent": `omnicore/${VERSION.version}` };
  try {
    const base = `${apiRoot.replace(/\/+$/, "")}/repos/${repo}`;
    let latest: LatestRelease | null = null;
    const rel = await fetch(`${base}/releases/latest`, { headers, signal: AbortSignal.timeout(10_000) });
    if (rel.ok) {
      const r = (await rel.json()) as { tag_name: string; html_url: string; published_at: string | null; body: string | null };
      latest = { version: r.tag_name.replace(/^v/, ""), url: r.html_url, publishedAt: r.published_at, notes: (r.body ?? "").slice(0, 2000) };
    } else if (rel.status === 404) {
      const tags = await fetch(`${base}/tags?per_page=30`, { headers, signal: AbortSignal.timeout(10_000) });
      if (!tags.ok) throw new Error(`GitHub ${tags.status}`);
      const list = ((await tags.json()) as { name: string }[]).map((t) => t.name).filter((n) => /^v?\d+\.\d+\.\d+/.test(n));
      const top = list.sort((a, b) => (newerThan(a, b) ? -1 : newerThan(b, a) ? 1 : 0))[0];
      if (top) latest = { version: top.replace(/^v/, ""), url: `https://github.com/${repo}/releases/tag/${top}`, publishedAt: null, notes: "" };
    } else {
      throw new Error(`GitHub ${rel.status}`);
    }
    state.latest = latest;
    state.error = null;
    return latest;
  } catch (e) {
    state.error = (e as Error).message;
    return null;
  } finally {
    state.checkedAt = new Date().toISOString();
  }
}
