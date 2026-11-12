# OmniCore user guide

How to use each part of OmniCore day to day. Setup and updates are in [DEPLOY.md](DEPLOY.md); every setting is in [CONFIGURATION.md](CONFIGURATION.md).

## Telegram setup

1. Create a bot with **@BotFather**, put the token in `TELEGRAM_BOT_TOKEN`.
2. Start the server and message your bot. It replies with your numeric id; put that in
   `TELEGRAM_ALLOWED_USER_IDS` (comma-separate several) and restart.
3. Long polling is the default, and it works from behind NAT with no tunnel. For webhooks, set
   `TELEGRAM_WEBHOOK_URL` (see *Cloudflare* below).

**Buttons:** `/start` puts four buttons under the message box: 📋 Today · ➕ New task · 📁 Projects · ☰ Menu.
- **➕ New task**: type the title. A card appears where you tap the date (Today / Tomorrow / +3 days / none), a time, the priority and the project (or ➕ New project), then ✅ Save. Shortcuts you type (`!p1 @tomorrow 18:00`) are already filled in.
- **📁 Projects**: every project with done/total. Tap one to see its open tasks (tap a task to mark it done) and ➕ Add task. ➕ New project creates `projects/<name>.md`. Sending just `#project/name` opens that project, or offers to create it.
- **☰ Menu**: today's counts, 🔍 Search, 🤖 Ask, 🌅 Standup, ⌨️ Typing shortcuts, and 📱 Open the app when there's an https address (`quicktunnel` or `tunnel` + `PUBLIC_URL`).

Everything can also be typed:

| You send | What happens |
|---|---|
| `/todo Replace UPS battery !p1 @today 18:00 #homelab` | Task appended to today's daily note, reply with action buttons |
| `+ Buy SFP modules @tomorrow` | Same: a message starting with `+` is a task |
| `/note Router Ideas` ⏎ `Use VLAN 30 for IoT` | `inbox/router-ideas.md` (appends if it exists) |
| any other text | `- 14:05 text` under `## Log` in today's daily note |
| photo / voice / audio / video / file | saved to `vault/attachments/YYYY-MM/`, embedded in the log |
| `/today` | overdue · due today · pinned, with one-tap ✅ buttons |
| `/project homelab` | progress bar, overdue, blockers + latest remarks, next up, with buttons |
| `/project` · `#project/emo` | project list with buttons · open or create the `emo` project |
| `/search vlan` | matching tasks and notes with snippets |
| `/ask what's blocking the VLAN migration?` | answer from your notes with sources (AI) |
| `/standup` · `/retro` | summary of the day, also saved to the daily note (AI, template fallback) |
| voice note (with `STT_BASE_URL`) | transcript in the log + "I heard 2 tasks" with **✅ Add all** |
| photo (with a vision model) | `inbox/<title>.md` with the text and specs it read |

### Reminder buttons

`✅ Done` · `🌗 Partial` (25/50/75% / started) · `💬 Remark` (reply with the update) ·
`⏱ +1h` · `🌅 Tomorrow` (moves the due date to `TOMORROW_TIME`, written to the file) · `🔕 Today`

## Nag engine

Every `NAG_TICK_SECONDS` it re-derives each open task's state from the task + `reminders_log`
(stateless, so restarts never duplicate or lose reminders):

| State | When | Default cadence |
|---|---|---|
| **overdue** | due time passed, no progress | every 30 min |
| **partial** | `[/]`, progress set, or some subtasks done | every 60 min, shows % and n/m subtasks |
| **remark** | a remark was added, or `[!]` blocked | every 120 min, quotes the last remark |

- p1 tasks, and tasks rolled over 3+ times, each halve the interval (minimum 10 min).
- Any action (remark, partial, snooze) resets the timer. When a snooze or mute ends, the next ping
  goes out right away.
- Quiet hours (`23:00-07:00`) hold pings, which resume when the window ends.
- Tasks with a date but no time are due at `NAG_DEFAULT_DUE_TIME`. Backlog tasks never nag.
- At most `NAG_MAX_PER_TICK` per tick, most urgent first. A morning digest goes out at `DIGEST_TIME`.

