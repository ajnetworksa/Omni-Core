# Roadmap

## Goals (from the spec)

1. **One place** for notes, tasks and projects, stored as plain Markdown you own and can edit in Obsidian.
2. **Nothing gets silently forgotten**: reminders escalate until a task is done, snoozed or explained.
3. **Capture from anywhere**: Telegram text, voice and photos, plus the web app.
4. **Runs on your own box**: Docker on one Linux host, no open ports (Cloudflare Tunnel), local AI by default.

## Next: Phase 6, the work diary

Approved direction (mockups: https://claude.ai/artifact/CjcuWhuNMbnrJMiUxky5vN). It's mostly a **work** diary: client sites, hours, work done.

**Capture during the day**
- Text or voice the bot.
- Telegram location pins (incl. live location).
- Photos.
- OmniCore activity is picked up automatically: tasks closed, remarks, notes edited.

**Places**
- Saved places with a radius, each linked to a client or project. A visit counts after 10 min inside the radius.
- Unknown spots get a prompt: "Name this place?" / "Just passing".
- Optional sources:
  - OwnTracks / Dawarich location history (self-hosted);
  - calendar `.ics` links for meetings;
  - photo EXIF locations;
  - OpenStreetMap reverse lookup (opt-in, since it sends coordinates).

**Evening check-in** (default 21:30, Sunday–Thursday)
- One or two specific questions about gaps. Answer by voice or text, or tap Skip.
- The entry is written to `journal/YYYY/MM/YYYY-MM-DD.md`: headline, summary, timeline, work done (linked tasks), people, photos, frontmatter (places, people, tags, hours).
- A "My notes" section is never rewritten.

**Views**
- Web: month calendar with headlines, hours and site tags; day entry; "On this day".
- Monthly work report: by client and site, hours per week, open items, timesheet, export to PDF / Markdown / email.
- Mini App: Diary tab with a week strip.

**Roll-ups and search**
- Weekly (`YYYY-Www.md`) and monthly (`YYYY-MM.md`) summaries are written automatically.
- People pages collect mentions.
- Ask searches the diary (toggle).

**Settings**: sources, saved places, check-in time and work week, sync and AI toggles (cloud for the diary is off by default).

Suggested order:
1. Data model (`places`, `visits`, `diary_entries`) and Telegram location capture.
2. Evening check-in and the daily entry file.
3. Calendar and day views.
4. Weekly/monthly reports and timesheet export.
5. OwnTracks / Dawarich and `.ics` import.

## Then: Phase 7, sync (spec §3.7)

- **git auto-commit and push** of the vault (simplest; full history).
- **WebDAV / Nextcloud** and **S3 / R2 / MinIO** backup of the vault and DB snapshots (rclone, or direct).
- **Google Drive** two-way sync is hardest to get right; consider it last.
- The diary's "include in sync" toggle depends on this.

## Spec gaps to close

- Milestones UI/API (the table already exists), and a Gantt/roadmap view over milestone dates.
- List/table view with multi-filters (priority, tag, due, project, rollover count) and saved views.
- Auto-generated `project_index.md` per project: deliverables, links, task tallies.
- Write remarks into the note (indented `- 💬 …` under the task), so they're visible in Obsidian and survive a lost DB.
- Exercise the BullMQ/Redis path in CI (GitHub runners can start a Redis service container).

## Ideas

- Calendar integration both ways (due tasks → `.ics` feed; meetings → Today).
- Weekly review ritual in Telegram (Thursday evening): wins, slipped tasks, plan for next week.
- Location-aware reminders ("when I'm at the warehouse, remind me to check the UPS").
- Per-task time tracking from diary visits, for invoicing.
- An evaluation set for real-model quality: a fixed vault plus questions, scored per model, to pick the best local model.
- Encrypted off-site backups (age + rclone) with a restore drill in CI.
