ALTER TABLE usage_logs
  ADD COLUMN IF NOT EXISTS query_type       VARCHAR(20),
  ADD COLUMN IF NOT EXISTS complexity_score INTEGER;

CREATE INDEX IF NOT EXISTS idx_usage_logs_created_desc
  ON usage_logs (created_at DESC);
