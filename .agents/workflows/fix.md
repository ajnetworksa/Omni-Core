---
description: Fix a bug — reproduce first, smallest fix, a test that would have caught it
---

1. Restate the bug in one sentence and the expected behaviour.
2. Reproduce it: a failing unit/e2e test, or exact steps with the output you saw. If you can't
   reproduce it, say so and ask for details (screenshot, logs: `docker compose logs --tail 100 omnicore-app`).
3. Find the cause in the code (quote the lines). No fix before you can explain the cause.
4. Make the smallest change that fixes the cause. Don't refactor around it.
5. Add or update a test that fails without the fix and passes with it.
6. Run `npm run verify` (plus `-- --browser` if it's a UI bug).
7. Add a "Fixed" line to `CHANGELOG.md` and update `docs/HANDOFF.md`.
8. Final message: cause, fix, test, REPORT.md table.
