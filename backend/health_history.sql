-- Source health history: one row per nightly check of a market's register, so the admin panel can show how each register has been doing.
-- Additive and idempotent. Applied by tools/migrate.js (fifteenth). Rows older than 90 days are removed as new ones are written.

CREATE TABLE IF NOT EXISTS source_health_history (
  id         BIGSERIAL PRIMARY KEY,
  market     TEXT NOT NULL,
  state      TEXT NOT NULL,        -- healthy | degraded | down | unconfirmed | skipped
  reason     TEXT,                 -- blocked | failing, when down
  detail     TEXT,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_source_health_history_market_time ON source_health_history (market, checked_at DESC);
