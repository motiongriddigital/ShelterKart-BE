-- ============================================================
-- SHELTERKART — THE RIGHT OF REPLY GATE (migration 008)
--
-- THE GAP THIS CLOSES
--   developer_responses already existed, but it is entirely
--   reactive: a developer can reply only after a report is already
--   published, if they happen to find it. Nothing offers them the
--   chance first, and nothing checks whether that offer was ever
--   made. Real publications that carry defamation risk -- newspapers,
--   rating agencies -- do not work this way. Before running a story
--   built on litigation or insolvency records, they put the specific
--   findings to the subject and give them a real window to respond,
--   on the record, before publication. That single practice is doing
--   more legal work than almost anything else in this migration set,
--   and it did not exist here until now.
--
-- WHY THIS IS THE RIGHT TRIGGER, MECHANICALLY
--   "Is this finding negative" is a subjective, gameable judgment --
--   unreliable to encode and risky to get wrong in either direction.
--   "Does this finding cite evidence from a court or insolvency
--   source" is not subjective. sources.source_type already has both
--   as real categories. Anything citing either is, by its nature,
--   the class of finding a real newsroom would seek comment on before
--   running -- regardless of how neutrally it happens to be worded.
-- ============================================================

-- ------------------------------------------------------------
-- 1. The proactive offer. One row per (report_version, entity) --
-- not per finding -- because a developer gets one consolidated
-- request covering every adverse finding in that report version,
-- the way a real outlet would, not a separate email per citation.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS right_of_reply_offers (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  report_version_id  UUID NOT NULL REFERENCES report_versions(id) ON DELETE CASCADE,
  entity_id          UUID NOT NULL REFERENCES canonical_entities(id),
  covered_finding_ids UUID[] NOT NULL,
  offer_channel      TEXT NOT NULL DEFAULT 'email' CHECK (offer_channel IN ('email','portal','registered_post')),
  offered_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  response_deadline  TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '5 days'),
  developer_response_id UUID REFERENCES developer_responses(id),
  UNIQUE (report_version_id, entity_id)
);
CREATE INDEX IF NOT EXISTS idx_rrights_pending
  ON right_of_reply_offers (response_deadline)
  WHERE developer_response_id IS NULL;
COMMENT ON TABLE right_of_reply_offers IS
  'Five days is a starting policy, not a claim about what a court '
  'would consider reasonable in any given jurisdiction -- that is a '
  'real lawyer''s call, not this schema''s. What the schema guarantees '
  'is that SOME real window exists and is checked, not that this '
  'specific number is legally sufficient everywhere ShelterKart runs.';

-- ------------------------------------------------------------
-- 2. The publish gate learns a fourth check. Same function as
-- migrations 006 and 007, extended again rather than competing.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_publish_readiness()
RETURNS TRIGGER AS $$
DECLARE
  blocked_findings INTEGER;
  stale_unacknowledged INTEGER;
  unlegaled_findings INTEGER;
  unoffered_entities INTEGER;
  unresolved_offers INTEGER;
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

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- Once the deadline passes with no reply, or a reply is linked, the
-- report is free to publish -- the developer was asked and either
-- answered or chose not to. Both outcomes are legitimate; what the
-- gate refuses is publishing before they were ever asked at all.
