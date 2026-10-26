-- ============================================================
-- SHELTERKART — THE LEGAL GATE (migration 007)
--
-- WHAT "BULLETPROOF" CAN HONESTLY MEAN
--   Not "no legal risk ever" -- nobody can build that, and claiming
--   otherwise would be exactly the kind of overclaiming this product
--   exists to refuse to do to a buyer. What this migration actually
--   builds: a database that is structurally incapable of letting an
--   automated-fetch finding into a published report unless a human
--   has recorded a real ToS/robots.txt review for that source. Every
--   row in sources has carried tos_reviewed_at = NULL all session,
--   on every source in every jurisdiction, India included. That was
--   a documented convention. This migration makes it an enforced one.
--
-- THE DISTINCTION THIS RESTS ON
--   Automated fetching is the thing that needs a ToS review -- it's
--   the act a site's robots.txt and terms are written to govern. A
--   human opening a public page and saving it is a categorically
--   different act (see capture_method='human_operator', added in
--   migration 005) and an RTI response is a third, statutory channel
--   again. So the gate below applies specifically to
--   capture_method='automated_fetch' documents. It does not block
--   human-captured or RTI-sourced evidence on the same grounds,
--   because those were never the thing robots.txt was written about.
-- ============================================================

-- ------------------------------------------------------------
-- 1. A source cannot claim permitted_fetch without a recorded review.
-- This was already true in spirit (schema_evidence.sql's own comment
-- says as much) -- now it's true in the database.
-- ------------------------------------------------------------
ALTER TABLE sources DROP CONSTRAINT IF EXISTS permitted_fetch_requires_review;
ALTER TABLE sources ADD CONSTRAINT permitted_fetch_requires_review
  CHECK (access_mode <> 'permitted_fetch' OR tos_reviewed_at IS NOT NULL);
COMMENT ON CONSTRAINT permitted_fetch_requires_review ON sources IS
  'Every source in this registry -- UK, India, every state, every '
  'country -- has carried tos_reviewed_at = NULL since the day it was '
  'seeded. That was always the honest starting state. This constraint '
  'makes it impossible to change access_mode to permitted_fetch '
  'without also recording who reviewed the terms and when, closing '
  'the exact gap flagged in seed_sources.sql''s own operating notes.';

-- ------------------------------------------------------------
-- 2. The publish gate learns a third check: for every finding backed
-- by an automated_fetch document, the source it came from must
-- actually be cleared. Extends the same trigger built in migration
-- 006 rather than adding a second, competing gate.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_publish_readiness()
RETURNS TRIGGER AS $$
DECLARE
  blocked_findings INTEGER;
  stale_unacknowledged INTEGER;
  unlegaled_findings INTEGER;
BEGIN
  IF NEW.lifecycle <> 'published' OR (TG_OP = 'UPDATE' AND OLD.lifecycle = 'published') THEN
    RETURN NEW;
  END IF;

  IF NEW.responsible_editor_name IS NULL OR trim(NEW.responsible_editor_name) = '' THEN
    RAISE EXCEPTION 'report % cannot publish: no responsible_editor_name set', NEW.public_ref;
  END IF;

  SELECT count(*) INTO blocked_findings
  FROM findings
  WHERE report_version_id = NEW.id AND review_status IN ('flagged','rejected');
  IF blocked_findings > 0 THEN
    RAISE EXCEPTION 'report % cannot publish: % finding(s) flagged or rejected and not resolved', NEW.public_ref, blocked_findings;
  END IF;

  SELECT count(*) INTO stale_unacknowledged
  FROM findings f
  WHERE f.report_version_id = NEW.id
    AND NOT f.stale_acknowledged
    AND EXISTS (
      SELECT 1
      FROM unnest(f.evidence_ids) AS eid
      JOIN evidence e ON e.id = eid
      JOIN source_documents sd ON sd.id = e.document_id
      JOIN sources s ON s.id = sd.source_id
      WHERE sd.retrieved_at < now() - make_interval(hours => s.default_ttl_hours)
    );
  IF stale_unacknowledged > 0 THEN
    RAISE EXCEPTION 'report % cannot publish: % finding(s) rely on evidence past its source TTL and are not stale_acknowledged', NEW.public_ref, stale_unacknowledged;
  END IF;

  -- THE LEGAL GATE. A finding whose evidence traces to an
  -- automated_fetch document from a source that is not
  -- (permitted_fetch AND tos_reviewed_at IS NOT NULL) cannot publish.
  -- Evidence captured by a human operator or an RTI response is exempt
  -- -- that's the whole point of building those two rungs in
  -- migration 005: they are legitimate routes precisely BECAUSE they
  -- don't carry the automated-access question at all.
  SELECT count(*) INTO unlegaled_findings
  FROM findings f
  WHERE f.report_version_id = NEW.id
    AND EXISTS (
      SELECT 1
      FROM unnest(f.evidence_ids) AS eid
      JOIN evidence e ON e.id = eid
      JOIN source_documents sd ON sd.id = e.document_id
      JOIN sources s ON s.id = sd.source_id
      WHERE sd.capture_method = 'automated_fetch'
        AND (s.access_mode <> 'permitted_fetch' OR s.tos_reviewed_at IS NULL)
    );
  IF unlegaled_findings > 0 THEN
    RAISE EXCEPTION 'report % cannot publish: % finding(s) rely on automated-fetch evidence from a source without a recorded legal review', NEW.public_ref, unlegaled_findings;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- Trigger itself is unchanged -- it already points at this function
