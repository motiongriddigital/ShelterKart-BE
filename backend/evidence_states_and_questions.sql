-- ============================================================
-- SHELTERKART — EVIDENCE STATES, QUESTIONS LIBRARY, CONFIDENCE
-- (migration 005)
--
-- WHAT THIS BUILDS ON
--   sources.authority_tier already encodes most of the escalation
--   ladder: 1=regulator, 2=corporate filing, 3=licensed commercial,
--   4=public claim. This migration does not replace that — it adds
--   the two rungs it was missing (human-captured primary, developer
--   self-report), makes the resulting trust level VISIBLE on every
--   finding rather than implicit in a join, and makes one of those
--   rungs incapable of moving a score, in the database, not just in
--   application code.
--
-- WHAT THIS FILE DELIBERATELY DOES NOT DO
--   It does not touch report rendering, scoring weights, or any live
--   report. It is additive schema only.
-- ============================================================

-- ------------------------------------------------------------
-- 1. THE MISSING RUNGS
-- authority_tier 1-4 already existed. Two more, both distinct from
-- "licensed commercial" (tier 3): a human physically visiting a
-- public page is a different, stronger act than a vendor's scraper,
-- and a developer's own claim is categorically different from any
-- third party's, however unreliable that party is.
-- ------------------------------------------------------------
-- The original CHECK on authority_tier was written inline and unnamed
-- in schema_evidence.sql, so Postgres auto-generated its name. Guessing
-- that name (the obvious guess is sources_authority_tier_check) and
-- blindly DROP-IF-EXISTS-ing it is unsafe: if the guess is wrong, the
-- drop silently no-ops, the new (1 to 6) constraint is added ALONGSIDE
-- the untouched old (1 to 4) one, both remain in force, and every
-- insert of tier 5 or 6 -- the entire point of this migration -- keeps
-- failing, while the migration itself reports success. So this block
-- finds the constraint by its actual definition, whatever Postgres
-- called it, rather than by a guessed name.
DO $$
DECLARE
  old_name TEXT;
BEGIN
  SELECT con.conname INTO old_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  WHERE rel.relname = 'sources'
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) ILIKE '%authority_tier%';

  IF old_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE sources DROP CONSTRAINT %I', old_name);
  END IF;

  ALTER TABLE sources ADD CONSTRAINT sources_authority_tier_check
    CHECK (authority_tier BETWEEN 1 AND 6);
END $$;
COMMENT ON COLUMN sources.authority_tier IS
  '1=primary regulator/government, 2=official corporate filing, '
  '3=licensed commercial data (documented chain of custody), '
  '4=publicly reported claim (uncorroborated), '
  '5=human-captured primary source (an operator opened the public '
  'page itself and saved it — see source_documents.capture_method), '
  '6=developer self-report — see the hard rule below. Newer never '
  'overrides more authoritative; tier decides precedence, recency '
  'only breaks ties within a tier.';

-- How a document reached us, distinct from where it's FROM (that's
-- sources.access_mode). A tier-5 document should always show
-- capture_method='human_operator'; anything else at tier 5 is a
-- data-entry error, not a policy one, so it's just documented here
-- rather than constrained — the constraint that actually matters is
-- the one on findings below.
ALTER TABLE source_documents ADD COLUMN IF NOT EXISTS capture_method TEXT
  CHECK (capture_method IN ('automated_fetch','human_operator','rti_response','developer_upload'));
COMMENT ON COLUMN source_documents.capture_method IS
  'automated_fetch: our own connector. human_operator: a person opened '
  'the public page and saved it — the checksum and retrieved_at are '
  'exactly as valid as an automated fetch''s. rti_response: obtained '
  'under India''s Right to Information Act, 2005 — the slowest rung '
  'but the least disputable. developer_upload: see the hard rule below.';

-- ------------------------------------------------------------
-- 2. THE EVIDENCE STATE — visible on every finding, not just
-- inferable from a join to sources.authority_tier.
-- ------------------------------------------------------------
ALTER TABLE findings ADD COLUMN IF NOT EXISTS evidence_state TEXT
  CHECK (evidence_state IN (
    'verified',              -- [1]  tier 1-2 source, or tier 5 human-captured from a tier 1-2 authority
    'licensed_aggregator',   -- §    tier 3, documented chain of custody, weighted 0.8x — see methodologies
    'corroborated',          -- ‡    2+ independent tier-4 sources agree on the same value
    'developer_statement',   -- [DS] tier 6 — see the hard rule; never counted
    'unverified',            -- †    a single uncorroborated tier-4 claim
    'not_found'              -- —    no source produced a value; triggers the questions library
  ));
