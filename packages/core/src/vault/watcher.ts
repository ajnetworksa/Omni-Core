import { watch, type FSWatcher } from "chokidar";
import { Vault } from "./fs.js";
import type { VaultIndexer } from "./indexer.js";

export interface WatcherOptions {
  /** Needed for Docker bind mounts from Windows/macOS hosts, where inotify events don't cross. */
  usePolling?: boolean;
  debounceMs?: number;
  onIndexed?: (rel: string, result: string) => void;
}

/** Watches the vault and re-indexes changed files. Self-writes are no-ops via checksum match. */
export function watchVault(indexer: VaultIndexer, opts: WatcherOptions = {}): FSWatcher {
  const vault = indexer.vault;
  const pending = new Map<string, NodeJS.Timeout>();
  const debounce = opts.debounceMs ?? 200;

  const schedule = (abs: string, kind: "change" | "unlink") => {
    const rel = vault.rel(abs);
    if (!Vault.isMarkdown(rel)) return;
    clearTimeout(pending.get(rel));
    pending.set(
      rel,
      setTimeout(async () => {
        pending.delete(rel);
        try {
          const r = kind === "unlink" ? await indexer.removeFile(rel) : await indexer.indexFile(rel);
          opts.onIndexed?.(rel, r);
        } catch (err) {
          console.error(`[watcher] failed to index ${rel}`, err);
        }
      }, debounce),
    );
  };

  const w = watch(vault.root, {
    ignoreInitial: true,
    ignored: (p: string) => /[\\/](\.obsidian|\.trash|\.git|node_modules)([\\/]|$)/.test(p) || p.endsWith(".omnicore.tmp"),
    usePolling: opts.usePolling ?? false,
    followSymlinks: false, // never index files outside the vault through a symlink
    interval: 1000,
    awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 },
  });
  w.on("add", (p) => schedule(p, "change"));
  w.on("change", (p) => schedule(p, "change"));
  w.on("unlink", (p) => schedule(p, "unlink"));
  return w;
}
