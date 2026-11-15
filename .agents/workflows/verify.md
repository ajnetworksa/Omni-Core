---
description: Prove the project still works (build, all tests, optional browser + Docker) and report the result honestly
---

1. Run `git status` and note uncommitted changes.
2. Run `npm run verify`. For UI changes add `-- --browser`; for Docker/deps changes add `-- --docker`.
3. Open `tests/.run/verify/REPORT.md`.
4. If anything is FAIL: open the log path printed under that step, find the first real error,
   and report it (file, line, message). Don't guess; quote the error.
5. Reply with the REPORT.md table exactly as written, then one sentence: what passed, what failed
   or was skipped, and why.
