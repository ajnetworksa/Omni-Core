# Deploy, update, back up

Short version: clone → `cp .env.example .env` → fill in → `docker compose up -d`. Everything else below is detail.

## 1. Put the code on GitHub (once)

From your development folder (Windows: Git Bash or PowerShell):

```bash
git init -b main
git add -A
git update-index --chmod=+x scripts/install.sh scripts/update.sh   # Windows doesn't record the executable bit
git commit -m "OmniCore 0.5.1"
git tag v0.5.1
# create an empty PRIVATE repo on github.com first (no README), then:
git remote add origin https://github.com/<you>/omnicore.git
git push -u origin main --tags
```

`.gitattributes` keeps Linux line endings for the scripts, and `.gitignore` already keeps `.env`, `/data/`, `/vault/` and build output out of git. Check `git status` before the first push anyway: your notes and tokens must never be committed.

What GitHub does from then on (`.github/workflows/`):
- **CI** on every push and PR: build, all unit/E2E/security/AI suites, a Docker image smoke test.
- **Release image** on every push to `main` (`:edge`) and every `vX.Y.Z` tag (`:X.Y.Z`, `:X.Y`, `:latest`):
  - multi-arch (amd64 + arm64) images go to `ghcr.io/<you>/omnicore`;
  - tags also create a GitHub Release with notes taken from `CHANGELOG.md`.

The image is private if the repo is private. The server then needs `docker login ghcr.io` (below), or you can make the package public in GitHub → Packages.

## 2. Install on the server

You need a Linux server with Docker and git. Fresh Ubuntu/Debian:

```bash
sudo apt update && sudo apt install -y git
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER      # then log out and back in
```

Then:

```bash
sudo mkdir -p /opt/omnicore && sudo chown $USER /opt/omnicore
git clone https://github.com/<you>/omnicore.git /opt/omnicore && cd /opt/omnicore
cp .env.example .env
nano .env                 # fill in what you want (below); anything left empty stays off
docker compose up -d      # the first start builds the app: a few minutes
cat data/api-token        # web password (unless you set API_TOKEN yourself)
```

