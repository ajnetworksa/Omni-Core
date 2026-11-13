-- Settings changed in the app (Settings page). They override .env; removing a row = back to .env/default.
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
