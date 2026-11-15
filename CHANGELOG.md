# Changelog

All notable changes. Versions follow [semver](https://semver.org/); the release workflow uses the
section for a tag as the GitHub Release notes.

## [Unreleased]

- **Lists become separate tasks.** Type or paste `1. Buy milk 2. Call ISP`, `1 milk 2 eggs`, `1.milk 2.eggs`, a bulleted list, or one task per line, and each item is its own task instead of one long task. Each keeps its own `@date`, `!priority` and `#tags`. Works in the web app and Mini App (a preview shows "Adds 3 separate tasks" before saving; Undo removes all of them), with `+ …` and `/todo …` in Telegram, and in the ➕ New task card (its date, time, priority and project fill in what an item didn't say). A `…:` header line is dropped. Numbers must run 1, 2, 3, so "Buy 2 apples" or "1 hour meeting" stay one task. API: `POST /api/tasks/many`; `/api/parse` returns `items`.
- **Update button in Settings → App & updates.** **Check for updates** and **Update now** (asks first), with progress, the result and "Show details" (the update log). It runs `scripts/update.sh` for you (backup first, health check, automatic rollback) through a small optional helper container: add `updater` to `COMPOSE_PROFILES` in `.env`, then `docker compose up -d` once. Without it, Settings shows the command as before and says how to turn the button on. The helper uses the Docker socket (so it controls Docker on that machine) and your home folder read-only (for git's SSH key or credentials); it works as the checkout's owner so `git pull` keeps working for you.
- For contributors and AI assistants:
  - `npm run verify` builds, runs every suite and checks the repo for stray files, then writes a PASS/FAIL report. `--browser` adds the click-through walkthrough; `--docker` builds the image and checks it starts.
  - `git push` runs `verify:quick` first (`.githooks/pre-push`, installed by `npm ci`).
  - Antigravity/Gemini rules (`GEMINI.md`, `.agents/rules/`) and workflows (`.agents/workflows/`).
  - `docs/HANDOFF.md`: the current state, what's verified, what's next.
- `*.zip` is ignored by git.

## [0.6.0] — 2026-11-13 · One app, settings, delete, plain words

**In short:** the web app and the Telegram Mini App are now the same app, in one calm "Paper" design, with everyday words and explanations built in. You can change reminders, quiet hours, summaries, time zone and the look from a **Settings** page instead of `.env`, delete things with **Undo**, and the Telegram bot works with buttons instead of commands. Deploying is now `cp .env.example .env` → `docker compose up -d`.

This release also includes everything from 0.5.1–0.5.3 (listed below), so it's the one to install if you're on 0.5.0.

### Highlights
- **One app, one look.** Same screens and words on the web and in Telegram: a sidebar on a computer, tabs (Today · Upcoming · Projects · More) on a phone and in Telegram. Light by default, a matching dark theme, four accent colours.
- **Settings page.**
  - You & your time: name, time zone, week start, weekend days, clock.
  - Reminders: **pause all** (1 hour / until tomorrow / a week), default time, how often (not started / partly done / after an update), quiet hours, what "Tomorrow" means.
  - Daily summaries: morning and evening on/off and times.
  - Look: theme, accent, start screen.
  - App & updates: version and the update command, Telegram/Mini App/AI status, **Back up now**.
  - Saved in the database, overriding `.env`. Settings read at start-up show "waiting for a restart"; **Apply now** restarts the app (≈5 s in Docker).
- **Delete with Undo**: tasks (with their steps), projects (keep or delete their tasks) and notes (moved to the vault's `.trash/`, never erased). In Telegram too: 🌗 Partly done → 🗑 Delete task → confirm → ↩️ Undo.
- **Plain words**: Someday · To do · Doing · Waiting · Done, *Update* (was "remark"), *Partly done*, *Later*, *Needs you now*. Each task says in one sentence what its reminders will do next; (?) buttons explain things in place.
- **Welcome guide** on first visit and a **Help & guide** page: how it works, what the words mean, where things are, and how reminders work, with your own settings.
- **One task screen** for web and Telegram: rename; date, time and priority; steps (or AI break-down); updates; reminder history; the file it lives in.
- **Telegram is button-driven** (0.5.2): a keyboard under the message box (📋 Today · ➕ New task · 📁 Projects · ☰ Menu); a new-task card where you tap date, time, priority and project; create and open projects from Telegram. Buttons renamed to 🌗 Partly done · 💬 Update · ⏱ In 1 hour · 🌅 Tomorrow · 🔕 Quiet today.
- **New task suggests as you type** (0.5.3): `@` dates, `!` priority, `#` projects and tags, numbers → times, `every` → repeats, plus one-tap chips.

### Fixed
- **Updates (remarks) in Telegram** were only saved if you used Telegram's swipe-to-reply; now the next message after 💬 Update is saved. In the app, updates have a visible Save button.
- An invalid `PUBLIC_URL` (e.g. missing `https://`) stopped the app; it's now fixed up or ignored with a warning (0.5.2).
- Building from a working copy could skip compiling (`*.tsbuildinfo` now in `.dockerignore`); `update.sh` treats a closed prompt as "no" (0.5.1).

### Deploying & upgrading
- **New install:** `git clone …` → `cp .env.example .env` → fill in what you want → `docker compose up -d` → `cat data/api-token` for the web password (0.5.1).
- **Extras from `.env`:** `COMPOSE_PROFILES=ai,tunnel` (also `quicktunnel`, `redis`). The app finds the bundled Ollama/Redis itself, downloads missing AI models, creates its folders with the right owner, and makes a password if `API_TOKEN` is empty.
- **`quicktunnel`** (0.5.2): an instant `https://….trycloudflare.com` address for the Mini App, no Cloudflare account; the bot sends you the link. `LISTEN=0.0.0.0` opens the web app to your home network.
- **From 0.5.0:** `scripts/update.sh` (or `git pull && docker compose up -d --build`). The database migration (`0004_settings`) runs by itself. Your `.env` keeps working; `.env.example` is now much shorter, and every setting is listed in `docs/CONFIGURATION.md`. Settings you change in the app override `.env`.

### For developers
- Web: `apps/web/src/app/` holds the shared screens; `usePrimary` / `useBack` map to Telegram's native buttons in the Mini App. The old separate web/Mini App screens are gone. UI rules are in `AGENTS.md`.
- API:
  - `GET /api/prefs`
  - `GET/PUT /api/settings`, `POST /api/settings/restart`
  - `POST /api/reminders/pause`
  - `GET /api/system`
  - `POST /api/backup`
  - `DELETE /api/tasks/:id`, `DELETE /api/projects/:slug?keepTasks=`, `DELETE /api/notes/:id`
  - `POST /api/undo`
  - `GET/POST /api/projects/:slug` / `/api/projects`
  - `GET /api/suggest`
- Tests: core 98 · server 71 · E2E 56 · security 26 · AI 25, plus the browser walkthrough `demo/peek-app.mjs` (23 checks, web + Mini App). Details in `TESTING.md`.

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
