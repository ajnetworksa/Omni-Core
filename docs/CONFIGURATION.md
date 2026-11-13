# Configuration

Every setting is an environment variable, normally set in `.env` (copy `.env.example`).
The everyday ones (reminders, quiet hours, summaries, time zone, weekend…) can also be changed in the app under **Settings**; those are stored in the database and override `.env`.
This file is generated from `apps/server/src/config.ts` by `node scripts/config-docs.mjs`; don't edit it by hand.

Invalid values stop the server at startup with a message naming the setting.

## Core

| Setting | Default | What it does |
|---|---|---|
| `NODE_ENV` | `development` | "production" turns on info-level logging (Docker sets it). |
| `PORT` | `3000` | HTTP port. |
| `HOST` | `127.0.0.1` | Loopback by default. Docker sets 0.0.0.0 (the compose file only publishes it on 127.0.0.1). |
| `PUBLIC_URL` | — | Public https URL of this app (Cloudflare tunnel hostname). Enables the Telegram Mini App buttons. |
| `QUICK_TUNNEL_METRICS` | — | Metrics address of the "quicktunnel" extra (set automatically); its https address is used when PUBLIC_URL is empty. |
| `COOKIE_SECURE` | — | Force the Secure flag on session cookies (default: auto from the request protocol). |
| `WEB_DIST` | — | Built web app to serve at / (default: apps/web/dist next to the server). |
| `TRUST_PROXY` | `false` | Behind Cloudflare Tunnel: identify clients by CF-Connecting-IP (only safe when the port isn't publicly reachable). |
| `CORS_ORIGINS` | — | Comma-separated allowed browser origins for CORS. Empty → no cross-origin access. |
| `TIMEZONE` | `Asia/Riyadh` | IANA time zone for "today", due times, quiet hours and the midnight rollover. |
| `VAULT_PATH` | `./vault` | Folder of Markdown notes (an Obsidian vault works as-is). |
| `DATABASE_PATH` | `./data/app.db` | SQLite index and app state. Rebuildable from the vault except remarks, reminder history and the AI index. |
| `TASK_ANCHORS` | `true` | Add a hidden ^oc-xxxxxxxx block id to task lines so a task keeps its identity when edited or moved. |
| `TASK_DONE_DATE` | `true` | Write Obsidian-Tasks ✅ YYYY-MM-DD on completion. |
| `WEEKEND_DAYS` | `fri,sat` | Weekend for "every weekday" recurrence. |
| `VAULT_POLLING` | `false` | Poll the vault instead of filesystem events (needed for Docker bind mounts from Windows/macOS hosts). |
| `REINDEX_INTERVAL_MINUTES` | `15` | Full re-scan as a safety net for missed file events. 0 disables. |
| `REDIS_URL` | — | Optional Redis for the BullMQ scheduler. Empty = built-in timers (default; the tested path). |
| `API_TOKEN` | — | Web/API password (bearer token for /api/*). Empty in Docker: one is generated into data/api-token on first start. |

## Telegram

| Setting | Default | What it does |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | — | From @BotFather. Empty disables the bot and reminders. |
| `TELEGRAM_ALLOWED_USER_IDS` | — | Comma-separated Telegram user ids allowed to use the bot and the Mini App. Everyone else is ignored. |
| `TELEGRAM_WEBHOOK_URL` | — | Public URL for webhook mode, e.g. https://workspace.example.com/telegram/webhook. Empty → long polling. |
| `TELEGRAM_WEBHOOK_SECRET` | — | Secret Telegram sends with webhook calls; required with TELEGRAM_WEBHOOK_URL. |
| `TELEGRAM_API_ROOT` | `https://api.telegram.org` | Bot API base URL. Change only for a self-hosted Bot API server (or tests). |

## Nag engine

| Setting | Default | What it does |
|---|---|---|
| `NAG_ENABLED` | `true` | Send escalating Telegram reminders. |
| `NAG_TICK_SECONDS` | `60` | How often the nag engine looks for reminders to send. |
| `NAG_INTERVALS` | `overdue=30,partial=60,remark=120` | Minutes between pings per state, e.g. "overdue=30,partial=60,remark=120". |
| `NAG_QUIET_HOURS` | `23:00-07:00` | No reminders in this window (local time), e.g. "23:00-07:00". Empty = none. |
| `NAG_DEFAULT_DUE_TIME` | `09:00` | Due time for tasks that only have a date. |
| `NAG_MAX_PER_TICK` | `5` | At most this many reminders per tick (the rest wait); keeps bursts readable. |
| `TOMORROW_TIME` | `08:00` | Time "🌅 Tomorrow" moves a task to. |

## AI

| Setting | Default | What it does |
|---|---|---|
| `AI_PROVIDER` | `ollama` | Local model server: "ollama", "openai" (any OpenAI-compatible server such as LM Studio), or "none". One of: ollama · openai · none. |
| `OLLAMA_BASE_URL` | `http://127.0.0.1:11434` | Ollama root (…:11434) or, for AI_PROVIDER=openai, the /v1 base URL. |
| `AI_BASE_URL` | — | With AI_PROVIDER=openai: the server's /v1 URL (LM Studio, llama.cpp, vLLM). |
| `AI_API_KEY` | — | API key for an OpenAI-compatible local server, if it needs one. |
| `AI_CHAT_MODEL` | `llama3.2:3b` | Chat model for Ask, breakdown, voice extraction and summaries. |
| `AI_AUTO_PULL` | `true` | With Ollama: download the chat, embedding and vision models on first start if they're missing. |
| `AI_EMBEDDING_MODEL` | `nomic-embed-text` | Embedding model for the semantic index. Changing it rebuilds the index. |
| `AI_VISION_MODEL` | — | Optional local vision model for photos, e.g. "llama3.2-vision" or "qwen2.5vl:7b". |
| `CLOUD_MODE` | `off` | Cloud model: off (default — nothing leaves this machine), fallback (when local fails), prefer (cloud first). One of: off · fallback · prefer. |
| `CLOUD_PROVIDER` | — | Cloud model provider when CLOUD_MODE is not off. One of: anthropic · openai · gemini. |
| `CLOUD_API_KEY` | — | API key for CLOUD_PROVIDER. Never logged or shown. |
| `CLOUD_MODEL` | — | Cloud model name (defaults per provider). |
| `CLOUD_BASE_URL` | — | Override the provider URL (proxy or gateway). |
| `STT_BASE_URL` | — | OpenAI-compatible speech-to-text (/v1/audio/transcriptions), e.g. a local faster-whisper server. |
| `STT_API_KEY` | — | API key for the speech-to-text server, if it needs one. |
| `STT_MODEL` | `whisper-1` | Speech-to-text model name. |
| `STT_LANGUAGE` | — | Optional language hint for transcription, e.g. "en" or "ar". |
| `AI_TIMEOUT_SECONDS` | `90` | Give up on a model call after this long. |
| `AI_CONCURRENCY` | `1` | Model calls at once; extra requests queue (max 6) and then get 429. |
| `AI_EMBED_INTERVAL_SECONDS` | `120` | How often to re-embed changed notes and tasks. 0 disables the semantic index. |
| `AI_VECTOR_ENGINE` | `auto` | "auto" uses sqlite-vec when it loads; "js" forces the built-in brute-force search. One of: auto · js. |
| `AI_NAG_VARIATION` | `false` | Varied wording for reminders, from the local model. |

## Updates

| Setting | Default | What it does |
|---|---|---|
| `UPDATE_CHECK_REPO` | — | "owner/repo" on GitHub: check for new releases and show "Update available" in the app. Empty = off. |
| `UPDATE_CHECK_HOURS` | `12` | How often to ask GitHub for a new release. |
| `GITHUB_API_ROOT` | `https://api.github.com` | Test hook / GitHub Enterprise. |
| `RETRO_TIME` | `21:00` | Evening retro time; empty disables. The morning digest becomes an AI standup when AI is on. |
| `DIGEST_TIME` | `08:00` | Morning /today digest time; empty disables. |

## Docker-only

| Setting | Default | What it does |
|---|---|---|
| `OMNICORE_IMAGE` | — | Use a prebuilt image (e.g. `ghcr.io/<owner>/<repo>:latest`) instead of building on the server. `scripts/update.sh` then pulls it. |
| `COMPOSE_PROFILES` | — | Extras to run, comma-separated: `ai` (bundled Ollama; the app points at it and downloads the models), `quicktunnel` (instant trycloudflare.com https address; sets the Mini App button), `tunnel` (Cloudflare Tunnel on your domain), `redis` (Redis scheduler; the app points at it). |
| `LISTEN` | `127.0.0.1` | Address the web port is published on; `0.0.0.0` opens it to your local network. |
| `PUID` / `PGID` | owner of `vault/`, else `1000` | The user the app runs as inside the container; owns `data/` and `vault/`. |
| `CLOUDFLARE_TUNNEL_TOKEN` | — | Token for the `tunnel` extra. |

## Update script (`scripts/update.sh`)

| Variable | Default | What it does |
|---|---|---|
| `OMNICORE_MODE` | auto | `docker`, `image` or `node`. |
| `OMNICORE_URL` | `http://127.0.0.1:$PORT` | Where to check `/health`. |
| `OMNICORE_SERVICE` | `omnicore` | systemd unit / pm2 name in node mode. |
| `OMNICORE_RESTART_CMD`, `OMNICORE_STOP_CMD` | — | Custom restart/stop commands in node mode. |
| `OMNICORE_HEALTH_TIMEOUT` | `120` | Seconds to wait for the new version to answer. |
