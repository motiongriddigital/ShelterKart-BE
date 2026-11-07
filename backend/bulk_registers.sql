-- Open registers published as a bulk file (Latvia first), loaded daily and searched here instead of per request.
-- The loader replaces a country's rows only after a complete download; a failed or suspiciously small load changes nothing.

CREATE TABLE IF NOT EXISTS bulk_register_entities (
  country     TEXT        NOT NULL,
  reg_id      TEXT        NOT NULL,
  name        TEXT        NOT NULL,
  name_key    TEXT        NOT NULL,
  legal_form  TEXT,
  registered  DATE,
  terminated  DATE,
  address     TEXT,
  loaded_at   TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (country, reg_id)
);

CREATE INDEX IF NOT EXISTS bulk_register_entities_name_idx ON bulk_register_entities (country, name_key text_pattern_ops);

CREATE TABLE IF NOT EXISTS bulk_register_loads (
  country        TEXT PRIMARY KEY,
  source_url     TEXT,
  etag           TEXT,
  last_modified  TEXT,
  bytes          BIGINT,
  row_count      INTEGER,
  status         TEXT        NOT NULL,
  detail         TEXT,
  started_at     TIMESTAMPTZ NOT NULL,
  finished_at    TIMESTAMPTZ
);
