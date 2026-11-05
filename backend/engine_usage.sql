-- AI engine usage per day, engine and role. Counts, tokens, cost and a latency histogram; never prompts or answers.
-- Additive and idempotent. Applied by tools/migrate.js (sixteenth). Rows older than 400 days are removed by the server.
-- day is the UTC date. lat is a histogram of call times: ten bounds (100, 250, 500, 1000, 2000, 4000, 8000, 16000, 32000, 64000 ms) and one for slower.

CREATE TABLE IF NOT EXISTS engine_usage_daily (
  day          DATE    NOT NULL,
  engine       TEXT    NOT NULL,
  role         TEXT    NOT NULL,
  calls        INTEGER NOT NULL DEFAULT 0,
  failures     INTEGER NOT NULL DEFAULT 0,
  rescues      INTEGER NOT NULL DEFAULT 0,
  tokens_in    BIGINT  NOT NULL DEFAULT 0,
  tokens_out   BIGINT  NOT NULL DEFAULT 0,
  searches     INTEGER NOT NULL DEFAULT 0,
  ms_total     BIGINT  NOT NULL DEFAULT 0,
  cost_usd     NUMERIC(14,6) NOT NULL DEFAULT 0,
  costed_calls INTEGER NOT NULL DEFAULT 0,
  lat          INTEGER[] NOT NULL DEFAULT '{0,0,0,0,0,0,0,0,0,0,0}',
  PRIMARY KEY (day, engine, role)
);
