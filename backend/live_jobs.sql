-- Running and saved investigations, one row per report reference: the same record the file store keeps (backend/engine/jobStore.js), plus
-- which server instance is running it and until when it holds the job. Used when JOB_STORE=postgres. Additive and idempotent.
-- Applied by tools/migrate.js. See docs/JOB-STORE.md.

CREATE TABLE IF NOT EXISTS live_jobs (
  ref         TEXT PRIMARY KEY,
  status      TEXT NOT NULL,
  paid        BOOLEAN NOT NULL DEFAULT FALSE,
  payload     JSONB NOT NULL,
  owner       TEXT,
  lease_until TIMESTAMPTZ,
  pay_remote  JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_live_jobs_owner ON live_jobs (owner) WHERE owner IS NOT NULL;
