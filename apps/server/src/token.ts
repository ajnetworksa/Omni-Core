import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Config } from "./config.js";
import { isLoopback } from "./security.js";

/**
 * When the app listens beyond localhost (Docker) and API_TOKEN isn't set, use a random password
 * kept next to the database (data/api-token), created on first start. Nobody has to generate
 * one by hand, and the API is never left open by accident. The password itself is never logged.
 */
export function ensureApiToken(config: Config): { path: string; created: boolean } | undefined {
  if (config.API_TOKEN || isLoopback(config.HOST)) return undefined;
  const path = join(dirname(config.DATABASE_PATH), "api-token");
  let created = false;
  let token = existsSync(path) ? readFileSync(path, "utf8").trim() : "";
  if (token.length < 16) {
    token = randomBytes(24).toString("base64url");
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, token + "\n", { mode: 0o600 });
    chmodSync(path, 0o600);
    created = true;
  }
  config.API_TOKEN = token;
  return { path, created };
}
