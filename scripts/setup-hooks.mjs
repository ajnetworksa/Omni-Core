// Runs on `npm install` / `npm ci` ("prepare"): points git at .githooks/ so `git push` runs the
// quick verify first. Does nothing outside a git checkout (Docker builds, CI caches) and never fails.
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
try {
  if (existsSync(".git") && existsSync(".githooks/pre-push") && !process.env.CI) {
    spawnSync("git", ["config", "core.hooksPath", ".githooks"], { stdio: "ignore" });
  }
} catch {
  /* never block an install */
}
