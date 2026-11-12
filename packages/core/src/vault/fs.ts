import { mkdirSync, realpathSync } from "node:fs";
import { mkdir, readFile, readdir, realpath, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { uuid } from "../util/hash.js";

const IGNORED_DIRS = new Set([".obsidian", ".trash", ".git", "node_modules", ".omnicore"]);

/** A path that would leave the vault, or target a protected location inside it. */
export class VaultPathError extends Error {}

/** Path-safe access to the vault. All public paths are vault-relative POSIX strings. */
export class Vault {
  readonly root: string;
  private realRoot?: string;
  constructor(root: string) {
    this.root = resolve(root);
  }

  /** Lexical check: relative, no NUL, no `..` segments, stays under root. */
  abs(rel: string): string {
    if (!rel || rel.includes("\0") || /^[a-zA-Z]:/.test(rel) || rel.startsWith("/") || rel.startsWith("\\")) {
      throw new VaultPathError(`Invalid vault path: ${JSON.stringify(rel)}`);
    }
    if (rel.split(/[\\/]/).includes("..")) throw new VaultPathError(`Path escapes vault: ${rel}`);
    const p = resolve(this.root, rel);
    if (p !== this.root && !p.startsWith(this.root + sep)) throw new VaultPathError(`Path escapes vault: ${rel}`);
    return p;
  }

  /**
   * For writes: lexical check, no protected dirs, and the nearest existing ancestor must
   * resolve (after symlinks) inside the real vault root.
   */
  private async writablePath(rel: string): Promise<string> {
    const p = this.abs(rel);
    if (Vault.isIgnored(this.rel(p))) throw new VaultPathError(`Protected location: ${rel}`);
    if (!this.realRoot) {
      mkdirSync(this.root, { recursive: true }); // first run: vault folder may not exist yet
      this.realRoot = realpathSync(this.root);
    }
    let probe = dirname(p);
    for (;;) {
      try {
        const real = await realpath(probe);
        if (real !== this.realRoot && !real.startsWith(this.realRoot + sep)) throw new VaultPathError(`Path escapes vault via symlink: ${rel}`);
        break;
      } catch (e) {
        if (e instanceof VaultPathError) throw e;
        const up = dirname(probe);
        if (up === probe) break;
        probe = up;
      }
    }
    return p;
  }

  rel(abs: string): string {
    return relative(this.root, abs).split(sep).join("/");
  }

  static isIgnored(rel: string): boolean {
    return rel.split("/").some((seg) => IGNORED_DIRS.has(seg));
  }

  static isMarkdown(rel: string): boolean {
    return rel.toLowerCase().endsWith(".md") && !Vault.isIgnored(rel);
  }

  async read(rel: string): Promise<string> {
    return readFile(this.abs(rel), "utf8");
  }

  async exists(rel: string): Promise<boolean> {
    try {
      await stat(this.abs(rel));
      return true;
    } catch {
      return false;
    }
  }

  /** Write via temp file + rename so Obsidian / watchers never observe a half-written file. */
  async writeAtomic(rel: string, content: string): Promise<void> {
    const target = await this.writablePath(rel);
    await mkdir(dirname(target), { recursive: true });
    const tmp = join(dirname(target), `.${uuid()}.omnicore.tmp`);
    await writeFile(tmp, content, "utf8");
    await rename(tmp, target);
  }

  /** Binary write (attachments), same temp + rename strategy. */
  async writeBinaryAtomic(rel: string, data: Uint8Array): Promise<void> {
    const target = await this.writablePath(rel);
    await mkdir(dirname(target), { recursive: true });
    const tmp = join(dirname(target), `.${uuid()}.omnicore.tmp`);
    await writeFile(tmp, data);
    await rename(tmp, target);
  }

  async listMarkdown(): Promise<string[]> {
    const out: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (e.isDirectory()) {
          if (!IGNORED_DIRS.has(e.name)) await walk(join(dir, e.name));
        } else if (e.isFile() && e.name.toLowerCase().endsWith(".md")) {
          out.push(this.rel(join(dir, e.name)));
        }
      }
    };
    await walk(this.root);
    return out.sort();
  }
}
