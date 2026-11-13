# AGENTS.md — working on OmniCore

Read this first. It's written for any AI coding assistant (Claude, Codex, Cursor, Gemini…) or a
new developer picking the project up. Keep it current when you change how things work.

## What this is

OmniCore Workspace is a self-hosted, local-first notes + tasks app with an aggressive Telegram
reminder ("nag") engine and local AI.
- **Markdown files are the source of truth.** SQLite is an index you can rebuild from the vault (plus app state).
- The original spec lives in the claude.ai project "To Do apps". [docs/ROADMAP.md](docs/ROADMAP.md) tracks what's left of it.

| Doc | Read it for |
|---|---|
| [docs/PROGRESS.md](docs/PROGRESS.md) | What's built, what's tested, known gaps. **Update it when you finish something.** |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Goals, the next milestones, ideas. |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | How the pieces fit: data flow, schema, nag FSM, AI pipeline, security model. |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Why things are the way they are. Add an entry for any non-obvious choice. |
| [docs/CONFIGURATION.md](docs/CONFIGURATION.md) | Every setting (generated). |
| [docs/DEPLOY.md](docs/DEPLOY.md) | Install, update, backup, GitHub releases. |
| [docs/GUIDE.md](docs/GUIDE.md) · [docs/API.md](docs/API.md) | User guide · HTTP API. |
| [TESTING.md](TESTING.md) | Test suites, the latest results, security findings. |
| [CHANGELOG.md](CHANGELOG.md) | What changed per version. **Add a line for user-visible changes.** |

## Repo map

```
packages/core/          the engine; no HTTP, no Telegram
  src/db/               node:sqlite shim + Drizzle schema + migrations runner
  src/markdown/         frontmatter, [[links]], task-line parser/renderer (Obsidian Tasks syntax)
  src/vault/            safe file access, indexer (file → DB), watcher, per-file lock
  src/tasks/            TaskService (every write goes through here → file first), views, rollover, recurrence
  src/nag/              reminder state machine (engine.ts) and the tick runner
  src/ai/               model client (local/cloud/STT), semantic index (sqlite-vec), AI features
  migrations/           numbered .sql files, applied automatically at startup, forward-only
apps/server/            Fastify API + Telegram bot (grammY) + scheduler; serves the built web app
  src/config.ts         ALL settings (zod). Source for docs/CONFIGURATION.md
  src/routes/api.ts     /api/* routes;  src/http.ts  app assembly, /health, static web app
  src/telegram/         bot.ts (commands, buttons, media), format.ts (HTML), notifier.ts (reminders)
  src/ai.ts             embedding sync with backoff, reachability probe, standup/retro
  src/backup.ts         DB backup/restore CLI;  src/version.ts  version + GitHub update check
apps/web/               React 19 + Vite + Tailwind 4: ONE app, served at / (web) and /tg (Telegram Mini App)
  src/app/              the shared screens (Today, Upcoming, Projects, Task, Settings, Help…), frame, platform
                        (usePrimary/useBack = Telegram's buttons or in-page ones), ui.tsx, words.ts (plain words)
  src/web/              web-born screens reused by both (Notes, Board, Graph, search palette, daily note)
  src/tg/               Telegram glue only (SDK, MiniApp entry, quick-add suggestions)
  src/settings.ts (server) settings registry: labels/help shown in the UI; stored in the `settings` table
tests/                  end-to-end suites (real server + mock Telegram/AI); lib/ has the mocks
scripts/                update.sh, install.sh (optional first-start shortcut), config-docs.mjs
demo/                   screenshot/demo scripts (Playwright); not part of the product
docs/                   everything above + screenshots/
```

## Commands

```bash
npm ci                      # Node 22.16+ (24 recommended); no native modules
npm run build               # tsc -b for core+server, then the web app
npm start                   # server on :3000 (needs .env; see .env.example)
npm run dev:web             # Vite on :5173, proxies /api to :3000
npm test                    # unit tests: core (vitest) + server (vitest)
npm run test:e2e            # 56 feature checks, live server + mock Telegram (~2.5 min)
npm run test:security       # 26 security checks (~1 min)
npm run test:ai             # 25 AI checks, live server + mock model server (~2 min)
npm run test:all            # everything above
node scripts/config-docs.mjs   # regenerate docs/CONFIGURATION.md after changing config.ts
```

The server tests import the **built** core (`packages/core/dist`), so run `npx tsc -b` after
editing core before `npm test -w @omnicore/server`.

