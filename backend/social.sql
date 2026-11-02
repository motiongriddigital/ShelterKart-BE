-- The marketing desk. One generic document table (posts, packs, pauses, incidents, gaps, knowledge items, settings) and an
-- insert-only audit table whose rows are chained by hash: a row cannot be changed or removed without the chain failing.
CREATE TABLE IF NOT EXISTS social_docs (
  kind        text        NOT NULL,
  id          text        NOT NULL,
  data        jsonb       NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (kind, id)
);
CREATE INDEX IF NOT EXISTS social_docs_kind_idx ON social_docs (kind);
CREATE TABLE IF NOT EXISTS social_audit (
  seq   integer     PRIMARY KEY,
  at    timestamptz NOT NULL,
  kind  text        NOT NULL,
  data  jsonb       NOT NULL,
  prev  text        NOT NULL,
  hash  text        NOT NULL UNIQUE
);
-- Insert-only: the application never updates or deletes an audit row, and the database refuses to.
CREATE OR REPLACE FUNCTION social_audit_immutable() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'social_audit is insert-only'; END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS social_audit_no_change ON social_audit;
CREATE TRIGGER social_audit_no_change BEFORE UPDATE OR DELETE ON social_audit FOR EACH ROW EXECUTE FUNCTION social_audit_immutable();
