/**
 * A tiny better-sqlite3-compatible facade over Node's built-in `node:sqlite`.
 *
 * Why: better-sqlite3 is a native addon. On Windows with a Node version it has no prebuilt
 * binary for, `npm install` falls back to node-gyp and needs Visual Studio C++ tools.
 * `node:sqlite` ships with Node (>= 22.16 / 24), so there is nothing to compile anywhere.
 *
 * Drizzle's better-sqlite3 session only uses prepare/run/all/get/raw and transaction(),
 * which is all this class implements.
 */
import { DatabaseSync, type StatementSync } from "node:sqlite";

type SqlValue = null | number | bigint | string | Uint8Array;

function normalise(params: unknown[]): SqlValue[] {
  return params.map((v) => {
    if (v === undefined) return null;
    if (typeof v === "boolean") return v ? 1 : 0;
    if (v instanceof Date) return v.toISOString();
    return v as SqlValue;
  });
}

class Statement {
  private readonly obj: StatementSync;
  private arr?: StatementSync;

  constructor(
    private readonly db: DatabaseSync,
    private readonly sql: string,
  ) {
    this.obj = db.prepare(sql);
  }

  run(...params: unknown[]) {
    return this.obj.run(...normalise(params));
  }
  all(...params: unknown[]) {
    return this.obj.all(...normalise(params));
  }
  get(...params: unknown[]) {
    return this.obj.get(...normalise(params));
  }
  /** Rows as arrays instead of objects (drizzle uses this for column mapping). */
  raw() {
    if (!this.arr) {
      this.arr = this.db.prepare(this.sql);
      this.arr.setReturnArrays(true);
    }
    const a = this.arr;
    return {
      all: (...params: unknown[]) => a.all(...normalise(params)),
      get: (...params: unknown[]) => a.get(...normalise(params)),
    };
  }
}

type TxFn<A extends unknown[], R> = (...args: A) => R;

export class SqliteClient {
  readonly native: DatabaseSync;

  constructor(path: string, opts: { allowExtensions?: boolean } = {}) {
    this.native = new DatabaseSync(path, { allowExtension: opts.allowExtensions ?? false });
  }

  prepare(sql: string): Statement {
    return new Statement(this.native, sql);
  }

  exec(sql: string): void {
    this.native.exec(sql);
  }

  pragma(statement: string): void {
    this.native.exec(`PRAGMA ${statement}`);
  }

  /** Mirrors better-sqlite3: returns a function with .deferred/.immediate/.exclusive variants. */
  transaction<A extends unknown[], R>(fn: TxFn<A, R>) {
    const wrap =
      (mode: "DEFERRED" | "IMMEDIATE" | "EXCLUSIVE") =>
      (...args: A): R => {
        this.native.exec(`BEGIN ${mode}`);
        try {
          const result = fn(...args);
          this.native.exec("COMMIT");
          return result;
        } catch (err) {
          if (this.native.isTransaction) this.native.exec("ROLLBACK");
          throw err;
        }
      };
    const deferred = wrap("DEFERRED");
    return Object.assign(deferred, { deferred, immediate: wrap("IMMEDIATE"), exclusive: wrap("EXCLUSIVE") });
  }

  /** Load a SQLite extension (e.g. sqlite-vec in Phase 4). Requires allowExtensions. */
  loadExtension(path: string): void {
    this.native.loadExtension(path);
  }

  close(): void {
    this.native.close();
  }
}
