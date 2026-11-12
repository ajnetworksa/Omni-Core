# Architecture

```
            Telegram (bot + Mini App)        Browser (web app)          Obsidian / any editor
                     │                              │                           │
          long polling / webhook             HTTPS (Cloudflare Tunnel)          │ edits .md files
                     │                              │                           │
┌────────────────────▼──────────────────────────────▼─────────────┐             │
│ apps/server  (one Node process)                                  │             │
│  grammY bot ─┐   Fastify: /api/*  /health  /  (web app) /tg       │             │
│              ├──► TaskService ◄── routes/api.ts                   │             │
│  scheduler ──┤    (lock → write file → re-index)                  │             │
│  (timers or  │                                                    │             │
│   BullMQ)    ├──► nag runner ──► TelegramNotifier                 │             │
│              ├──► rollover (midnight) · re-index · digests        │             │
│              └──► AI: embed sync · probe · standup/retro          │             │
└───────────────┬─────────────────────────────┬────────────────────┘             │
                │                             │                                  │
        packages/core                    local models                            │
   ┌────────────▼────────────┐   Ollama / OpenAI-compatible (+ opt-in cloud)     │
   │ SQLite (node:sqlite,    │                                                   │
   │ WAL) + sqlite-vec       │◄── indexer ◄── watcher (chokidar) ◄───────────────┘
   └─────────────────────────┘          vault/*.md  (source of truth)
```

## Data model

**The vault is the truth.**
- Notes are Markdown with YAML frontmatter; tasks are checkbox lines in any note.
- The indexer parses each changed file (by checksum) into SQLite. Delete the database and a full scan rebuilds every note, link and task.
- Rebuilding loses only app state: remarks, reminder history, snoozes, rollover counts and the AI index.

| Table | Holds |
|---|---|
| `notes` | path, title, frontmatter, raw content, checksum |
| `note_links` | `[[wikilinks]]` (with `#heading`), resolved or dangling; feeds backlinks and the graph |
| `projects`, `milestones` | projects come from `project:` frontmatter / `#project/slug` tags; milestones exist in the schema but have no UI yet |
| `tasks` | one row per checkbox: anchor, line number, raw line, status, priority, dates, recurrence, parent, progress, remarks (JSON), rollover count, snooze, nag state |
| `reminders_log` | every reminder sent (channel, state, message ids, acknowledged) |
| `ai_chunks`, `ai_sources`, `ai_meta` | semantic index: chunk text + float32 vector + content hashes. `vec_chunks` (sqlite-vec) mirrors the vectors when the extension loads |
| `ai_pending` | suggestions waiting for a tap (tasks heard in a voice note), 3-day expiry |
| `_migrations` | applied migration files |

**Task identity**
- Every task line gets a hidden block anchor `^oc-xxxxxxxx` (Obsidian-native, `TASK_ANCHORS=true`).
- Edits and moves keep the identity; locating a line falls back to line number plus the raw-line checksum.
- Subtasks are indented checkboxes, and their parent is found by indentation.

**Writes go file-first** (`TaskService`):
1. Take the per-file `KeyedLock`.
2. Read the file and find the line by anchor.
3. Rewrite only that line: status char, `✅ date`, `📅 due`, `!pN`. (Remarks, snoozes and reminder history are app state in SQLite only. Writing remarks into the note is on the roadmap.)
4. Write atomically (temp file + rename, keeping the line-ending style).
5. Re-index that file while still holding the lock.

If the line can't be found (someone edited it mid-flight), the call fails with a 409 and re-indexes, rather than guessing.

## Nag engine (spec §3.3)

Stateless. Each tick (`NAG_TICK_SECONDS`) works out, for every open task with a due time:

```
not due ──(due time reached)──► overdue   ping every NAG_INTERVALS.overdue (30 min)
                                partial   in progress / subtasks done / [/]  → every 60 min
                                remark    remark added or [!] blocked          → every 120 min
done · cancelled · backlog · snoozed · muted ─► silent         quiet hours ─► held
p1 → interval ÷ 2 · rolled over ≥ 3 days → ÷ 2 · floor 10 min
```

- The next ping is computed from `reminders_log`, so restarts, missed ticks and file edits can't cause duplicate or stuck reminders.
- Telegram buttons (Done / Partial / Remark / +1h / Tomorrow / Today) go through `applyTaskAction`, the same code the API uses.
- **Midnight rollover**: unfinished tasks from earlier days move into today and get `rollover_count + 1`. There's a startup catch-up if the server was off at midnight.

