-- ── updated_at trigger ────────────────────────────────────────────────────────
-- The app sets updated_at manually on every UPDATE, but direct SQL access
-- bypasses this. This trigger keeps updated_at accurate regardless of how
-- the row is modified.

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tasks_set_updated_at ON tasks;
CREATE TRIGGER tasks_set_updated_at
  BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── RLS: brain_dumps ──────────────────────────────────────────────────────────
ALTER TABLE brain_dumps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can only access their own brain_dumps" ON brain_dumps;
CREATE POLICY "Users can only access their own brain_dumps"
  ON brain_dumps FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ── RLS: tasks ────────────────────────────────────────────────────────────────
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can only access their own tasks" ON tasks;
CREATE POLICY "Users can only access their own tasks"
  ON tasks FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ── Indexes for common query patterns ─────────────────────────────────────────
CREATE INDEX IF NOT EXISTS brain_dumps_user_created_idx
  ON brain_dumps (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS tasks_user_status_created_idx
  ON tasks (user_id, status, created_at DESC);
