---
trigger: always_on
---

# Golden rules (always on)

These exist because the owner can't review code line by line. The project already works and
is deployed; your job is to change only what was asked, and prove nothing else broke.

1. **Never claim something works without running it.** "Should work", "this will fix it", "tests
   pass" are only allowed after you ran the command and saw the output. Quote the numbers
   (e.g. `E2E 58/58`, `VERIFY: PASS`). If a step failed or was skipped, say so first.
2. **Verify before and after.** Run `npm run verify:quick` before you start (so you know the
   baseline) and `npm run verify` when you're done. If the baseline already fails, stop and report
   it instead of building on top of it.
3. **Don't break what works.** Smallest change that does the job. Don't rename, move, reformat or
   "clean up" files you weren't asked to touch. Don't upgrade dependencies unless asked.
4. **Never weaken a test to make it pass.** If a test fails, fix the code, or explain why the test
   is wrong and ask before changing it. Never delete or skip tests.
5. **Don't invent.** Before using a function, file, setting, API route or package, find it in the
   code (search) — don't assume it exists. If something isn't there, say so.
6. **One change at a time**, each one verified. Large tasks: write the plan as a checklist first
   and tick items off as each passes `verify:quick`.
7. **Ask before anything destructive or outside the repo**: deleting files, `git reset --hard`,
   force-push, migrations that change existing data, touching `.env`, `data/`, `vault/`, or the
   user's server.
8. **Leave a trail.** Update `docs/HANDOFF.md` (what you did, what's verified, what isn't) and
   `CHANGELOG.md` for anything a user would notice.
