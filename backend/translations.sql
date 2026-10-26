-- ============================================================
-- SHELTERKART — TRANSLATIONS AND LANGUAGE ANALYTICS (migration 021)
--
-- translation_cache: every sentence ShelterKart has translated, so a
-- sentence is translated ONCE and reused by every later report that
-- contains it (protections, standard questions, score reasons...).
--   key  = language | glossary version | sha1(English text)
-- Only translations that passed the code's fact checks (and, for sensitive
-- claims, the meaning check) are stored; nothing else ever is. Retained 90
-- days, then pruned at startup; a changed glossary changes the key, so old
-- wordings are never reused.
--
-- analytics_events.lang: the language the visitor was reading, so the
-- dashboard can show whether a language lifts conversion.
-- ============================================================

CREATE TABLE IF NOT EXISTS translation_cache (
  key         TEXT PRIMARY KEY,
  lang        TEXT NOT NULL,
  text        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_translation_cache_created_at ON translation_cache (created_at);

ALTER TABLE analytics_events ADD COLUMN IF NOT EXISTS lang TEXT NOT NULL DEFAULT '';
