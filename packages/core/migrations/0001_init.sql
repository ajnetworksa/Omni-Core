CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE milestones (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  target_date TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX milestones_project_idx ON milestones(project_id);

CREATE TABLE notes (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  path TEXT NOT NULL UNIQUE,
  frontmatter TEXT NOT NULL DEFAULT '{}',
  content TEXT NOT NULL,
  checksum TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX notes_title_idx ON notes(title COLLATE NOCASE);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  milestone_id TEXT REFERENCES milestones(id) ON DELETE SET NULL,
  note_id TEXT REFERENCES notes(id) ON DELETE CASCADE,
  parent_task_id TEXT,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ready',
  priority INTEGER NOT NULL DEFAULT 4,
  due_date TEXT,
  due_time TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  rollover_cnt INTEGER NOT NULL DEFAULT 0,
  remarks TEXT NOT NULL DEFAULT '[]',
  pinned INTEGER NOT NULL DEFAULT 0,
  anchor TEXT,
  line_number INTEGER,
  raw_line TEXT,
  ordinal INTEGER,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX tasks_note_idx ON tasks(note_id);
CREATE INDEX tasks_project_idx ON tasks(project_id);
CREATE INDEX tasks_status_due_idx ON tasks(status, due_date);
CREATE UNIQUE INDEX tasks_anchor_uq ON tasks(anchor);

CREATE TABLE note_links (
  id TEXT PRIMARY KEY,
  source_note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  target_title TEXT NOT NULL,
  heading TEXT,
  target_note_id TEXT REFERENCES notes(id) ON DELETE SET NULL
);
CREATE INDEX links_source_idx ON note_links(source_note_id);
CREATE INDEX links_target_idx ON note_links(target_note_id);

CREATE TABLE reminders_log (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  state_sent TEXT NOT NULL,
  ack_at TEXT,
  sent_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX reminders_task_idx ON reminders_log(task_id);
