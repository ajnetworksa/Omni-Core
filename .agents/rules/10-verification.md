---
trigger: always_on
---

# How to prove a change works

| Change | Run | Must show |
|---|---|---|
| Docs / comments only | `npm run verify:quick` | VERIFY: PASS |
| Server, core, bot, API | `npm run verify` | VERIFY: PASS with E2E 58/58, security 26/26, AI 25/25 (or higher counts) |
| Web app / Mini App UI | `npm run verify -- --browser` | the above + `browser walkthrough … 23/23`; open 2–3 screenshots in `tests/.run/verify/shots/` and describe what you saw |
| Dockerfile, compose, deps, scripts | `npm run verify -- --docker` | `Docker image builds and starts healthy: PASS` |
| `scripts/update.sh`, `docker/updater/`, `apps/server/src/updater.ts` | `npm run verify -- --docker`, then a real run: a test checkout with `COMPOSE_PROFILES=updater`, push a new commit, tap Check and Update, then push a commit that fails to build | the new commit running (`/health` sha), then an automatic rollback to it with the error shown in Settings. If you can't run Docker, say "NOT VERIFIED: update/rollback" |
| Before a release | `npm run verify:full` | everything PASS |

- The report is `tests/.run/verify/REPORT.md`. Paste its table in your final message.
- A new feature needs a new test: a unit test (`packages/core/test/`, `apps/server/test/`) **and**
  a check in an end-to-end suite (`tests/e2e.mjs`, or `demo/peek-app.mjs` for UI). Show the new
  test failing before your change and passing after, when practical.
- Telegram and AI never need real services in tests: `tests/lib/mock-telegram.mjs`, `tests/lib/mock-ai.mjs`.
- If you can't run something (no Docker, no Playwright), write "NOT VERIFIED: <what> because <why>".
- `git push` runs `verify:quick` automatically (`.githooks/pre-push`). Don't bypass it with
  `--no-verify` unless the user asks.