## AI pipeline (Phase 4)

- **`AiClient`** routes chat requests:
  - local first (Ollama or any OpenAI-compatible server);
  - cloud (Anthropic, OpenAI, Gemini) only when `CLOUD_MODE` is `fallback` or `prefer`;
  - `localOnly` calls never leave the machine.
  - One gate limits concurrency (`AI_CONCURRENCY`) with a queue of 6; extra requests get "busy" (429).
- **Semantic index**:
  - Notes are split by heading into ~900-character chunks. Checkbox lines are left out; each task gets its own chunk (title, status, dates, project, remarks).
  - Only sources whose content hash changed are re-embedded, every `AI_EMBED_INTERVAL_SECONDS`, with backoff while the model is down.
  - Changing the embedding model triggers a full rebuild.
  - Vectors are searched with `vec0` KNN, or brute-force JS if the extension is unavailable.
- **Ask**:
  - `parseTimeHint` turns "last quarter" into a date filter.
  - Search, then keep hits within 60% of the best score, at most 2 per note.
  - The model answers with numbered sources only (`GUARD` tells it text in `<source>` is data), and the clients render the answer as text.
- **Write paths from AI are confirmation-gated**: suggested subtasks, tasks from voice notes. The standup and retro are prose under their own heading, with headings and checkboxes stripped.
- A reachability probe (`/v1/models`, every 5 min) decides which AI features the UI shows.

## Security model

- **Network**:
  - The server binds to `127.0.0.1`; Docker publishes the port on 127.0.0.1 only.
  - Remote access goes through Cloudflare Tunnel, with Cloudflare Access recommended in front. The Mini App hostname bypasses Access and relies on Telegram `initData`.
- **Auth**:
  - Bearer `API_TOKEN` for scripts.
  - HMAC-signed session cookie for browsers: 30 days for the web app, 12 h for the Mini App. HttpOnly, SameSite=Strict (None+Secure inside Telegram over https).
  - Cookie writes need `x-omnicore: 1` (CSRF). Login is throttled per client IP.
- **Telegram**:
  - Updates and `initData` are accepted only from `TELEGRAM_ALLOWED_USER_IDS`.
  - Webhooks are checked with the secret token. Callback data is validated, and one-shot actions (voice tasks) can't be replayed.
- **Files**: every vault path is normalised and confined to the vault. `..`, absolute paths, hidden folders (`.obsidian`, `.git`) and NUL are refused.
- **Headers**:
  - Pages get a strict CSP (scripts from self and telegram.org only; `frame-ancestors` self and web.telegram.org).
  - API responses get `default-src 'none'` plus `X-Frame-Options: DENY`.
- **Leakage**: secrets are never logged; `/health` shows the version only to local, unproxied callers.

## Deploy & update

- **Install**: `cp .env.example .env && docker compose up -d`. Extras come from `COMPOSE_PROFILES` in `.env` (`ai`, `tunnel`, `redis`); compose passes it to the app as `OMNICORE_PROFILES`, and `composeDefaults()` in config.ts points the app at the bundled Ollama/Redis (or turns AI off when no model server is configured). On start, `boot.ts` → `privileges.ts` runs as root just long enough to create `data/` and `vault/`, chown them (to `PUID`/`PGID` or the owner of `vault/`), then setuid to that user. With no `API_TOKEN` and a non-loopback bind, `token.ts` creates `data/api-token`. With Ollama, `ensureModels()` (ai.ts) downloads missing models. `scripts/install.sh` is an optional wrapper around the same steps.
- **Update**: `scripts/update.sh` works in three modes (`docker`, `image`, `node`). Each time it:
  1. fetches;
  2. shows the changes and any migrations;
  3. snapshots the DB (SQLite online backup);
  4. checks out the new code;
  5. builds and restarts;
  6. waits for `/health` to report the new commit.

  On failure it rolls back the code, and the DB too if the new version ran.
- **CI**: GitHub Actions runs every suite and an image smoke test. Tags publish multi-arch images to GHCR.
- **Version**: `/health` (local callers) and `/api/version` show the version and commit. With `UPDATE_CHECK_REPO` set, the app and Telegram announce new releases.
