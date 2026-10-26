-- ============================================================
-- SHELTERKART — FIRST-PARTY ANALYTICS (migration 020)
--
-- One row per event: page views, searches, report opens, unlock clicks,
-- checkouts, payments, PDF saves, WhatsApp shares. No IP address, no
-- user-agent string, no cookie. `visitor` is a hash under a salt that
-- rotates every UTC day; only today's salt is ever stored, so a visitor
-- cannot be linked from one day to the next.
-- Events are kept for 400 days (a year-on-year comparison), then deleted.
-- ============================================================
CREATE TABLE IF NOT EXISTS analytics_events (
  id           BIGSERIAL PRIMARY KEY,
  at           TIMESTAMPTZ NOT NULL,
  day          DATE NOT NULL,
  event        TEXT NOT NULL,
  visitor      TEXT NOT NULL,
  path         TEXT NOT NULL DEFAULT '/',
  channel      TEXT NOT NULL DEFAULT 'direct',
  referrer     TEXT NOT NULL DEFAULT '',
  utm_source   TEXT NOT NULL DEFAULT '',
  utm_medium   TEXT NOT NULL DEFAULT '',
  utm_campaign TEXT NOT NULL DEFAULT '',
  country      TEXT NOT NULL DEFAULT '',
  device       TEXT NOT NULL DEFAULT '',
  market       TEXT NOT NULL DEFAULT '',
  ref          TEXT NOT NULL DEFAULT '',
  query        TEXT NOT NULL DEFAULT '',
  value        NUMERIC,
  currency     TEXT NOT NULL DEFAULT '',
  detail       TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_analytics_events_at  ON analytics_events (at);
CREATE INDEX IF NOT EXISTS idx_analytics_events_day ON analytics_events (day);

-- Today's salt only. Yesterday's is deleted the moment today's is saved.
CREATE TABLE IF NOT EXISTS analytics_salt (
  day   DATE PRIMARY KEY,
  salt  TEXT NOT NULL
);
