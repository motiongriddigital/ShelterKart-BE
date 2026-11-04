-- Error log for the admin panel: one row per distinct problem (grouped by a fingerprint of its source and message),
-- with a count, and one small row per occurrence so the panel can chart errors by hour.
-- Messages are scrubbed of e-mail addresses, IP addresses, tokens and query strings before they get here. Rows are deleted after 30 days.
-- Additive and idempotent. Applied by tools/migrate.js (fourteenth).

CREATE TABLE IF NOT EXISTS error_log (
  id          BIGSERIAL PRIMARY KEY,
  fingerprint TEXT NOT NULL UNIQUE,
  level       TEXT NOT NULL CHECK (level IN ('error', 'warn', 'info')),
  source      TEXT NOT NULL,
  message     TEXT NOT NULL,
  detail      TEXT,
  count       INTEGER NOT NULL DEFAULT 1,
  first_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_error_log_last ON error_log (last_at DESC);

CREATE TABLE IF NOT EXISTS error_hits (
  at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  error_id BIGINT NOT NULL REFERENCES error_log(id) ON DELETE CASCADE,
  level    TEXT NOT NULL,
  n        INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_error_hits_at ON error_hits (at);
