# Decisions

Short records of choices that aren't obvious from the code. Newest last. Add one when you choose
between real alternatives, so the next person (or AI) doesn't undo it by accident.

### D1 · Markdown is the source of truth (Phase 1)
SQLite is an index. Every write goes file-first through `TaskService` under a per-file lock, then re-indexes.
**Why:** Obsidian parity and data ownership; the DB can always be rebuilt.
**Cost:** writes are slower than a DB update, and concurrent external edits need the lock + re-locate logic.

### D2 · Block anchors for task identity
Each task line gets `^oc-xxxxxxxx` (Obsidian's own block-id syntax). Line number + checksum is the fallback.
**Why:** tasks survive edits, moves and reordering; Obsidian shows no junk.

### D3 · Obsidian Tasks syntax (`📅 🔁 ✅ !pN`)
**Why:** the vault stays compatible with the most popular Obsidian task plugin.

### D4 · `node:sqlite` instead of better-sqlite3
**Why:** better-sqlite3 failed to install on Windows (it needs a native build toolchain). Node's built-in SQLite has no native modules.
**Cost:** Node ≥ 22.16, and an ExperimentalWarning filtered in entry points. Drizzle is used through a small session shim (`db/sqlite.ts`).

### D5 · Vite + React instead of Next.js (Phase 3)
**Why:**
- The app is a single-page app behind auth, served by the same Fastify process. There's no SSR or SEO need.
- It means one process, one port, a strict CSP with no inline scripts, and the Telegram Mini App on the same origin.

### D6 · d3-force instead of @xyflow/react for the graph
**Why:** a note graph is a force layout, not an editable node diagram. d3-force is smaller and gave a better layout.

### D7 · Built-in timers are the default scheduler; BullMQ is optional (Phase 5)
**Why:**
- It's a single-instance app. The in-process scheduler runs the same jobs and is what every test suite covers.
- The BullMQ path couldn't be tested (no Redis in the test environment), so compose moved Redis behind a `redis` profile.

### D8 · Stateless nag engine
The next reminder is computed from the task + `reminders_log` on each tick.
**Why:** restarts, missed ticks and file edits can't cause duplicate or stuck reminders.

### D9 · Cookie sessions + CSRF header; Bearer token for scripts (Phase 3)
- HMAC-signed stateless cookie, keyed from `API_TOKEN` and the bot token, so rotating either logs everyone out.
- Cookie writes need `x-omnicore: 1`.
- Mini App sessions only via Telegram `initData` validation for allow-listed ids.

### D10 · Local AI first; cloud off by default (Phase 4)
`CLOUD_MODE=off` by default. Embeddings and reminder wording are always local.
**Why:** notes are personal, and a 3B local model is good enough for summaries and extraction.
**Cost:** slower answers on CPU.

### D11 · Model output is untrusted
**Rule:** model output is never rendered as HTML, never acted on without a tap or click, and titles are flattened by `cleanTitle()`.
**Why:** notes can contain prompt injections ("ignore previous instructions…"), and Ask has no write path by design.

### D12 · sqlite-vec for vectors, with a JS fallback
**Why:** the spec asked for sqlite-vec. It's fast and lives in the same DB file. The fallback keeps search working on platforms where the extension can't load. Extension loading is disabled again after load.

### D13 · Version on /health only for local callers (Phase 5)
**Why:**
- `update.sh` and Docker's healthcheck need the running commit.
- The Mini App hostname bypasses Cloudflare Access, so the public internet shouldn't learn the exact version.
- A request counts as public if it carries `cf-connecting-ip` / `x-forwarded-for` or comes from a non-private address.

### D14 · Updates: git pull + rebuild by default; GHCR images optional (Phase 5)
**Why:**
- Building from the checkout works without a registry and keeps the server's code inspectable.
- Images are faster and suit small hosts (multi-arch amd64/arm64).
- Both modes back up the DB first and roll back automatically. The DB is restored only if the new version actually started, since that's the only case where migrations could have run.

### D15 · The app runs unprivileged; it sets up its own folders (revised in 0.5.1)
The container starts as root; `privileges.ts` creates and chowns `data/` and `vault/`, then setuid to `PUID`/`PGID` or the owner of `vault/` (1000 if Docker just created it).
**Why:** least privilege without any host-side setup. 0.5.0 used compose `user:` plus `install.sh` to chown, and that needed a script before the first `docker compose up`. It's done in Node rather than a shell entrypoint, so it doesn't depend on `setpriv`/`chown` being in the base image, and one-off `docker compose exec … backup.js` commands drop root the same way.

### D16 · Telegram updates are serialised; AI work runs in the background
grammY handles updates one at a time.
**Why:** long AI jobs (transcription, Ask) run as background promises, so reminder buttons stay responsive while a model is busy.

### D17 · One way to deploy: `.env` + `docker compose up -d` (0.5.1)
Extras are switched on with `COMPOSE_PROFILES` in `.env`; the app works out the rest: bundled service URLs, AI off when nothing is configured, a generated web password (`data/api-token`), and Ollama model downloads.
**Why:** the user asked for "whatever I enable in env, it runs." Every extra step (install script, `--profile` flags, `ollama pull`, generating a token, chown) was a place to get stuck. The password is written to a 0600 file, never logged.

### D18 · Telegram: buttons first, typing optional (0.5.2)
The bot keeps a persistent reply keyboard and edits one message as you navigate (menu → projects → project) instead of sending new ones. A new task is a draft card stored in `ai_pending` (kind `draft`, 2-day expiry), so it survives a restart. Prompts ("What needs doing?") wait 15 minutes for the next plain message; any command cancels them.
**Why:** the user found the command list "too basic, not interactive"; projects couldn't be created from Telegram at all.

### D19 · Quick tunnel for the Mini App (0.5.2)
Telegram Mini Apps need https. `quicktunnel` runs cloudflared without an account; the app polls cloudflared's metrics `/quicktunnel` endpoint (only `*.trycloudflare.com` hostnames are accepted) and updates the menu button.
**Trade-off:** no Cloudflare Access in front and a changing address, so it's documented as the quick start, with `tunnel` on your own domain as the permanent setup.

### D20 · One app, one look (0.6)
The web app and the Mini App are the same React screens (`apps/web/src/app/`) in Paper (mockup B), light by default with a matching dark theme. Layout adapts (sidebar ≥ 1000 px, tabs below / in Telegram); actions go through `usePrimary`/`useBack`, which become Telegram's native buttons in the Mini App.
**Why:** the user found two different designs confusing and both "too basic". Two codebases also drifted (features on one side only, e.g. remarks were hard to find in the Mini App).

### D21 · Settings live in the database (0.6)
`settings` table, overriding `.env`; read before the config is parsed at start-up (`withStoredSettings`). Read-at-start settings are applied by restarting the process (Docker's `restart: unless-stopped` brings it back).
**Why:** changing reminder rhythm or quiet hours shouldn't need SSH. Restarting is simpler and safer than making every timer reconfigurable live.

### D22 · Delete = remove the lines, Undo = put them back (0.6)
Deleting a task removes its line and everything indented under it; the block is kept in memory for 15 minutes for Undo, and the index's "graveyard" restores the same task id (so updates and reminder history come back). Notes go to `.trash/` (Obsidian's convention), never erased.
**Why:** file-first means the file is the truth; a soft-delete flag would leave the task visible in Obsidian.
