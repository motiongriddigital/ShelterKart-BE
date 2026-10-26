-- ============================================================
-- SHELTERKART — OPERATIONAL GAPS (migration 006)
--
-- Closes, in priority order: the publish-time kill switch, staleness
-- enforcement, the corrections mechanism, named editorial
-- responsibility, per-finding disclaimers, and developer-engagement
-- tracking for the flywheel metric.
--
-- WHAT THIS DOES NOT DO
--   It does not change the score formula. The proposed new
--   components (Construction Quality, Execution Capability,
--   Management Quality) rest on citations only partially verified so
--   far — one confirmed (ICRA's DR1-DR5), several not yet checked.
--   Committing new weights on unverified citations would repeat
--   exactly the mistake the NeSL claim made earlier this session.
--   methodologies.weights is already schema-flexible JSONB, so
--   adding components later needs no further migration — only a
--   verified methodology row.
-- ============================================================

-- ------------------------------------------------------------
-- 1. THE KILL SWITCH — one trigger, fired at every transition INTO
-- 'published', enforcing every publish-blocking rule in one place
-- rather than scattering separate checks across the app.
--
-- A report cannot publish if:
--   (a) it contains a finding with review_status IN ('flagged','rejected')
--   (b) it has no named responsible editor
--   (c) any evidence it relies on is stale beyond its source's TTL
--       and the report does not carry an explicit stale acknowledgement
-- ------------------------------------------------------------
ALTER TABLE report_versions ADD COLUMN IF NOT EXISTS responsible_editor_name TEXT;
ALTER TABLE report_versions ADD COLUMN IF NOT EXISTS responsible_editor_title TEXT;
ALTER TABLE report_versions ADD COLUMN IF NOT EXISTS corrections_contact TEXT;
COMMENT ON COLUMN report_versions.responsible_editor_name IS
  'A named human, not "ShelterKart Research" or "the model". When a '
  'defamation notice or a bank''s compliance team asks who signs off '
  'on this score, this is the answer. Required before publish -- see '
  'the kill-switch trigger below, which is the enforcement, not this '
  'comment.';

ALTER TABLE findings ADD COLUMN IF NOT EXISTS stale_acknowledged BOOLEAN NOT NULL DEFAULT false;
COMMENT ON COLUMN findings.stale_acknowledged IS
  'Set true only when a human has reviewed a finding whose source has '
  'exceeded its default_ttl_hours and decided to publish it anyway '
  'with a visible stale mark. Publishing stale evidence silently is '
  'exactly what this column exists to prevent -- see the kill switch.';

CREATE OR REPLACE FUNCTION enforce_publish_readiness()
RETURNS TRIGGER AS $$
DECLARE
  blocked_findings INTEGER;
  stale_unacknowledged INTEGER;
BEGIN
  IF NEW.lifecycle <> 'published' OR (TG_OP = 'UPDATE' AND OLD.lifecycle = 'published') THEN
    RETURN NEW;  -- only fires on the transition INTO published, not every update to an already-published row
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

  -- Stale check: a finding's evidence traces through source_documents
  -- to a source with a TTL. If the document is older than that TTL
  -- and nobody has acknowledged it, the report cannot publish as-is
  -- -- it must either be refreshed or explicitly marked stale.
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

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_enforce_publish_readiness ON report_versions;
CREATE TRIGGER trg_enforce_publish_readiness
  BEFORE INSERT OR UPDATE ON report_versions
  FOR EACH ROW
  EXECUTE FUNCTION enforce_publish_readiness();

-- ------------------------------------------------------------
-- 2. THE CORRECTIONS MECHANISM — an SLA that is a real deadline, not
-- a sentence in a policy document; a public-safe log distinct from
-- the internal dispute record (which may carry a buyer's contact
-- details); and notification tracking for buyers who already paid
-- for the version being superseded.
-- ------------------------------------------------------------
ALTER TABLE disputes ADD COLUMN IF NOT EXISTS sla_review_due TIMESTAMPTZ;
ALTER TABLE disputes ADD COLUMN IF NOT EXISTS sla_decision_due TIMESTAMPTZ;
ALTER TABLE disputes ADD COLUMN IF NOT EXISTS decision_published_at TIMESTAMPTZ;

-- Defaults set at submission time: review due in 3 days, decision due
-- in 10. Numbers are a starting policy, not a claim about what's
-- achievable -- change them in one place if the real SLA differs.
CREATE OR REPLACE FUNCTION set_dispute_sla()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.sla_review_due IS NULL THEN
    NEW.sla_review_due := NEW.submitted_at + interval '3 days';
  END IF;
  IF NEW.sla_decision_due IS NULL THEN
    NEW.sla_decision_due := NEW.submitted_at + interval '10 days';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_set_dispute_sla ON disputes;
CREATE TRIGGER trg_set_dispute_sla
  BEFORE INSERT ON disputes
  FOR EACH ROW
  EXECUTE FUNCTION set_dispute_sla();

-- Public-facing: one row per published correction. No contact info,
-- no internal dispute notes -- only what a reader is entitled to see.
CREATE TABLE IF NOT EXISTS corrections_log (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  report_public_ref TEXT NOT NULL,
  previous_version  INTEGER NOT NULL,
  corrected_version INTEGER NOT NULL,
  what_changed      TEXT NOT NULL,     -- plain-language, one paragraph
  why                TEXT NOT NULL,     -- what evidence prompted it
  published_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_corrections_ref ON corrections_log (report_public_ref, published_at DESC);

-- Who bought the superseded version, and whether they've been told.
CREATE TABLE IF NOT EXISTS report_notifications (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  report_purchase_id UUID,             -- FK not enforced here: report_purchases lives in schema.sql, a separate file
  report_public_ref TEXT NOT NULL,
  superseded_version INTEGER NOT NULL,
  new_version       INTEGER NOT NULL,
  notify_channel    TEXT NOT NULL DEFAULT 'email' CHECK (notify_channel IN ('email','sms','whatsapp')),
  notified_at       TIMESTAMPTZ,       -- NULL until actually sent
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_report_notif_pending ON report_notifications (report_public_ref) WHERE notified_at IS NULL;

-- ------------------------------------------------------------
-- 3. PER-FINDING DISCLAIMERS — structured per methodology version,
-- not hardcoded into a template file, so a wording change is a data
-- update, not a deploy.
-- ------------------------------------------------------------
ALTER TABLE methodologies ADD COLUMN IF NOT EXISTS disclaimer_templates JSONB NOT NULL DEFAULT '{}'::jsonb;
COMMENT ON COLUMN methodologies.disclaimer_templates IS
  'Keyed by findings.classification: {"fact": "...", "inference": "...", '
  '"opinion": "...", "prediction": "..."}. Rendered beneath every '
  'finding. Constitution rule 2 made literal at the point a reader '
  'actually sees it, not just documented as a principle.';

UPDATE methodologies SET disclaimer_templates = '{
  "fact": "A specific public filing, cited. Accurate as of the date shown; the underlying record may have changed since.",
  "inference": "Reasonably concluded from the facts above, labeled as such. Not itself a filing.",
  "opinion": "ShelterKart''s informational opinion, not a guarantee. Not legal or financial advice.",
  "prediction": "A hedged outlook, never a promise. The named risks could change this outcome."
}'::jsonb
WHERE disclaimer_templates = '{}'::jsonb;

-- ------------------------------------------------------------
-- 4. DEVELOPER ENGAGEMENT — the flywheel metric doc 17 asks for.
-- Whether developers actually improve their record because of a
-- score is an empirical question this table lets you answer, rather
-- than assume.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS developer_engagement_events (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  entity_id     UUID NOT NULL REFERENCES canonical_entities(id),
  event_type    TEXT NOT NULL CHECK (event_type IN (
                  'right_of_reply_filed',
                  'record_improved',       -- a subsequent report shows a previously-missing filing now present
                  'score_cited_externally' -- the developer referenced their score in their own marketing
                )),
  report_public_ref TEXT,                  -- which report this relates to, where applicable
  detail        TEXT,
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_engagement_entity ON developer_engagement_events (entity_id, event_type);

-- The metric itself: a simple view, not a stored number, so it is
-- always current rather than a snapshot someone forgot to refresh.
CREATE OR REPLACE VIEW developer_flywheel_summary AS
SELECT
  event_type,
  count(*) AS total_events,
  count(DISTINCT entity_id) AS distinct_developers
FROM developer_engagement_events
GROUP BY event_type;
COMMENT ON VIEW developer_flywheel_summary IS
  'The single most important metric for whether the flywheel is real: '
  'if right_of_reply_filed events exist but record_improved and '
  'score_cited_externally stay near zero for six months, developers '
  'are not engaging and the flywheel is aspirational, not real.';
