-- ── Task enhancements ────────────────────────────────────────────────────────
-- Run this in the Supabase SQL editor (Dashboard → SQL Editor → New query).

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS subtasks       JSONB        NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS notes          TEXT,
  ADD COLUMN IF NOT EXISTS schedule_type  TEXT         NOT NULL DEFAULT 'none'
    CONSTRAINT tasks_schedule_type_check
    CHECK (schedule_type IN ('none', 'once', 'daily', 'weekly')),
  ADD COLUMN IF NOT EXISTS scheduled_date DATE,
  ADD COLUMN IF NOT EXISTS tags           TEXT[]       NOT NULL DEFAULT '{}';

-- ── API call log ──────────────────────────────────────────────────────────────
-- Stores a record of every AI extraction call: what was sent, what came back,
-- and how long it took. Useful for auditing model quality over time.

CREATE TABLE IF NOT EXISTS api_logs (
  id                  UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id             UUID         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  brain_dump_id       UUID         REFERENCES brain_dumps(id) ON DELETE SET NULL,
  endpoint            TEXT         NOT NULL,
  model               TEXT,
  content_length      INTEGER,
  tasks_extracted     INTEGER      DEFAULT 0,
  enrichments_applied INTEGER      DEFAULT 0,
  duration_ms         INTEGER,
  success             BOOLEAN      NOT NULL DEFAULT true,
  error_message       TEXT,
  created_at          TIMESTAMPTZ  DEFAULT NOW()
);

ALTER TABLE api_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can only see their own api_logs"
  ON api_logs FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Index for quick per-user log lookups
CREATE INDEX IF NOT EXISTS api_logs_user_id_idx ON api_logs (user_id, created_at DESC);
