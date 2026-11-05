-- Database backups: one row per attempt (scheduled or manual). Never holds key material or the dump itself.
-- Additive and idempotent. Applied by tools/migrate.js (seventeenth).
-- file_name is the encrypted file in the destination; sha256 is of that file; key_id names the key used (the key is never stored).

CREATE TABLE IF NOT EXISTS backups (
  id          BIGSERIAL PRIMARY KEY,
  started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  trigger     TEXT NOT NULL CHECK (trigger IN ('schedule', 'manual')),
  status      TEXT NOT NULL CHECK (status IN ('running', 'ok', 'failed')),
  file_name   TEXT,
  size_bytes  BIGINT,
  sha256      TEXT,
  key_id      TEXT,
  destination TEXT,
  error       TEXT
);
CREATE INDEX IF NOT EXISTS backups_started_idx ON backups (started_at DESC);