## Markdown syntax

```
- [ ] Title !p1 🔁 every week 📅 2026-11-12 14:00 #tag #project/homelab ✅ 2026-11-11 ^oc-xxxxxxxx
```

| Checkbox | Status | | Token | Meaning |
|---|---|---|---|---|
| `[ ]` | ready / backlog | | `!p1`–`!p4` | priority |
| `[/]` | in progress | | `📅 date [HH:mm]` | due (quick-add: `@today` `@tomorrow` `@+3d`) |
| `[!]` | blocked | | `🔁 every …` | recurrence (see below) |
| `[x]` | done | | `✅ date` | completion date (written automatically) |
| `[-]` | cancelled | | `#project/slug` | assigns a project; or `project:` in frontmatter |

**Recurrence** (compatible with the Obsidian Tasks plugin): `every day`, `every 3 days`, `every week`,
`every 2 weeks`, `every month`, `every year`, `every weekday` (skips `WEEKEND_DAYS`, Fri+Sat by default),
`every monday, thursday`, plus `… when done` to count from completion. Completing a recurring task
inserts the next occurrence above it.

## How sync works

- The **markdown file is the source of truth.** The DB holds the index plus state that markdown can't
  express: remarks, progress, snoozes, rollover count, pinned, backlog vs ready.
- Each task line gets an Obsidian block anchor (`^oc-…`) for stable identity across edits and moves.
  Turn this off with `TASK_ANCHORS=false`.
- API and Telegram changes edit only that one line, via an atomic temp file + rename, and keep CRLF line endings.
- If the line can't be found, the API returns **409**, re-indexes, and the bot says "try again".
- **Rollover:** at 23:59:59 local, open tasks due today or earlier move to tomorrow and get `rollover_cnt += 1`.
  The new date is written to the file, and a catch-up pass runs on startup.

## Web app & Mini App

Screenshots: [`screenshots/ui/`](screenshots/ui/).

**Web app** (`/`), dark theme:
- **Today**: what needs attention, what's later today, and what's done. The right rail shows the daily note, a quick log and the next nudge.
- **Task drawer**: subtasks, remarks, nudge history, and the source line with *Open note* / *Open in Obsidian*.
- **Upcoming**, **Inbox**, a drag-and-drop **Board**, **Notes** (folder tree, editor, backlinks) and **Graph**.
- **⌘K** opens the command palette.

The quick-add box understands `!p1`, `@tomorrow 10:00`, `#tag` and `#project/slug`, and previews them as chips.

Editing a note from the UI checks the file's checksum first. If Obsidian changed the file in the meantime, the save is refused rather than overwriting it.

**Telegram Mini App** (`/tg`) is a light, phone-first view: Today, Upcoming, Projects, task detail and add.
- It follows your Telegram theme (light or dark) and uses Telegram's own main/back buttons and haptics.
- It signs in automatically with Telegram's signed `initData`. Only user ids in `TELEGRAM_ALLOWED_USER_IDS` are accepted.

To enable it:
1. Set `PUBLIC_URL=https://your-host` (Telegram requires https).
2. Restart the server. The bot then sets its menu button to **Open**, and reminders get an **📱 Open in app** button.

Sessions:
- Both use an HttpOnly signed cookie: 30 days for the web app, 12 h for the Mini App.
- Rotating `API_TOKEN` or the bot token logs everyone out.
- Scripts can still use `Authorization: Bearer <API_TOKEN>`.

## AI (local first)

