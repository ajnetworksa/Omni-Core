---
description: Add a feature safely — baseline, plan, small verified steps, tests, docs
---

1. Read `AGENTS.md`, `docs/HANDOFF.md` and the parts of `docs/ARCHITECTURE.md` that touch the feature.
2. Baseline: run `npm run verify:quick`. If it fails, stop and report (don't build on a broken base).
3. Search the code for what already exists (routes in `apps/server/src/routes/api.ts`, screens in
   `apps/web/src/app/`, task logic in `packages/core/src/tasks/service.ts`). List the files you'll
   change and the ones you'll add. Ask the user if anything is unclear or the change is large.
4. Write the plan as a checklist (in your plan / task artifact).
5. For each item: make the change → `npm run verify:quick` → tick it off. Keep changes minimal.
6. Add tests: unit test (core or server) + an end-to-end check (`tests/e2e.mjs`, or
   `demo/peek-app.mjs` for screens). UI follows the rules in AGENTS.md (one app for web and
   Telegram, plain words from `app/words.ts`, Paper colour tokens, Confirm + Undo for deletes).
7. Run `npm run verify` (add `-- --browser` for UI). Look at the screenshots for UI work.
8. Update `CHANGELOG.md`, `docs/GUIDE.md` / `README.md` if usage changed, `docs/DECISIONS.md` for
   non-obvious choices, and `docs/HANDOFF.md`.
9. Final message: what changed (files), how it was tested, the REPORT.md table, anything not verified.
