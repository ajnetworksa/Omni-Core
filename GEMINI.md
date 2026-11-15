# GEMINI.md — Antigravity / Gemini entry point

All project rules are in **AGENTS.md** (read it fully at the start of every session), plus the
always-on rules in `.agents/rules/`. This file only adds what's specific to Antigravity.

@AGENTS.md

## Antigravity specifics
- **Proof, not claims.** A task is finished only when you have run `npm run verify` (or
  `npm run verify:quick` for a doc-only change) and pasted the final table from
  `tests/.run/verify/REPORT.md` into your reply / walkthrough artifact. If you couldn't run it,
  say so plainly and say what is unverified.
- Use the workflows: `/verify`, `/feature`, `/fix`, `/release`, `/deploy`, `/handoff`.
- Before you run a command that deletes files, rewrites git history, touches `data/`, `vault/`,
  `.env`, or runs anything on the user's server: stop and ask.
- Browser checks: if you use the built-in browser to look at the app, also run
  `npm run verify -- --browser`; the scripted walkthrough is the evidence, screenshots are a bonus.
- Keep the plan short and do one change at a time; run `npm run verify:quick` after each step
  rather than at the very end.
