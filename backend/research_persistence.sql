-- ============================================================
-- SHELTERKART — DURABLE RESEARCH (migration 018)
--
-- Reports, name/number aliases and the daily research counter used to
-- live only in server memory, so a deploy or crash erased them -- and a
-- buyer who had paid could be told their report was "no longer
-- available". These tables are the durable copy; the server writes to
-- them in the background and reloads from them on startup.
--
-- Reports contain no personal data: the search text has phone numbers
-- and email addresses stripped before research runs, and no buyer
-- identity is attached to a report.
-- ============================================================

CREATE TABLE IF NOT EXISTS research_briefs (
  ref         TEXT PRIMARY KEY,                 -- SK-XXXXXXXXXXXX, the report's permanent reference
  cache_key   TEXT NOT NULL,                    -- market|query|location, the search that produced it
  brief       JSONB NOT NULL,                   -- the full report as served
  page_urls   TEXT[] NOT NULL DEFAULT '{}',     -- every page checked: lets a legal withdrawal find it
  page_hosts  TEXT[] NOT NULL DEFAULT '{}',     -- ...and every host, for a whole-source withdrawal
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_research_briefs_cache_key  ON research_briefs (cache_key);
CREATE INDEX IF NOT EXISTS idx_research_briefs_created_at ON research_briefs (created_at);
CREATE INDEX IF NOT EXISTS idx_research_briefs_page_urls  ON research_briefs USING GIN (page_urls);
CREATE INDEX IF NOT EXISTS idx_research_briefs_page_hosts ON research_briefs USING GIN (page_hosts);

-- Every spelling and registration number of a project, pointing at the
-- search that researched it. "ambiguous" is permanent: once a name is
-- found for two different projects, it never auto-resolves again.
CREATE TABLE IF NOT EXISTS research_aliases (
  alias       TEXT PRIMARY KEY,                 -- e.g. name:in:samrat tropicano, id:in:P51900008925
  cache_key   TEXT NOT NULL,
  location    TEXT NOT NULL DEFAULT '',
  ambiguous   BOOLEAN NOT NULL DEFAULT false,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_research_aliases_cache_key ON research_aliases (cache_key);

-- The daily ceiling on new research survives a restart, so a crash in
-- the middle of a viral day cannot reset the cost limit to zero.
CREATE TABLE IF NOT EXISTS research_daily (
  day    DATE PRIMARY KEY,
  count  INTEGER NOT NULL DEFAULT 0
);
