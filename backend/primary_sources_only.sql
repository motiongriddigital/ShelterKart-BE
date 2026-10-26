-- ============================================================
-- SHELTERKART — DISPLAY VS SCORE (migration 010, revised)
--
-- REVISION NOTE
--   The first version of this migration blocked any report citing a
--   secondary source. That hid information a buyer could find on
--   Google -- making ShelterKart less useful than a search engine.
--   Nothing had been applied to a live database, so this file is
--   corrected in place rather than reversed by a later migration.
--
-- THE RULE
--   ShelterKart never CLAIMS as fact what a secondary source says.
--   It may REPORT that the source says it, with its mark. So:
--     evidence      primary authority -- may be shown and scored
--     display_only  third-party claim -- may be shown, marked, never scored
--     lead_only     used only to locate a record -- never shown
--   Wording rule for the renderer: a display_only finding states the
--   fact of the claim ("Seven listing sites give X; not yet confirmed
--   with the authority"), never the claim itself as fact.
--   Where secondary sources disagree, the report shows the
--   disagreement and never picks a side (see evidence_conflicts).
--
-- NOT DECIDED HERE
--   Tier 3 (licensed partner with documented chain of custody).
-- ============================================================

ALTER TABLE sources ADD COLUMN IF NOT EXISTS use_as TEXT NOT NULL DEFAULT 'evidence';
ALTER TABLE sources DROP CONSTRAINT IF EXISTS sources_use_as_check;
ALTER TABLE sources ADD CONSTRAINT sources_use_as_check
  CHECK (use_as IN ('evidence','display_only','lead_only'));
UPDATE sources SET use_as = 'display_only' WHERE authority_tier = 4 AND use_as = 'evidence';

ALTER TABLE sources DROP CONSTRAINT IF EXISTS secondary_is_lead_only;
ALTER TABLE sources DROP CONSTRAINT IF EXISTS secondary_never_evidence;
ALTER TABLE sources ADD CONSTRAINT secondary_never_evidence
  CHECK (authority_tier <> 4 OR use_as <> 'evidence');
COMMENT ON COLUMN sources.use_as IS
  'evidence: primary, may be scored. display_only: third-party claim, '
  'shown with its mark, never scored. lead_only: never shown. A tier-4 '
  'source can never be evidence, by constraint.';

-- The publish gate: the six earlier checks carried over verbatim from
-- migration 008, then the two display-vs-score checks.
CREATE OR REPLACE FUNCTION enforce_publish_readiness()
RETURNS TRIGGER AS $$
DECLARE
  blocked_findings INTEGER;
  stale_unacknowledged INTEGER;
  unlegaled_findings INTEGER;
  unoffered_entities INTEGER;
  unresolved_offers INTEGER;
  scored_secondary INTEGER;
  cited_leads INTEGER;
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

  -- THE RIGHT OF REPLY GATE.
  -- (a) Every entity this report names, where at least one finding
  --     cites court or insolvency evidence, must have an offer on
  --     file for this report version. No offer at all -- block; the
  --     report is not ready to publish, it is ready to have comment
  --     requested.
  SELECT count(*) INTO unoffered_entities
  FROM (
    SELECT DISTINCT rv.entity_id
    FROM report_versions rv
    JOIN findings f ON f.report_version_id = rv.id
    WHERE rv.id = NEW.id
      AND EXISTS (
        SELECT 1
        FROM unnest(f.evidence_ids) AS eid
        JOIN evidence e ON e.id = eid
        JOIN source_documents sd ON sd.id = e.document_id
        JOIN sources s ON s.id = sd.source_id
        WHERE s.source_type IN ('court','insolvency')
      )
      AND NOT EXISTS (
        SELECT 1 FROM right_of_reply_offers rro
        WHERE rro.report_version_id = rv.id AND rro.entity_id = rv.entity_id
      )
  ) x;
  IF unoffered_entities > 0 THEN
    RAISE EXCEPTION 'report % cannot publish: % entit(y/ies) cite court or insolvency evidence with no right-of-reply offer on file', NEW.public_ref, unoffered_entities;
  END IF;

  -- (b) An offer exists but is still within its window and has no
  --     response yet -- still waiting, not yet publishable.
  SELECT count(*) INTO unresolved_offers
  FROM right_of_reply_offers rro
  WHERE rro.report_version_id = NEW.id
    AND rro.developer_response_id IS NULL
    AND now() < rro.response_deadline;
  IF unresolved_offers > 0 THEN
    RAISE EXCEPTION 'report % cannot publish: % right-of-reply offer(s) still within their response window', NEW.public_ref, unresolved_offers;
  END IF;

  -- THE PRIMARY-SOURCE RULE, as display vs score.
  -- (a) A secondary source may be SHOWN, with its mark, but may never
  --     move the score. Only the authority itself can.
  SELECT count(*) INTO scored_secondary
  FROM findings f
  WHERE f.report_version_id = NEW.id
    AND COALESCE(f.score_impact, 0) <> 0
    AND EXISTS (
      SELECT 1
      FROM unnest(f.evidence_ids) AS eid
      JOIN evidence e ON e.id = eid
      JOIN source_documents sd ON sd.id = e.document_id
      JOIN sources s ON s.id = sd.source_id
      WHERE s.use_as <> 'evidence'
    );
  IF scored_secondary > 0 THEN
    RAISE EXCEPTION 'report % cannot publish: % finding(s) move the score on a secondary source', NEW.public_ref, scored_secondary;
  END IF;

  -- (b) A lead-only source (used to locate a record, e.g. find a CIN)
  --     may never appear in a report at all.
  SELECT count(*) INTO cited_leads
  FROM findings f
  WHERE f.report_version_id = NEW.id
    AND EXISTS (
      SELECT 1
      FROM unnest(f.evidence_ids) AS eid
      JOIN evidence e ON e.id = eid
      JOIN source_documents sd ON sd.id = e.document_id
      JOIN sources s ON s.id = sd.source_id
      WHERE s.use_as = 'lead_only'
    );
  IF cited_leads > 0 THEN
    RAISE EXCEPTION 'report % cannot publish: % finding(s) cite a lead-only source', NEW.public_ref, cited_leads;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
