---
trigger: always_on
---

# Safety: data, secrets, deploys

- **Data lives in files.** The user's notes and tasks are Markdown in `vault/`; the database in
  `data/` is an index plus settings. Never edit or delete anything in `vault/` or `data/`, and
  never write task changes to SQLite directly — go through `TaskService` (it writes the file).
- **Secrets**: never print, log, commit or paste `.env`, `data/api-token`, `API_TOKEN`,
  `TELEGRAM_BOT_TOKEN`, `CLOUD_API_KEY`, `CLOUDFLARE_TUNNEL_TOKEN`. `.env.example` has no secrets
  and is the only env file in git.
- **Migrations** (`packages/core/migrations/`): add a new numbered file; never edit or delete an
  existing one — servers have already applied them.
- **Deleting a source file**: also check nothing imports it (`npm run verify:quick` will tell you),
  and mention it in your summary. The server is updated with `git pull`, which removes deleted
  files; a zip/copy would leave them behind and break the build (this happened once).
- **Git**: before committing run `git status` and make sure no `.env`, `data/`, `vault/`, `*.zip`
  or `*.db` is staged (`npm run verify` checks this too). No force-push, no rewriting history.
- **The live server** (`~/app` on the user's Linux box, Docker Compose, Cloudflare Tunnel) is
  updated only by the user, with `scripts/update.sh` (backup + automatic rollback) or
  `git pull && docker compose up -d --build`. Give them the command; don't assume you can run it.
- **Security model** (auth, CSRF header, CSP, Telegram initData check) is covered by
  `tests/security.mjs` (26 checks). Any change near `apps/server/src/http.ts`, `auth.ts`,
  `security.ts` or `routes/api.ts` must keep that suite green.
