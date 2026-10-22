-- ── Base schema ───────────────────────────────────────────────────────────────
-- Run this FIRST in the Supabase SQL Editor before running 001 and 002.
-- (Supabase already creates auth.users — this just creates the app tables.)

-- brain_dumps: one row per raw dump the user submits
CREATE TABLE IF NOT EXISTS brain_dumps (
  id          UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     UUID         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content     TEXT         NOT NULL,
  created_at  TIMESTAMPTZ  DEFAULT NOW()
);

-- tasks: extracted from brain dumps by the AI
CREATE TABLE IF NOT EXISTS tasks (
  id              UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id         UUID         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  brain_dump_id   UUID         REFERENCES brain_dumps(id) ON DELETE SET NULL,
  title           TEXT         NOT NULL,
  description     TEXT,
  priority        TEXT         NOT NULL DEFAULT 'medium'
    CONSTRAINT tasks_priority_check CHECK (priority IN ('low', 'medium', 'high')),
  status          TEXT         NOT NULL DEFAULT 'pending'
    CONSTRAINT tasks_status_check CHECK (status IN ('pending', 'in_progress', 'completed')),
  due_date        DATE,
  created_at      TIMESTAMPTZ  DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  DEFAULT NOW()
);

-- ── After this, run 001_task_enhancements.sql then 002_updated_at_trigger_and_rls.sql ──