-- by name, so redefining the function body is sufficient; no need to
-- drop and recreate trg_enforce_publish_readiness.

-- ------------------------------------------------------------
-- 3. Who reviewed it, and what they found -- so "tos_reviewed_at is
-- not null" means something checkable, not just a date someone typed.
-- ------------------------------------------------------------
ALTER TABLE sources ADD COLUMN IF NOT EXISTS tos_reviewed_by TEXT;
ALTER TABLE sources ADD COLUMN IF NOT EXISTS tos_review_note TEXT;
ALTER TABLE sources ADD COLUMN IF NOT EXISTS robots_txt_checked_at DATE;
ALTER TABLE sources ADD COLUMN IF NOT EXISTS robots_txt_result TEXT
  CHECK (robots_txt_result IN ('allows','disallows','path_specific','not_applicable'));

ALTER TABLE sources DROP CONSTRAINT IF EXISTS review_needs_reviewer;
ALTER TABLE sources ADD CONSTRAINT review_needs_reviewer
  CHECK (tos_reviewed_at IS NULL OR (tos_reviewed_by IS NOT NULL AND tos_review_note IS NOT NULL));
COMMENT ON CONSTRAINT review_needs_reviewer ON sources IS
  'A review date with no reviewer name and no note is a checkbox '
  'ticked, not a review performed. Both are required together.';

-- ------------------------------------------------------------
-- 4. Record this session''s actual findings against the fields that
-- now exist -- direct tool-verified robots.txt results only. This is
-- NOT a legal review (see verification_findings.sql''s own caveat,
-- repeated here: session research narrows down where to look, it is
-- not the ToS review itself) -- so tos_reviewed_at stays NULL on
-- every row. robots_txt_checked_at and robots_txt_result are
-- filled in because those specific facts WERE directly, mechanically
-- verified by this session''s tool calls, not inferred from a
-- description.
-- ------------------------------------------------------------
UPDATE sources SET robots_txt_checked_at = CURRENT_DATE, robots_txt_result = 'allows'
WHERE authority = 'Companies House';

UPDATE sources SET robots_txt_checked_at = CURRENT_DATE, robots_txt_result = 'disallows'
WHERE authority = 'MahaRERA (Maharashtra)';

UPDATE sources SET robots_txt_checked_at = CURRENT_DATE, robots_txt_result = 'disallows'
WHERE authority = 'K-RERA (Karnataka)';

UPDATE sources SET robots_txt_checked_at = CURRENT_DATE, robots_txt_result = 'disallows'
WHERE authority = 'Gujarat RERA (GujRERA)';

UPDATE sources SET robots_txt_checked_at = CURRENT_DATE, robots_txt_result = 'disallows'
WHERE authority = 'RERA Delhi';

UPDATE sources SET robots_txt_checked_at = CURRENT_DATE, robots_txt_result = 'allows'
WHERE authority IN ('TN RERA (Tamil Nadu)', 'RERA West Bengal (WBRERA)', 'HARERA (Haryana — Gurugram)',
                     'UP RERA (Uttar Pradesh)', 'Handelsregister (Germany)');

UPDATE sources SET robots_txt_checked_at = CURRENT_DATE, robots_txt_result = 'path_specific'
WHERE authority = 'UP RERA (Uttar Pradesh)';
-- overrides the 'allows' just set above: the root and the entity
-- directory are open, the interactive project-detail search is
-- CAPTCHA-gated. path_specific is the honest single word for that.
