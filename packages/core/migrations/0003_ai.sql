-- Phase 4: semantic index + AI bookkeeping.
-- Vectors are stored here as float32 BLOBs (the source of truth). When the sqlite-vec
-- extension loads, a vec0 virtual table mirrors them for fast KNN; otherwise search falls
-- back to a brute-force scan in JS. No foreign keys: the sync job cleans up orphans itself,
-- because the vec0 mirror can't be cascaded.

CREATE TABLE ai_chunks (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  source    TEXT NOT NULL,            -- 'note' | 'task'
  note_id   TEXT,
  task_id   TEXT,
  heading   TEXT,
  text      TEXT NOT NULL,
  day       TEXT,                     -- YYYY-MM-DD used for "last quarter" style filters
  vector    BLOB NOT NULL
);
CREATE INDEX ai_chunks_note_idx ON ai_chunks(note_id);
CREATE INDEX ai_chunks_task_idx ON ai_chunks(task_id);
CREATE INDEX ai_chunks_day_idx ON ai_chunks(day);

-- What was embedded last time, so only changed notes/tasks are re-embedded.
CREATE TABLE ai_sources (
  key   TEXT PRIMARY KEY,             -- 'note:<id>' | 'task:<id>'
  hash  TEXT NOT NULL
);

CREATE TABLE ai_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Suggestions waiting for a tap (tasks found in a voice note, etc.).
CREATE TABLE ai_pending (
  id         TEXT PRIMARY KEY,
  kind       TEXT NOT NULL,
  payload    TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
