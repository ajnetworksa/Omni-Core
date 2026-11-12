-- Phase 2: nag engine, recurrence, Telegram message refs
ALTER TABLE tasks ADD COLUMN progress INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tasks ADD COLUMN snoozed_until TEXT;
ALTER TABLE tasks ADD COLUMN last_action_at TEXT;
ALTER TABLE tasks ADD COLUMN recurrence TEXT;
ALTER TABLE reminders_log ADD COLUMN chat_id TEXT;
ALTER TABLE reminders_log ADD COLUMN message_id INTEGER;
CREATE INDEX reminders_task_sent_idx ON reminders_log(task_id, sent_at);
CREATE INDEX tasks_parent_idx ON tasks(parent_task_id);
