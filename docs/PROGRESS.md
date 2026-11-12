# Progress

_Last updated: 2026-11-12 · version 0.5.3._ Update this file whenever you finish, start or drop something.

## Status by phase

| Phase | What | Status |
|---|---|---|
| 1 | Data engine: vault watcher, Markdown ⇄ SQLite task sync, anchors, rollover, recurrence | ✅ done |
| 2 | Telegram bot, nag engine, Cloudflare Tunnel, capture (text, voice, photo, files) | ✅ done |
| 3 | Web app (Midnight) + Telegram Mini App (Paper), sessions, CSP | ✅ done |
| 4 | Local AI: Ask (RAG), related search, breakdown, voice → tasks, photo → note, standup/retro, varied reminders | ✅ done (mock-tested; real-model quality untested) |
| 5 | Deploy & handoff: one-step `.env` + `docker compose up -d` deploy (0.5.1), update script with backup + rollback, CI, GHCR images, version/update check, docs | ✅ done |
| 6 | **Work diary** (designed, see ROADMAP) | ⏳ next |
| 7 | Cloud/Drive sync (spec §3.7) | ⏳ planned |

## Feature checklist against the spec

| Spec | Feature | State | Tests |
|---|---|---|---|
| 3.1 | Flat `.md` vault, YAML frontmatter | ✅ | core unit, e2e |
| 3.1 | `[[links]]`, `[[Note#Heading]]`, backlinks | ✅ | core unit, api |
| 3.1 | Graph view | ✅ d3-force (not @xyflow, see DECISIONS) | screenshots |
| 3.1 | Checkbox ⇄ DB two-way sync, exact-line write-back | ✅ | core unit, e2e, security |
| 3.2 | Projects → tasks → subtasks | ✅ | e2e |
| 3.2 | **Milestones** | ⚠️ schema only, no UI/API | — |
| 3.2 | Kanban (Backlog/Ready/In progress/Blocked/Done) with drag-and-drop | ✅ | api, screenshots |
| 3.2 | **List/table view with multi-filters** | ⚠️ Upcoming/Inbox lists only | — |
| 3.2 | **Gantt / roadmap** | ❌ not built | — |
| 3.2 | **Auto `project_index.md`** | ❌ not built | — |
| 3.3 | Nag FSM: overdue / partial / remark, escalation, snooze buttons | ✅ | core unit, e2e |
| 3.3 | Redis + BullMQ scheduler | ⚠️ built, **not tested** (built-in timers are default and tested) | — |
| 3.4 | Today view, overdue, pinned, daily note | ✅ | api, e2e |
| 3.4 | Midnight rollover + rollover_count + escalation styling | ✅ | core unit, e2e |
| 3.5 | Telegram /todo /note /today /project /search /log /ask /standup /retro, inline buttons | ✅ | server unit, e2e |
| 3.5 | Voice note → transcript → tasks (confirm) | ✅ | server unit, ai-e2e |
| 3.5 | Photo → note via vision model | ✅ | server unit, ai-e2e |
| 3.6 | Local Ollama + cloud fallback (opt-in) | ✅ | core unit, ai-e2e |
| 3.6 | sqlite-vec RAG, natural-language search over notes and tasks | ✅ | core unit, ai-e2e |
| 3.6 | Task decomposition | ✅ | core/server unit, ai-e2e |
| 3.6 | Daily standup / evening retro | ✅ | core/server unit, ai-e2e |
| 3.7 | **Google Drive / WebDAV / S3 / git auto-commit sync** | ❌ not built (DB backups exist) | — |
| 3.8 | Cloudflare Tunnel + Access guidance | ✅ docs + compose profile | not exercised |
| — | Web app: Today, Upcoming, Inbox, Board, Notes (tree, editor, conflict-safe save), Graph, ⌘K | ✅ | api, screenshots |
| — | Telegram Mini App: Today, Upcoming, Projects, task detail, add, breakdown | ✅ | api, screenshots |
| — | Install script, update script (docker/image/node), backup/restore, rollback | ✅ | deploy test (see TESTING.md) |
| — | GitHub Actions CI + GHCR release images, in-app update notice | ✅ | actionlint; not run on GitHub yet |

## Test totals (2026-11-12)

core unit 95 · server unit 45 · E2E 56 · security 26 · AI E2E 25 · deploy/update flow 9 scenarios. Details: [TESTING.md](../TESTING.md).

## Known gaps and risks

- **Real models**: answer quality with `llama3.2:3b` / `nomic-embed-text`, and real Whisper and vision, haven't been checked here. Only the plumbing is tested.
- **BullMQ/Redis path** is untested; it's off by default now (compose `redis` profile).
- **Image-mode updates** (`OMNICORE_IMAGE` + GHCR) weren't run end-to-end: no registry was reachable from the test sandbox. The build, docker and node modes were.
- **Remarks, snoozes and reminder history live only in SQLite.** Back the DB up (`npm run backup`, which `update.sh` does automatically).
- **Telegram and Cloudflare** were tested against mocks, not the live services.
- **Windows/macOS Docker bind mounts** need `VAULT_POLLING=true` (not exercised).