CREATE INDEX IF NOT EXISTS idx_findings_evidence_state ON findings (evidence_state);

-- The mark and the underlying evidence must agree. A finding cannot
-- claim 'verified' while citing nothing but a tier-4 source, and it
-- cannot be 'not_found' while citing evidence — 'not_found' means
-- literally no evidence_ids, which is what generates the question.
CREATE OR REPLACE FUNCTION check_evidence_state_matches_sources()
RETURNS TRIGGER AS $$
DECLARE
  worst_tier SMALLINT;
  best_tier SMALLINT;
  n_tier4 INTEGER;
BEGIN
  IF NEW.evidence_state = 'not_found' THEN
    IF array_length(NEW.evidence_ids, 1) > 0 THEN
      RAISE EXCEPTION 'finding % marked not_found but cites evidence — use unverified or verified instead', NEW.id;
    END IF;
    RETURN NEW;
  END IF;

  IF array_length(NEW.evidence_ids, 1) IS NULL OR array_length(NEW.evidence_ids, 1) = 0 THEN
    RAISE EXCEPTION 'finding % has evidence_state % but no evidence_ids', NEW.id, NEW.evidence_state;
  END IF;

  SELECT min(s.authority_tier), max(s.authority_tier),
         count(*) FILTER (WHERE s.authority_tier = 4)
    INTO best_tier, worst_tier, n_tier4
  FROM evidence e
  JOIN source_documents sd ON sd.id = e.document_id
  JOIN sources s ON s.id = sd.source_id
  WHERE e.id = ANY(NEW.evidence_ids);

  IF NEW.evidence_state = 'verified' AND best_tier NOT IN (1,2) THEN
    -- tier 5 (human-captured) counts as verified only when the
    -- underlying authority itself is tier 1-2; that is already what
    -- best_tier reflects, since capture_method lives on the document,
    -- not the source's own tier.
    RAISE EXCEPTION 'finding % marked verified but best cited source is tier %, not 1 or 2', NEW.id, best_tier;
  END IF;

  IF NEW.evidence_state = 'licensed_aggregator' AND best_tier <> 3 THEN
    RAISE EXCEPTION 'finding % marked licensed_aggregator but best cited source is tier %, not 3', NEW.id, best_tier;
  END IF;

  IF NEW.evidence_state = 'corroborated' AND (worst_tier <> 4 OR n_tier4 < 2) THEN
    RAISE EXCEPTION 'finding % marked corroborated but does not cite 2+ independent tier-4 sources', NEW.id;
  END IF;

  IF NEW.evidence_state = 'developer_statement' AND worst_tier <> 6 THEN
    RAISE EXCEPTION 'finding % marked developer_statement but cites a non-tier-6 source — use the real tier instead', NEW.id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_check_evidence_state ON findings;
CREATE TRIGGER trg_check_evidence_state
  BEFORE INSERT OR UPDATE ON findings
  FOR EACH ROW
  WHEN (NEW.evidence_state IS NOT NULL)
  EXECUTE FUNCTION check_evidence_state_matches_sources();

-- ------------------------------------------------------------
-- 3. THE HARD RULE — a developer's own statement can never move a
-- score. Not a policy documented in a comment: a constraint the
-- database enforces regardless of what application code does.
-- ------------------------------------------------------------
ALTER TABLE findings DROP CONSTRAINT IF EXISTS developer_statement_never_scores;
ALTER TABLE findings ADD CONSTRAINT developer_statement_never_scores
  CHECK (evidence_state <> 'developer_statement' OR score_impact IS NULL OR score_impact = 0);
COMMENT ON CONSTRAINT developer_statement_never_scores ON findings IS
  'Constitution rule 5 and rule 1, enforced structurally: a developer '
  'self-report portal can exist, can make a report page look more '
  'complete, and can never move the number. This is the fence that '
  'makes such a portal safe to build at all — see the ShelterKart '
  'brainstorm on the developer self-report portal, phase 5.';

