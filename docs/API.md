# HTTP API

Everything the web app and Mini App use. Base path `/api`.


Cookie-authenticated writes must send the header `x-omnicore: 1` (CSRF guard); Bearer-token calls don't need it.


| Method | Path | |
|---|---|---|
| POST | `/api/session` · `/api/session/telegram` · `/api/logout`, GET `/api/me` | `{token}` / `{initData}` → session cookie |
| GET | `/api/today/board`, `/api/upcoming?days=`, `/api/inbox`, `/api/board`, `/api/search?q=` | UI views |
| GET | `/api/tasks/:id/detail` | task + subtasks, remarks, nudge history, source line |
| POST | `/api/parse` | `{ text }` → preview of what quick-add will create |
| GET/PUT | `/api/notes/:id` | PUT `{ content, checksum }` (409 if the file changed) |
| POST | `/api/notes`, `/api/log` | new note · append to today's daily note |
| GET | `/api/ai/status` | models, cloud mode, index stats, which features are available |
| POST | `/api/ai/ask` | `{ q }` → `{ answer, sources, cited }` |
| GET | `/api/search/semantic?q=` | related passages |
| POST | `/api/tasks/:id/breakdown` · `/api/tasks/:id/subtasks` | suggest · `{ titles }` write nested subtasks |
| POST | `/api/ai/digest` · `/api/ai/reindex` | `{ kind: standup\|retro }` · re-embed now |
| GET | `/api/today` | overdue / dueToday / pinned / completed |
| GET | `/api/tasks?status=ready,blocked&project=&tag=&dueBefore=&minRollover=` | |
| POST | `/api/tasks` | `{ text, notePath?, projectSlug?, status? }` |
| PATCH | `/api/tasks/:id` | `{ status?, title?, priority?, dueDate?, dueTime?, pinned? }` |
| POST | `/api/tasks/:id/actions/:action` | `done start p25 p50 p75 snooze1h tomorrow mute reopen` |
| POST | `/api/tasks/:id/remarks` | `{ text }` |
| GET | `/api/notes`, `/api/notes/by-path?path=`, `/api/projects`, `/api/graph` | |
| POST | `/api/vault/reindex` | full rescan |
