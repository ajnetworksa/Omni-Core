import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { openDatabase, TaskService, Vault, VaultIndexer } from "../src/index.js";

export function setup(opts: { writeAnchors?: boolean; writeDoneDate?: boolean; allowExtensions?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "omnicore-"));
  const vaultDir = join(dir, "vault");
  mkdirSync(vaultDir, { recursive: true });
  const db = openDatabase(":memory:", { migrationsDir: join(import.meta.dirname, "../migrations"), allowExtensions: opts.allowExtensions });
  const vault = new Vault(vaultDir);
  const silent = { info() {}, warn() {}, error() {} };
  const indexer = new VaultIndexer(db, vault, { writeAnchors: opts.writeAnchors ?? true, logger: silent });
  const service = new TaskService(db, indexer, { timeZone: "Asia/Riyadh", writeDoneDate: opts.writeDoneDate ?? true });
  const write = (rel: string, content: string) => {
    const p = join(vaultDir, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content);
  };
  const read = (rel: string) => readFileSync(join(vaultDir, rel), "utf8");
  return { db, vault, indexer, service, write, read };
}