Everything runs on local models through [Ollama](https://ollama.com) by default:

```bash
ollama pull llama3.2:3b         # chat: Ask, breakdown, voice → tasks, standup/retro
ollama pull nomic-embed-text    # embeddings for the semantic index
ollama pull llama3.2-vision     # optional: photos → notes (set AI_VISION_MODEL)
```

With Docker, put `COMPOSE_PROFILES=ai` in `.env` and run `docker compose up -d`. That starts Ollama next to the app, connects the app to it, and downloads `AI_CHAT_MODEL`, `AI_EMBEDDING_MODEL` and `AI_VISION_MODEL` if they're missing (watch `docker compose logs -f omnicore-app`; `AI_AUTO_PULL=false` turns that off). The `ollama pull` commands above are only for Ollama you run yourself. If Ollama already runs on the host, set `OLLAMA_BASE_URL=http://host.docker.internal:11434` instead.

The AI buttons stay hidden until the model server answers. The sidebar shows the AI status, and hovering it shows the details.

| Feature | Where | What it does |
|---|---|---|
| **Ask** | ⌘K → Tab, `/ask` | Answers from your notes and tasks only, with numbered sources you can click. Understands dates like "last quarter", "in March" or "past 10 days". |
| **Related** | ⌘K search | Finds passages by meaning as well as by exact words. |
| **Break down** | Task panel, Mini App | Suggests 3–7 subtasks. You edit or untick them, then they're written as nested checkboxes under the task. |
| **Voice → tasks** | Telegram voice note | Transcribes it, saves the transcript to today's log, and lists the tasks it heard. **✅ Add** creates them; nothing is created without that tap. |
| **Photo → note** | Telegram photo | A vision model reads the labels, serials and specs into an `inbox/` note with the photo embedded. |
| **Standup / retro** | `DIGEST_TIME`, `RETRO_TIME`, `/standup`, `/retro`, Today panel | Written into the daily note under `## Standup` and `## Retro`, and sent to Telegram. If the model is down, a plain template is used instead. |
| **Varied reminders** | `AI_NAG_VARIATION=true` | Adds a one-line nudge in different words to each reminder. Local model only; skipped if it takes more than 6 s. |

**The semantic index**
- Notes are split by heading. Each task gets its own entry with its status, dates, project and remarks.
- Only changed notes are re-embedded, every `AI_EMBED_INTERVAL_SECONDS`.
- Vectors are stored in SQLite with [sqlite-vec](https://github.com/asg017/sqlite-vec). If the extension can't load, a built-in search is used.
- Changing the embedding model rebuilds the index automatically.

**Voice notes** need a speech-to-text server, because Ollama doesn't transcribe audio. Any OpenAI-compatible `/v1/audio/transcriptions` endpoint works, e.g. a local faster-whisper server. Set `STT_BASE_URL`.

**Privacy and safety**
- `CLOUD_MODE=off` is the default, so nothing leaves the machine. `fallback` uses `CLOUD_PROVIDER` (anthropic, openai or gemini) only when the local model fails; `prefer` uses it first.
- Embeddings and reminder wording never go to the cloud.
- Model output is treated as untrusted text:
  - Answers are shown as plain text.
  - Suggested titles are flattened to a single line, with checkboxes, anchors, dates and newlines removed.
  - Standup and retro text can't add headings or tasks.
  - Ask has no write path, so a note that says "ignore your instructions and…" can't change anything.
- Requests queue one at a time (`AI_CONCURRENCY`). Extra requests get a 429 instead of overloading the machine.

## Cloudflare Tunnel

1. In Zero Trust → Networks → Tunnels, create a tunnel and copy its token into `CLOUDFLARE_TUNNEL_TOKEN`.
2. Add a public hostname, e.g. `workspace.example.com` → `http://omnicore-app:3000`.
3. Add `tunnel` to `COMPOSE_PROFILES` in `.env` (e.g. `COMPOSE_PROFILES=ai,tunnel`) and run `docker compose up -d`.
4. Protect it with **Cloudflare Access** (One-time PIN or OAuth). If you use webhook mode, add a
   **Bypass** policy for the path `/telegram/*`, since Telegram can't log in. The webhook is protected
   by `TELEGRAM_WEBHOOK_SECRET` instead. Or stay on long polling and skip this step.
5. **Mini App:** Telegram's in-app browser can't get through an Access login.
   - Add a second hostname (e.g. `tg.example.com`) pointing to the same service, with an Access **Bypass** policy, and use it as `PUBLIC_URL`.
   - It is still protected: every session there needs Telegram-signed `initData` from an allow-listed user, or the API token.