## Rules that keep the project healthy

1. **File first.** Every change to a task or note goes through `TaskService`. It takes the per-file lock, writes the Markdown atomically, then re-indexes. Never update the `tasks` table without writing the file: the next re-index would revert it.
2. **Task identity is the block anchor** (`^oc-xxxxxxxx`) at the end of the line. Keep it when rewriting lines. Fall back to line number + checksum only when it's missing.
3. **Obsidian compatibility.** Use the Obsidian Tasks tokens as they are (`📅 ⏳ 🛫 🔁 ✅ ➕`, `!p1`–`!p4`). Don't invent syntax Obsidian would show as junk.
4. **Model output is untrusted text.**
   - Clean titles with `cleanTitle()` (one line, no checkboxes, anchors, dates or headings).
   - Render answers as text, never HTML.
   - Nothing the model says is acted on without the user tapping or clicking (voice tasks, subtasks).
   - Embeddings and reminder wording are always local (`localOnly`).
5. **Secrets.**
   - Never log or return `API_TOKEN`, `TELEGRAM_BOT_TOKEN` or `CLOUD_API_KEY`; `redact()` exists for model errors.
   - `/health` shows the version only to local callers.
6. **Auth.** `/api/*` accepts a Bearer `API_TOKEN` or the signed session cookie. Cookie writes need the `x-omnicore: 1` header (CSRF). Telegram Mini App sessions come only from validated `initData` for allow-listed ids.
7. **CSP stays strict.**
   - No inline scripts or styles injected at runtime, and no `data:` fonts (`assetsInlineLimit: 0`).
   - Pages get `APP_CSP`; API responses get `default-src 'none'`.
   - The CSP is chosen by **path**, so 304 responses get it right too.
8. **Time zones.** "Today" is always `todayInTz(config.TIMEZONE)`. Never use `new Date().toISOString().slice(0,10)` for a local date. There's a test for the midnight–03:00 bug.
9. **Settings** are added only in `apps/server/src/config.ts`, with a `/** doc comment */`. Then add them to `.env.example` and regenerate `docs/CONFIGURATION.md`.
10. **Migrations** are new numbered files in `packages/core/migrations/`. Never edit an applied one. `scripts/update.sh` notices migrations and restores the pre-update DB on rollback.
11. **`.gitignore`**: anchor top-level folders (`/vault/`, `/data/`). An unanchored `vault/` once hid `packages/core/src/vault/` from git.

## Definition of done

- `npm run build` is clean (strict TypeScript, no `any` escapes without a reason).
- `npm run test:all` passes, and a new feature has a unit test and a line in an E2E suite.
- UI changes: take screenshots (`demo/` scripts) and look at them; no console errors.
- Update `docs/PROGRESS.md`, `CHANGELOG.md` (if user-visible), `docs/DECISIONS.md` (if non-obvious), and `README.md`/`docs/GUIDE.md` (if usage changed).
- Releases: bump `version` in the root `package.json`, add the CHANGELOG section, tag `vX.Y.Z`, push. GitHub Actions builds the image; servers run `scripts/update.sh`.

## Gotchas

- `node:sqlite` prints an ExperimentalWarning. `boot.ts` and `backup.ts` filter it; filter it in any new entry point too, and import `node:sqlite` dynamically after the filter.
- `sqlite-vec` loads as an extension. Extension loading is switched off again right after (tested). If it can't load, search falls back to plain JS.
- The tests never need real Telegram or Ollama: `tests/lib/mock-telegram.mjs` and `tests/lib/mock-ai.mjs` stand in (set `TELEGRAM_API_ROOT` / `OLLAMA_BASE_URL`).
- The BullMQ/Redis scheduler path (`REDIS_URL`) is **not** covered by the suites. The built-in timers are the default and the tested path.
- Windows hosts with Docker bind mounts need `VAULT_POLLING=true`.

## UI rules (since 0.6)
- One app for web and Telegram. Never add a screen to only one of them; put it in `src/app/` and use `usePrimary` / `useBack` instead of touching `tg.MainButton` directly.
- Words: use `app/words.ts` (Someday / To do / Doing / Waiting / Done, "Update" not "remark"). Explain anything non-obvious with `<Explain>`.
- Colours: only the Paper tokens (`var(--tg-…)` or the Tailwind names that map to them). No hex values in components.
- Anything destructive: `<Confirm>` first, then a toast with Undo where the server supports it.