Private repo? GitHub asks for a password on `git clone`. Use a [fine-grained token](https://github.com/settings/personal-access-tokens) with read access to this one repo, or add a read-only deploy key (repo → Settings → Deploy keys) and clone with `git@github.com:<you>/omnicore.git`.

**Changing settings later:** edit `.env`, then `docker compose up -d`. Only what changed restarts.

### What to put in `.env`

| You want | Set | Notes |
|---|---|---|
| Your time zone | `TIMEZONE=Asia/Riyadh` | |
| Telegram bot + reminders | `TELEGRAM_BOT_TOKEN=` from @BotFather | Message the bot. It replies with your user id: put that in `TELEGRAM_ALLOWED_USER_IDS` and run `docker compose up -d`. |
| Local AI | `COMPOSE_PROFILES=ai` | Starts Ollama, connects the app, and downloads `AI_CHAT_MODEL` + `AI_EMBEDDING_MODEL` (about 2.3 GB; watch `docker compose logs -f omnicore-app`). Needs about 8 GB RAM. |
| Mini App + phone access, quickly | `COMPOSE_PROFILES=quicktunnel` | A free `https://….trycloudflare.com` address, no account or domain. The bot sends you the link and sets the **Open** button. The address changes whenever the tunnel restarts. Good for trying it out. |
| Access from anywhere, permanently | `COMPOSE_PROFILES=tunnel`, `CLOUDFLARE_TUNNEL_TOKEN=` | Your own domain, behind Cloudflare Access. See below. |
| Telegram Mini App on your domain | `PUBLIC_URL=https://tg.yourdomain.com` | With `tunnel`; see below. |
| Web app from other devices at home | `LISTEN=0.0.0.0` | Then `http://<server-ip>:3000`. Plain http, so keep it to your own network. |

Several extras: `COMPOSE_PROFILES=ai,quicktunnel`. The Telegram Mini App needs an https address, which is why it only appears with `quicktunnel` or `tunnel`.

Docker sets the app's own paths, port and folder permissions. The app creates `data/` and `vault/` and runs as the owner of `vault/` (uid 1000 if Docker created it). Every setting is in [CONFIGURATION.md](CONFIGURATION.md).

### Cloudflare Tunnel (no open ports)

1. Cloudflare **Zero Trust** → Networks → Tunnels → **Create a tunnel** → Cloudflared. On the install screen, copy only the token (`eyJ…`) into `CLOUDFLARE_TUNNEL_TOKEN`, and add `tunnel` to `COMPOSE_PROFILES`. Run `docker compose up -d`.
2. In the tunnel's **Public Hostname** tab, add `workspace.yourdomain.com` → type **HTTP**, URL **`omnicore-app:3000`**.
3. Access → Applications → add `workspace.yourdomain.com`, with an email One-time PIN rule for your address, so only you get in.
4. Mini App (optional): add a second hostname, e.g. `tg.yourdomain.com` → `omnicore-app:3000`, with an Access **Bypass** rule (Telegram's in-app browser can't do the Access login; Telegram's signed login protects it instead). Set `PUBLIC_URL=https://tg.yourdomain.com` and run `docker compose up -d`. Details: [GUIDE.md](GUIDE.md#cloudflare-tunnel).

**About the quick tunnel:** anyone who knows the random address can reach the sign-in page. The web app still needs the password, and the Mini App needs your Telegram account, but there's no Cloudflare Access in front. For daily use, move to `tunnel` with your own domain.

Without a tunnel, the web app is reachable on the server only (`127.0.0.1:3000`), or on your network with `LISTEN=0.0.0.0`. From your PC: `ssh -L 3000:127.0.0.1:3000 you@server`, then open http://127.0.0.1:3000. The Telegram bot works either way.

### Check it works

- `docker compose ps`: `omnicore_app` shows **(healthy)**.
- Send the bot `/todo Test !p1 @today 10:00`; it shows up in the web app.
- Logs: `docker compose logs -f omnicore-app`.

Existing Obsidian vault? Change `./vault:/vault` in `docker-compose.yml` to its path. If the files live on a Windows/macOS-shared mount, set `VAULT_POLLING=true`.

`scripts/install.sh` does the same as the commands above (copies `.env` if missing, starts, waits, tells you where the password is) if you prefer one command.

## 3. Update

```bash
cd /opt/omnicore
scripts/update.sh --check     # anything new? (exit code 10 = yes)
scripts/update.sh             # show changes → confirm → back up → update → verify
```

What it does, every time:
1. `git fetch`, then shows the commits and any **database migrations**.
2. Snapshots the database to `data/backups/app-<time>-pre-update-<commit>.db`, using SQLite's online backup, so the app stays up.
3. Checks out the new code and rebuilds/restarts (the extras in `COMPOSE_PROFILES` keep running):
   - **docker** (default): `docker compose build` + `up -d`.
   - **image** (`OMNICORE_IMAGE` set in `.env`): `docker compose pull` + `up -d`.
   - **node**: `npm ci && npm run build`, then restarts the systemd unit `omnicore` (or pm2, or `OMNICORE_RESTART_CMD`).
4. Waits until `/health` reports the **new commit**.
5. If anything fails, it **rolls back on its own**: the old code goes back, and if the new version had started and migrations were included, the pre-update database too. Then it checks the old version is healthy.

Other options:

```bash
scripts/update.sh --yes            # no prompt (cron, CI)
scripts/update.sh --ref v0.6.0     # a specific tag or branch
scripts/update.sh --rollback       # back to the version before the last update
```

**Prebuilt images instead of building on the server** (faster, good for a Raspberry Pi):

```bash
echo "OMNICORE_IMAGE=ghcr.io/<you>/omnicore:latest" >> .env
echo <a GitHub token with read:packages> | docker login ghcr.io -u <you> --password-stdin   # private repos only
scripts/update.sh
```

**Automatic updates** (optional): a weekly systemd timer.

```ini
# /etc/systemd/system/omnicore-update.service
[Service]
Type=oneshot
WorkingDirectory=/opt/omnicore
ExecStart=/opt/omnicore/scripts/update.sh --yes
User=<you>

# /etc/systemd/system/omnicore-update.timer
[Timer]
OnCalendar=Fri 04:00
Persistent=true
[Install]
WantedBy=timers.target
```

`sudo systemctl enable --now omnicore-update.timer`. Releases are tested in CI, and the script rolls back on failure. Even so, a weekly timer at a quiet hour is safer than a nightly one.

## 4. Without Docker (node mode)

```bash
git clone https://github.com/<you>/omnicore.git /opt/omnicore && cd /opt/omnicore
cp .env.example .env    # edit
npm ci && npm run build
```

```ini
# /etc/systemd/system/omnicore.service
[Unit]
Description=OmniCore Workspace
After=network-online.target
[Service]
WorkingDirectory=/opt/omnicore
ExecStart=/usr/bin/node apps/server/dist/boot.js
Restart=on-failure
User=<you>
Environment=NODE_ENV=production
[Install]
WantedBy=multi-user.target
```

`sudo systemctl enable --now omnicore`. `scripts/update.sh` detects node mode and restarts the unit; give your user passwordless `sudo systemctl restart omnicore`, or set `OMNICORE_RESTART_CMD`.

## 5. Backups and restore

```bash
docker compose exec omnicore-app node apps/server/dist/backup.js          # snapshot now
docker compose exec omnicore-app node apps/server/dist/backup.js --list
# restore (the app must be stopped):
docker compose stop omnicore-app
docker compose run --rm --no-deps omnicore-app node apps/server/dist/backup.js --restore /data/backups/<file>.db
docker compose up -d omnicore-app
```

Node mode: `npm run backup`, `node apps/server/dist/backup.js --restore data/backups/<file>.db`.

Snapshots keep the newest 20 (`--keep N`). The **vault is plain files**: back it up with git, Syncthing, your NAS or restic. The database holds what isn't in the files (remarks, reminder history, snoozes, the AI index), so copy `data/backups/` off the machine too.

## 6. Troubleshooting

| Symptom | Fix |
|---|---|
| Files in `vault/` owned by the wrong user | Set `PUID`/`PGID` in `.env` to your `id -u` / `id -g` and run `docker compose up -d`; the app re-owns the folders on start |
| AI buttons don't appear | Is `ai` in `COMPOSE_PROFILES`? The first start downloads the models; `docker compose logs omnicore-app \| grep ai` shows progress. Your own Ollama: `OLLAMA_BASE_URL=http://host.docker.internal:11434` (`127.0.0.1` inside Docker is the container itself). |
| Web app doesn't open | On the server itself: `curl -s localhost:3000/health`. If that answers, the app is fine and it's the address you're using: from another device you need `LISTEN=0.0.0.0` (then `http://<server-ip>:3000`) or a tunnel. With Docker inside WSL, open `http://localhost:3000` in Windows. |
| No "Open" button / Mini App in Telegram | Telegram needs https: add `quicktunnel` (or `tunnel` + `PUBLIC_URL`) and run `docker compose up -d`. Reopen the chat after the bot sends the link. |
| Forgot the web password | `cat data/api-token` (or `API_TOKEN` in `.env` if you set one) |
| Edits in Obsidian aren't picked up | `VAULT_POLLING=true` (Docker on Windows/macOS) |
| `update.sh`: "local changes to tracked files" | Someone edited files on the server: `git stash` or `git diff` them, then retry |
| `update.sh`: "this branch tracks nothing" | You're on a pinned tag: `git checkout main`, then `scripts/update.sh` |
| Health check never passes | `docker compose logs --tail 100 omnicore-app`; the script has already rolled back |