-- ------------------------------------------------------------
-- 4. THE QUESTIONS LIBRARY — the asset three separate planning
-- rounds converged on independently. Every not_found or unverified
-- finding resolves to a question here rather than a dead end.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS questions_library (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  finding_type       TEXT NOT NULL,          -- 'escrow_status' | 'possession_date' | 'title_clean' | ...
  question_text      TEXT NOT NULL,          -- verbatim, printed exactly as written
  good_answer        TEXT NOT NULL,
  bad_answer         TEXT NOT NULL,
  context            TEXT,                   -- why this question matters, one sentence
  applicable_tiers   TEXT[] NOT NULL DEFAULT ARRAY['silver','gold','platinum'],
  applicable_markets TEXT[] NOT NULL DEFAULT ARRAY['*'],  -- '*' = universal
  priority           SMALLINT NOT NULL DEFAULT 2 CHECK (priority BETWEEN 1 AND 3),
  active             BOOLEAN NOT NULL DEFAULT true,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_questions_finding_type ON questions_library (finding_type) WHERE active;

-- Seed: the questions already drafted and agreed across three rounds
-- of product planning this session, so the table isn't empty schema.
INSERT INTO questions_library (finding_type, question_text, good_answer, bad_answer, context, priority)
VALUES
  ('escrow_status',
   'Can I see the escrow statement, stamped by the bank, dated within 90 days?',
   'A PDF, dated, with the bank''s seal — in your hand the same day.',
   '"It''s fine, don''t worry." Any answer that isn''t a document.',
   'Escrow is the single control that stops a buyer''s money funding an unrelated project.', 1),

  ('possession_date',
   'Is the possession date on the registration the same as the date in the Agreement for Sale?',
   'Yes, both dated the same day — here''s a copy of each.',
   '"Roughly the same." The two documents should match exactly.',
   'A mismatch here is the most common early sign of a project drifting from its filed plan.', 1),

  ('title_clean',
   'Can I see the encumbrance certificate for this specific unit, not just the project?',
   'Yes, here it is — nothing on the title.',
   '"The project''s title is clean, so the unit''s is too." Not the same claim.',
   'Project-level and unit-level title status can genuinely differ once individual units are mortgaged.', 1),

  ('construction_progress',
   'What percentage of construction is complete as of last month''s filing?',
   'A specific number, dated, from the latest quarterly progress report.',
   '"It''s nearly done." Vague — ask to see the filing itself.',
   'A developer who can''t produce this number on request usually hasn''t filed it.', 2),

  ('promoter_litigation',
   'Are there any ongoing cases against this promoter, in any court, related to any project?',
   'A direct list, or "none" with an offer to show the eCourts search itself.',
   'A pause, a change of subject, or "nothing relevant to you."',
   'A promoter''s litigation history is one of the few signals that predicts future delays across ALL their projects, not just this one.', 2)
ON CONFLICT DO NOTHING;

-- ------------------------------------------------------------
-- 5. PER-COMPONENT CONFIDENCE — the score recomputation rule from
-- this session's product planning, made concrete rather than left as
-- "the total is recomputed against the remaining components."
-- ------------------------------------------------------------
ALTER TABLE report_versions ADD COLUMN IF NOT EXISTS confidence_label TEXT;
COMMENT ON COLUMN report_versions.confidence_label IS
  'Generated at publish time from components JSONB, e.g. '
  '"84/100 · High confidence — 5 of 6 components primary-verified" or '
  '"71/100 · Moderate confidence — 2 of 6 corroborated only, project '
  'layer not independently verifiable in this market." Computed by '
  'the report renderer from components[*].scored and '
  'components[*].evidence_state_summary — documented shape below, '
  'not enforced by the database since it is derived, display-only '
  'text regenerated on every render rather than a source of truth.';

COMMENT ON COLUMN report_versions.components IS
  'Per component: {key, label, weight, max_points, scored (bool), '
  'points_earned, best_evidence_state, contributing_evidence_ids[]}. '
  'When scored=false for a component, methodologies.min_coverage '
  'governs whether the OVERALL score exists at all (below threshold: '
  'score stays NULL, score_status=insufficient_evidence, exactly as '
  'already enforced by score_requires_coverage). Above threshold, the '
  'total is renormalised against only the components where scored=true '
  '— e.g. 5 of 6 components covering 90 of 100 possible weighted '
  'points, buyer''s displayed score is (raw_points_earned / 90) * 100, '
  'never silently averaged against the missing component as if it '
  'were a zero.';

-- ------------------------------------------------------------
-- WHAT THIS MIGRATION DOES NOT CLAIM
-- The trigger above enforces internal consistency — a finding's mark
-- can't contradict its own cited evidence. It cannot and does not
-- verify that the UNDERLYING evidence rows are honestly tiered; that
-- discipline still depends on sources.authority_tier being set
-- correctly when a source is registered, which is a human judgment
-- call, not something a CHECK constraint can validate.
-- ------------------------------------------------------------
