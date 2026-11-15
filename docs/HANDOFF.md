# Handoff — read this second (after AGENTS.md)

The state of the project for whoever works on it next (a person, Claude, Antigravity/Gemini,
Cursor…). **Update it at the end of every work session** (`/handoff` workflow).

_Last updated: 2026-11-14 · version 0.6.0 · by Claude (Anthropic) at the end of the build-out._

## Where things stand

OmniCore is built, tested and running on the owner's server.

- **What it is**: self-hosted notes + tasks. A Telegram bot keeps reminding you until things are done. Local AI. Markdown files (Obsidian-compatible) are the source of truth.
- **One app** for the web and the Telegram Mini App (Paper design), with a Settings page, delete with Undo, plain words, and a welcome guide.
- **Deployed**:
  - on the owner's Linux box at `~/app`, with Docker Compose and Cloudflare Tunnel to their domain;
  - `PUBLIC_URL` turns on the Mini App;
  - the bot is configured with their Telegram id.
- **Repo**: private GitHub repo. CI runs the tests. Tagging `vX.Y.Z` publishes a GitHub Release whose notes come from `CHANGELOG.md`.

### Verified (2026-11-15: `npm run verify` + browser walkthrough; Docker 2026-11-14)
| Check | Result |
|---|---|
| typecheck + web build | PASS |
| unit tests | core 116 · server 75 (+8 web-logic tests) |
| E2E features (mock Telegram) | 58/58 |
| security | 26/26 |
| AI end-to-end (mock model server) | 25/25 |
| browser walkthrough (web desktop + Mini App phone) | 23/23, no page errors |
| Docker image builds and starts healthy | PASS |
| pre-push hook blocks a push with a type error; leftover files detected | tested by hand |
| lists → separate tasks (web, phone, Telegram `+`, `/todo`, New task card, API) | unit 18 + E2E 2 + browser by hand (2026-11-15) |
| Update button: real Docker, helper + app + git remote; check (up to date / newer), update (new commit running, files still owned by the user), broken build rolled back with the error shown, helper updates itself | tested by hand 2026-11-15, with a **stand-in** helper image (see below) |

### NOT verified (be careful here)
- **Real model quality**: the AI tests use a mock model server; real Ollama models were not judged.
- **Real Telegram clients** (phone and desktop apps): tested against a mock Bot API and a Telegram SDK stand-in.
- **Redis/BullMQ scheduler** (`redis` extra): built, never tested. The built-in timers are the default.
- **Prebuilt GHCR image mode** of `update.sh`, and the GitHub Actions workflows running on GitHub itself.
- Cloudflare `quicktunnel`: the address pickup was tested with a stand-in, not the real cloudflared.
- **The real updater image** (`docker/updater/Dockerfile`, Alpine): the sandbox couldn't reach Docker Hub or the Alpine mirror, so the tests used an image with the same tools (git, curl, bash, docker CLI + compose, setpriv) taken from Ubuntu. Same script, same flow. On the first real server run, check `docker logs omnicore_updater` says "ready", and that **Check for updates** works. Fetching over SSH from a private repo (the real server) was not tested; a local git remote was.

### Known problems / lessons
- **The server must be a git clone and updated with git.** Copying a zip over it once left deleted files behind and broke the Docker build (`TaskDrawer.tsx` errors). `npm run verify` now flags untracked source files.
- In Telegram, prompts ("What needs doing?") take the **next** message; a command cancels them. Tested, but watch for user confusion.
- `PUBLIC_URL` needs `https://`. It's fixed up automatically now, but the Mini App only appears with https.

## How to work on it

```bash
npm ci                   # also installs the git pre-push hook (.githooks/)
npm run verify:quick     # baseline before you change anything (~1 min)
# … make one small change …
npm run verify:quick     # after each step
npm run verify           # before you say you're done (~4 min); add -- --browser for UI, -- --docker for Docker
```

The rules for AI assistants are in `AGENTS.md`, `GEMINI.md` and `.agents/rules/`. Step-by-step workflows are in `.agents/workflows/`: `/verify`, `/feature`, `/fix`, `/release`, `/deploy`, `/handoff`.

## What to build next (owner's priorities, in order)

1. **Work diary** (Phase 6, designed and mocked up, not built). The owner says where they went and what work they did each day; the app summarises it, organised by date and calendar. The spec and mockups are in `docs/ROADMAP.md` ("Next: Phase 6"), plus the "OmniCore Work Diary mockups" design canvas in the owner's claude.ai artifacts. Mostly work-related; sync is fine.
2. **Sync** (Phase 7): git auto-commit/push of the vault first, then WebDAV/S3 backups.
3. **Spec gaps**: milestones, Gantt/roadmap view, filtered list view, `project_index.md`, remarks written into notes.
4. Real-model check: run with a real Ollama (`COMPOSE_PROFILES=ai`) and judge Ask/standup quality; maybe a 7–8B model.

## Session log
- **2026-11-15 (Claude)**: lists typed as `1. … 2. …` / one per line become separate tasks; Settings → Update button via the optional `updater` helper (Docker-tested with a stand-in image, see NOT verified).
- **2026-11-11 → 11-14 (Claude)**: phases 1–5, then 0.5.1 one-step deploy, 0.5.2 button-driven Telegram + quick tunnel, 0.5.3 Mini App suggestions, 0.6.0 one app + settings + delete + plain words; `npm run verify`, pre-push hook, Antigravity rules and workflows.
