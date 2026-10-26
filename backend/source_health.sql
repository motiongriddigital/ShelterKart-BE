-- ============================================================
-- SHELTERKART — SOURCE HEALTH (migration 019)
--
-- One row per market with a live register: whether its nightly canary
-- lookup still passes, and whether the register's robots.txt still
-- allows the paths the connector uses. Kept in the database so that a
-- register switched off last night is still off after a restart.
-- ============================================================
CREATE TABLE IF NOT EXISTS source_health (
  market               TEXT PRIMARY KEY,
  state                TEXT NOT NULL,               -- healthy | degraded | down | unconfirmed | skipped
  reason               TEXT,                        -- blocked | failing, when down
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  ever_healthy         BOOLEAN NOT NULL DEFAULT false,
  detail               TEXT,
  last_ok_at           TIMESTAMPTZ,
  checked_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
