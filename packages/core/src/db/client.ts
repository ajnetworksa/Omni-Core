import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { BetterSQLiteSession } from "drizzle-orm/better-sqlite3/session";
import { createTableRelationsHelpers, extractTablesRelationalConfig } from "drizzle-orm/relations";
import { BaseSQLiteDatabase, SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as schema from "./schema.js";
import { SqliteClient } from "./sqlite.js";

export type DB = BetterSQLite3Database<typeof schema> & { $client: SqliteClient };

const DEFAULT_MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../migrations");

/**
 * Opens SQLite (WAL) via the built-in node:sqlite module and wraps it in Drizzle's sync
 * SQLite session. We construct the Drizzle instance by hand because
 * `drizzle-orm/better-sqlite3`'s entry point imports the native better-sqlite3 package at load
 * time. Only the session module is imported at runtime; the database type is import-type only.
 */
export function openDatabase(path: string, opts: { migrationsDir?: string; allowExtensions?: boolean } = {}): DB {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const client = new SqliteClient(path, { allowExtensions: opts.allowExtensions });
  client.pragma("journal_mode = WAL");
  client.pragma("synchronous = NORMAL");
  client.pragma("foreign_keys = ON");
  client.pragma("busy_timeout = 5000");
  runMigrations(client, opts.migrationsDir ?? DEFAULT_MIGRATIONS_DIR);

  const dialect = new SQLiteSyncDialect();
  const tables = extractTablesRelationalConfig(schema, createTableRelationsHelpers);
  const relational = { fullSchema: schema, schema: tables.tables, tableNamesMap: tables.tableNamesMap };
  // The session only calls the better-sqlite3 surface that SqliteClient implements.
  const session = new BetterSQLiteSession(client as never, dialect, relational, {});
  const db = new BaseSQLiteDatabase("sync", dialect, session as never, relational as never) as unknown as DB;
  db.$client = client;
  return db;
}

/** Minimal forward-only migrator: applies migrations/*.sql in filename order, once each. */
export function runMigrations(client: SqliteClient, dir: string): string[] {
  client.exec(
    `CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))`,
  );
  const applied = new Set(
    (client.prepare("SELECT name FROM _migrations").all() as { name: string }[]).map((r) => r.name),
  );
  const pending = readdirSync(dir)
    .filter((f) => f.endsWith(".sql") && !applied.has(f))
    .sort();
  for (const file of pending) {
    const sql = readFileSync(join(dir, file), "utf8");
    client.transaction(() => {
      client.exec(sql);
      client.prepare("INSERT INTO _migrations (name) VALUES (?)").run(file);
    })();
  }
  return pending;
}
