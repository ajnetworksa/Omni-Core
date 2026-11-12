# Changelog

All notable changes. Versions follow [semver](https://semver.org/); the release workflow uses the
section for a tag as the GitHub Release notes.

## [0.5.3] — 2026-11-12 · Mini App: Paper look, suggestions, projects

- **Matches mockup B (Paper)**: its own palette instead of Telegram's theme colours. Light by default, with a matching "Paper night"; the ☀️ button cycles light → night → follow Telegram, and the choice is remembered. Telegram's header, background and main button are painted to match.
- **New task suggests as you type**: `@` dates (plus a date picker), `!` priorities, `#` your projects and tags (or a new project), numbers → times (`9` → 09:00 / 21:00), `every` → repeats. Chips under the box (Date · Time · Priority · Project · Repeat) start each one with a tap. A live "Saved as" line shows how it will be read.
- **Projects**: open one to see open and done tasks, add to it ("Add to <project>"), and create new projects from the Projects tab.
- API: `GET /api/projects/:slug`, `POST /api/projects`, `GET /api/suggest`. Tasks added to a project that has its own note go into that note.
- Walkthrough test `demo/peek-tg2.mjs` (14 checks) and screenshots in `docs/screenshots/ui/miniapp-*.png`.

## [0.5.2] — 2026-11-12 · Buttons everywhere, quick tunnel

- **Telegram is button-driven.**
  - `/start` shows a keyboard under the message box (📋 Today · ➕ New task · 📁 Projects · ☰ Menu) and a menu with today's status.
  - **➕ New task** asks for the title, then shows a card: tap the date, time, priority and project, then ✅ Save. Typed shortcuts (`!p1 @tomorrow 18:00`) prefill the card.
  - **Projects** can be created from Telegram (`projects/<name>.md`), from the menu, the task card, `/project <name>` or a lone `#project/name` message. A project's screen lists its open tasks (tap = done) and has ➕ Add task.
  - 🔍 Search, 🤖 Ask and 🌅 Standup from the menu. New `/menu` and `/new` commands; a shorter `/help`.
- **`quicktunnel` extra:** a free `https://….trycloudflare.com` address without a Cloudflare account. The app picks it up, sets the Mini App button and sends you the link (again whenever it changes).
- **`LISTEN=0.0.0.0`** opens the web app to your local network.
- Core: `TaskService.createProject()`.

## [0.5.1] — 2026-11-12 · One-step deploy

- **Deploy is now `cp .env.example .env` → `docker compose up -d`.** No install script, flags or host setup needed.
  - Extras switch on from `.env`: `COMPOSE_PROFILES=ai,tunnel` (also `redis`). The app finds the bundled Ollama/Redis by itself; with no model server configured, AI is quietly off.
  - With Ollama, missing models download on first start (`AI_AUTO_PULL`, default on).
  - No `API_TOKEN`? A random password is created in `data/api-token` (0600, never logged).
  - The app creates `data/` and `vault/`, gives them to `PUID`/`PGID` or the owner of `vault/`, and drops root. Backups run via `docker compose exec` are no longer root-owned.
  - `.env.example` is now short: just the settings you'd change. The full list is in docs/CONFIGURATION.md.
- `scripts/install.sh` is now an optional shortcut for the same steps.
- Fixes:
  - `.dockerignore` excludes `*.tsbuildinfo`, so building from a working copy no longer skips compiling;
  - `update.sh` treats a closed stdin at its prompt as "no" instead of failing.

## [0.5.0] — 2026-11-12 · Deploy, updates, handoff

- **Install and update scripts.**
  - `scripts/install.sh`: first-run setup.
  - `scripts/update.sh`: shows the changes, backs up the DB, updates (docker / image / node mode), checks health, and rolls back automatically, including the DB if migrations ran. Also `--check`, `--ref`, `--rollback`.
- **Backups**: `backup.js` takes online SQLite snapshots, can list and restore them (with an integrity check), and keeps the newest 20.
- **Version**: shown in `/health` (local callers only) and `/api/version`. An optional GitHub release check (`UPDATE_CHECK_REPO`) shows "Update available" in the app and sends a one-time Telegram message.
- **GitHub Actions**: CI runs all suites and a Docker smoke test. Tags publish multi-arch images to GHCR and create a GitHub Release.
- **Docker**:
  - The container runs as a non-root user (`PUID`/`PGID`) and has a healthcheck.
  - Redis is now an opt-in `redis` profile; the built-in scheduler is the default.
- **Docs**: AGENTS.md, ARCHITECTURE, PROGRESS, ROADMAP, DECISIONS, DEPLOY, a generated CONFIGURATION reference, GUIDE and API.
- **Fixes**: `.gitignore` no longer hides `packages/core/src/vault/`; `update.sh` tolerates moved tags.

## [0.4.0] — 2026-11-12 · Local AI

- Ask your notes (RAG with sources and date ranges), related search in ⌘K, task breakdown, voice note → tasks (confirm to add), photo → note, morning standup and evening retro, varied reminder wording.
- Ollama or any OpenAI-compatible server locally; Anthropic/OpenAI/Gemini only with `CLOUD_MODE`.
- sqlite-vec semantic index with a JS fallback; it re-embeds only changed notes and backs off while the model is down.
- AI features are shown only when the model server answers.

## [0.3.0] — 2026-11-12 · Web app and Telegram Mini App

- Web app: Today, task drawer, Upcoming, Inbox, Board (drag and drop), Notes (tree, editor, backlinks, conflict-safe save), Graph, ⌘K, quick-add with live parsing.
- Telegram Mini App: Today, Upcoming, Projects, task detail and actions, add; follows the Telegram theme.
- Signed session cookies, a CSRF header, Telegram `initData` sign-in, and a strict CSP.

## [0.2.0] — 2026-11-11 · Telegram and the nag engine

- Telegram bot: `/todo`, `/note`, `/today`, `/project`, `/search`, `/log`, capture of photos, voice and files, and inline action buttons.
- The nag engine (overdue / partial / remark) with escalation, snooze, quiet hours, and p1 / rollover acceleration.
- Cloudflare Tunnel compose profile; webhook mode.

## [0.1.0] — 2026-11-11 · Data engine

- Markdown vault ⇄ SQLite sync with block anchors, exact-line write-back, the watcher, the midnight rollover, recurrence, and Obsidian Tasks syntax.
