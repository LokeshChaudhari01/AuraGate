-- drizzle/0002_add_processed_jobs.sql
CREATE TABLE IF NOT EXISTS "processed_jobs" (
  "request_id" uuid PRIMARY KEY,
  "processed_at" timestamptz NOT NULL DEFAULT now()
);
