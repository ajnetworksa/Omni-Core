---
description: Help the user update or troubleshoot the live server (they run the commands, you read the output)
---

The server is the user's Linux machine: project in `~/app`, Docker Compose, `.env` with
`COMPOSE_PROFILES` (e.g. `ai,tunnel`), Cloudflare Tunnel to their domain, `PUBLIC_URL` for the
Telegram Mini App. You can't reach it; give commands and read what they paste back.

Update:
1. `cd ~/app && git status` → must be a clean git checkout (if not: see "Stale files" below).
2. `scripts/update.sh` (shows what's new, backs up the DB, rebuilds, checks health, rolls back on
   failure). Simple alternative: `git pull && docker compose up -d --build`.
3. `docker compose ps` → `omnicore_app` must be `Up (healthy)`.

Troubleshoot (ask for the output, then explain the cause before suggesting a fix):
- App: `docker compose logs --tail 80 omnicore-app`
- Tunnel: `docker compose logs --tail 30 omnicore-tunnel` (route must point to `http://omnicore-app:3000`)
- Health: `curl -s localhost:3000/health`
- Config problems print `Invalid configuration: … at <SETTING>` at start-up.

Stale files: a build error naming a file that no longer exists in git means the folder wasn't
updated with git (zip/copy). Fix: `git fetch origin && git reset --hard origin/main && git clean -n`
(`.env`, `data/`, `vault/` are ignored by git and stay). Ask before running `reset --hard`.
