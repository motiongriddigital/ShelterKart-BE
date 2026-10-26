-- ============================================================
-- SHELTERKART — EVIDENCE ARCHITECTURE (migration 002)
--
-- Purpose: make CONSTITUTION.md machine-enforceable rather than
-- aspirational. The core invariant this schema exists to support:
--
--     Score → Component → Finding → Evidence → Document → Source
--
-- Every number ShelterKart publishes must be walkable backwards
-- to a specific retrieved document. A finding with no evidence
-- row cannot be published; a score with insufficient coverage
-- must be NULL rather than a misleading average.
--
-- Apply AFTER schema.sql. Additive only — does not alter or drop
-- any existing table, so the current API keeps working unchanged
-- while the evidence pipeline is built alongside it.
-- ============================================================

-- ------------------------------------------------------------
-- CANONICAL ENTITIES
-- Names change; registration identifiers don't. Every developer
-- and project gets one opaque, stable ID that survives rebrands,
-- and aliases hang off it. This is what prevents the single most
-- dangerous class of error in this product: a perfectly
-- legitimate-looking report about the WRONG company.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS canonical_entities (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  entity_type       TEXT NOT NULL CHECK (entity_type IN ('developer','project','corporate_group','spv')),
  jurisdiction      TEXT NOT NULL,              -- ISO country code; the legal system that governs this entity
  canonical_name    TEXT NOT NULL,
  legal_name        TEXT,
  registration_id   TEXT,                       -- RERA / CIN / company number — the durable handle
  regulator         TEXT,                       -- which authority issued registration_id
  parent_entity_id  UUID REFERENCES canonical_entities(id),  -- SPV → developer → group
  relationship_type TEXT,                       -- 'subsidiary' | 'spv' | 'joint_venture' | 'promoter'
  status            TEXT NOT NULL DEFAULT 'active',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_entity_registration
  ON canonical_entities (jurisdiction, regulator, registration_id)
  WHERE registration_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_entity_parent ON canonical_entities (parent_entity_id);

-- Aliases are separate rows, never a comma-joined column, so that
-- "was this name ever used by this entity?" is an indexed lookup.
CREATE TABLE IF NOT EXISTS entity_aliases (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  entity_id    UUID NOT NULL REFERENCES canonical_entities(id) ON DELETE CASCADE,
  alias        TEXT NOT NULL,
  alias_type   TEXT NOT NULL,   -- 'trade_name' | 'former_name' | 'marketing_name' | 'transliteration'
  valid_from   DATE,
  valid_to     DATE,            -- NULL = still current
  source_id    UUID             -- where we learned this alias (FK added below)
);
CREATE INDEX IF NOT EXISTS idx_alias_lookup ON entity_aliases (lower(alias));

-- ------------------------------------------------------------
-- SOURCES — first-class objects, not a string like "MahaRERA"
--
-- access_mode is deliberately explicit and constrained. ShelterKart
-- retrieves records through channels the source operator permits.
-- A CAPTCHA or login wall is the operator declining automated
-- access; the answer is an official API, a data agreement, or the
-- human-assisted queue below — never automated circumvention.
-- Beyond the legal exposure, evidence obtained by defeating an
-- access control is evidence ShelterKart cannot defend when a
-- developer's counsel asks how it was obtained.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sources (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  authority          TEXT NOT NULL,             -- 'MahaRERA', 'Companies House', 'Dubai Land Department'
  jurisdiction       TEXT NOT NULL,
  source_type        TEXT NOT NULL,             -- 'regulator' | 'company_registry' | 'court' | 'insolvency' | 'land_registry' | 'planning'
  authority_tier     SMALLINT NOT NULL DEFAULT 1 CHECK (authority_tier BETWEEN 1 AND 4),
                     -- 1 = primary regulator/government, 2 = official corporate filing,
                     -- 3 = licensed commercial data, 4 = publicly reported claim.
                     -- Newer NEVER overrides more authoritative: tier decides precedence,
                     -- recency only breaks ties within a tier.
  access_mode        TEXT NOT NULL CHECK (access_mode IN (
                       'official_api',          -- documented API, key issued to us
                       'bulk_open_data',        -- published CSV/dataset download
                       'permitted_fetch',       -- public page, robots.txt allows, ToS reviewed
                       'data_agreement',        -- negotiated contractual access
                       'human_assisted'         -- gated: operator authenticates, see ingestion_jobs
                     )),
  base_url           TEXT,
  tos_reviewed_at    DATE,                      -- legal sign-off date; NULL = not cleared to use
  tos_notes          TEXT,                      -- what we may store/display/redistribute
  robots_allows      BOOLEAN,
  default_ttl_hours  INTEGER NOT NULL DEFAULT 168,  -- per-source freshness; court ≠ annual accounts
  status             TEXT NOT NULL DEFAULT 'healthy'
                     CHECK (status IN ('healthy','degraded','rate_limited','blocked','layout_changed','unavailable','quarantined')),
  last_success_at    TIMESTAMPTZ,
  last_failure_at    TIMESTAMPTZ,
  consecutive_fails  INTEGER NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sources_status ON sources (status, jurisdiction);

-- A source that is not cleared, or is unhealthy, must not silently
-- keep feeding "fresh" reports. Coverage downgrades instead.
COMMENT ON COLUMN sources.status IS
  'When not healthy, dependent findings must be marked stale and report coverage downgraded — never publish as current.';

-- ------------------------------------------------------------
-- DOCUMENTS — the actual retrieved artifact
-- checksum lets us prove an old report''s underlying source
-- document has not silently changed since it was cited.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS source_documents (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source_id         UUID NOT NULL REFERENCES sources(id),
  entity_id         UUID REFERENCES canonical_entities(id),
  document_type     TEXT NOT NULL,           -- 'project_registration' | 'annual_return' | 'court_order' | 'occupancy_certificate'
  external_ref      TEXT,                    -- the authority's own document/case number
  retrieved_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at      DATE,                    -- date the AUTHORITY published it, not when we fetched
  storage_key       TEXT,                    -- object-storage pointer to the raw artifact
  content_checksum  TEXT NOT NULL,           -- SHA-256 of raw bytes
  extraction_status TEXT NOT NULL DEFAULT 'pending'
                    CHECK (extraction_status IN ('pending','extracted','ocr_required','failed','quarantined')),
  extraction_engine TEXT,                    -- parser/OCR name + version, for regression tracing
  page_count        INTEGER,
  UNIQUE (source_id, external_ref, content_checksum)
);
CREATE INDEX IF NOT EXISTS idx_docs_entity ON source_documents (entity_id, retrieved_at DESC);

ALTER TABLE entity_aliases
  DROP CONSTRAINT IF EXISTS entity_aliases_source_fk;
ALTER TABLE entity_aliases
  ADD CONSTRAINT entity_aliases_source_fk
  FOREIGN KEY (source_id) REFERENCES source_documents(id);

-- ------------------------------------------------------------
-- EVIDENCE — a specific structured claim extracted from a document,
-- pinned to WHERE in that document it came from.
-- This is the layer that makes "[E-017]" in a report meaningful
-- rather than the generic "[1]" the demo frontend currently shows.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS evidence (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  public_ref        TEXT UNIQUE,             -- 'E-0042', shown in reports and tappable
  document_id       UUID NOT NULL REFERENCES source_documents(id),
  entity_id         UUID NOT NULL REFERENCES canonical_entities(id),
  field_key         TEXT NOT NULL,           -- 'registration_status' | 'completion_date' | 'litigation_case'
  value_text        TEXT,
  value_number      NUMERIC,
  value_date        DATE,
  value_json        JSONB,
  unit              TEXT,
  period_start      DATE,                    -- financials are meaningless without a period
  period_end        DATE,
  currency          TEXT,
  locator           JSONB,                   -- {page: 37, bbox: [...], selector: "..."} — provenance down to the page
  extraction_conf   NUMERIC CHECK (extraction_conf BETWEEN 0 AND 1),
  observed_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  superseded_by     UUID REFERENCES evidence(id),   -- append-only: never UPDATE a value, supersede it
  CONSTRAINT evidence_has_a_value CHECK (
    value_text IS NOT NULL OR value_number IS NOT NULL OR
    value_date IS NOT NULL OR value_json IS NOT NULL
  )
);
CREATE INDEX IF NOT EXISTS idx_evidence_entity_field ON evidence (entity_id, field_key, observed_at DESC);

-- Two authorities disagreeing is itself a finding, not something to
-- silently resolve by picking the newer row.
CREATE TABLE IF NOT EXISTS evidence_conflicts (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  entity_id       UUID NOT NULL REFERENCES canonical_entities(id),
  field_key       TEXT NOT NULL,
  evidence_a      UUID NOT NULL REFERENCES evidence(id),
  evidence_b      UUID NOT NULL REFERENCES evidence(id),
  resolution      TEXT NOT NULL DEFAULT 'unresolved'
                  CHECK (resolution IN ('unresolved','authority_precedence','superseded_in_time','both_reported')),
  detected_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- METHODOLOGY — versioned as data, not scattered constants.
-- A report generated under v1.2 must remain explainable under
-- v1.2 forever, even after v1.3 ships.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS methodologies (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  version        TEXT NOT NULL UNIQUE,     -- '1.2'
  jurisdiction   TEXT,                     -- NULL = global default; overrides allowed per market
  weights        JSONB NOT NULL,           -- {"legal":0.35,"delivery":0.30,"financial":0.20,"price":0.15}
  min_coverage   NUMERIC NOT NULL DEFAULT 0.60,  -- below this: NO score, not a misleading average
  definitions    JSONB NOT NULL DEFAULT '{}'::jsonb,
  effective_from DATE NOT NULL,
  effective_to   DATE,
  published_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- REPORT VERSIONS — immutable snapshots.
-- Constitution rule: corrections are never silent. A changed public
-- record produces version N+1; version N is retained exactly as the
-- buyer received it.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS report_versions (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  public_ref        TEXT NOT NULL,          -- 'SK-7F39A2' — stable across versions
  version_no        INTEGER NOT NULL,
  entity_id         UUID NOT NULL REFERENCES canonical_entities(id),
  methodology_id    UUID NOT NULL REFERENCES methodologies(id),
  score             INTEGER,                -- NULL is legitimate: insufficient evidence
  score_status      TEXT NOT NULL DEFAULT 'assessed'
                    CHECK (score_status IN ('assessed','insufficient_evidence','conflicting_evidence','source_unavailable','not_assessed')),
  coverage_pct      NUMERIC,
  coverage_level    TEXT CHECK (coverage_level IN ('full','partial','insufficient')),
  components        JSONB NOT NULL DEFAULT '{}'::jsonb,   -- per-component score + max + contributing evidence refs
  evidence_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb,   -- exact evidence IDs frozen into this version
  data_as_of        TIMESTAMPTZ,            -- newest source retrieval in the snapshot
  generated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_checked_at   TIMESTAMPTZ,            -- distinct from generated_at: rechecking ≠ regenerating
  pdf_checksum      TEXT,
  lifecycle         TEXT NOT NULL DEFAULT 'draft'
                    CHECK (lifecycle IN ('draft','evidence_collected','scored','quality_review','published','superseded')),
  supersedes        UUID REFERENCES report_versions(id),
  UNIQUE (public_ref, version_no)
);
CREATE INDEX IF NOT EXISTS idx_reportver_entity ON report_versions (entity_id, generated_at DESC);

-- A score without adequate evidence coverage is exactly the failure
-- mode the Constitution forbids. Enforced in the database, not left
-- to application discipline.
ALTER TABLE report_versions DROP CONSTRAINT IF EXISTS score_requires_coverage;
ALTER TABLE report_versions ADD CONSTRAINT score_requires_coverage
  CHECK (score IS NULL OR score_status = 'assessed');

-- ------------------------------------------------------------
-- FINDINGS — the human-readable statements in a report, each
-- classified and each tied to the evidence that produced it.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS findings (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  public_ref         TEXT,                  -- 'F-014'
  report_version_id  UUID NOT NULL REFERENCES report_versions(id) ON DELETE CASCADE,
  component          TEXT NOT NULL,         -- 'legal' | 'delivery' | 'financial' | 'price'
  classification     TEXT NOT NULL CHECK (classification IN ('fact','inference','opinion','prediction')),
  statement          TEXT NOT NULL,
  why_it_matters     TEXT,
  score_impact       NUMERIC,
  evidence_ids       UUID[] NOT NULL DEFAULT '{}',
  ai_model           TEXT,                  -- which model drafted the prose
  prompt_version     TEXT,
  review_status      TEXT NOT NULL DEFAULT 'auto'
                     CHECK (review_status IN ('auto','human_reviewed','flagged','rejected')),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_findings_version ON findings (report_version_id);

-- A FACT must cite evidence. Inference/opinion/prediction are
-- ShelterKart's own reasoning and are labelled as such in the UI,
-- so they may stand without a direct citation — but a bare factual
-- assertion with no evidence array is precisely a hallucination,
-- and the database refuses it.
ALTER TABLE findings DROP CONSTRAINT IF EXISTS fact_requires_evidence;
ALTER TABLE findings ADD CONSTRAINT fact_requires_evidence
  CHECK (classification <> 'fact' OR array_length(evidence_ids, 1) >= 1);

-- ------------------------------------------------------------
-- AI STAGING — model output NEVER writes canonical data directly.
-- Extractions land here, get validated against source text, and
-- are promoted only on success.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_extraction_candidates (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  document_id      UUID NOT NULL REFERENCES source_documents(id),
  field_key        TEXT NOT NULL,
  proposed_value   JSONB NOT NULL,
  locator          JSONB,
  model            TEXT NOT NULL,
  prompt_version   TEXT NOT NULL,
  confidence       NUMERIC,
  validation_state TEXT NOT NULL DEFAULT 'pending'
                   CHECK (validation_state IN ('pending','grounded','ungrounded','conflicting','promoted','rejected')),
  validation_note  TEXT,
  -- 'ungrounded' = the proposed value's literal string was not found
  -- in the extracted document text. Structural hallucination check;
  -- needs no second model to catch, and blocks promotion.
  promoted_evidence_id UUID REFERENCES evidence(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_candidates_state ON ai_extraction_candidates (validation_state, created_at);

-- ------------------------------------------------------------
-- INGESTION JOBS — the agent work queue.
--
-- Note 'awaiting_human_auth': when a source presents a CAPTCHA,
-- login, or other access control, the job PAUSES here for an
-- operator to authenticate in a supervised session. It does not
-- attempt to defeat the control. This is the difference between a
-- data company and a scraping operation, and it is the only
-- version of gated access that survives legal review.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ingestion_jobs (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source_id        UUID NOT NULL REFERENCES sources(id),
  entity_id        UUID REFERENCES canonical_entities(id),
  job_type         TEXT NOT NULL,          -- 'entity_search' | 'document_fetch' | 'refresh_check'
  state            TEXT NOT NULL DEFAULT 'queued'
                   CHECK (state IN ('queued','running','awaiting_human_auth','succeeded','failed','abandoned')),
  attempt_count    INTEGER NOT NULL DEFAULT 0,
  max_attempts     INTEGER NOT NULL DEFAULT 3,
  idempotency_key  TEXT UNIQUE,            -- same logical job never double-runs
  request_params   JSONB NOT NULL DEFAULT '{}'::jsonb,
  result_document  UUID REFERENCES source_documents(id),
  error_class      TEXT,                   -- 'rate_limited' | 'auth_required' | 'layout_changed' | 'timeout' | 'not_found'
  error_detail     TEXT,
  scheduled_for    TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at       TIMESTAMPTZ,
  finished_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_jobs_pickup ON ingestion_jobs (state, scheduled_for);

-- ------------------------------------------------------------
-- MATERIAL CHANGE EVENTS — powers "what changed since your report"
-- and the eventual Watch product. A fingerprint diff across ALL
-- material fields, not just registration status + litigation count.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS source_change_events (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  entity_id      UUID NOT NULL REFERENCES canonical_entities(id),
  source_id      UUID NOT NULL REFERENCES sources(id),
  field_key      TEXT NOT NULL,
  old_evidence   UUID REFERENCES evidence(id),
  new_evidence   UUID REFERENCES evidence(id),
  materiality    TEXT NOT NULL CHECK (materiality IN ('high','medium','low')),
  detected_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  notified_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_change_entity ON source_change_events (entity_id, detected_at DESC);

-- ------------------------------------------------------------
-- ENTITLEMENTS — server-authoritative paid access.
-- Replaces the localStorage flag the demo frontend uses. Only a
-- verified payment webhook may insert an 'active' row here.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS entitlements (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  subject_ref       TEXT NOT NULL,          -- verified contact identity (phone/email hash)
  report_version_id UUID NOT NULL REFERENCES report_versions(id),
  purchase_id       UUID,
  status            TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','active','expired','revoked','refunded')),
  granted_at        TIMESTAMPTZ,
  expires_at        TIMESTAMPTZ,
  revoked_at        TIMESTAMPTZ,
  UNIQUE (subject_ref, report_version_id)
);
CREATE INDEX IF NOT EXISTS idx_entitlement_lookup ON entitlements (subject_ref, status);

-- Payment provider events, stored before processing so a replayed
-- webhook cannot double-grant.
CREATE TABLE IF NOT EXISTS payment_events (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider       TEXT NOT NULL,
  event_id       TEXT NOT NULL,
  payload_hash   TEXT NOT NULL,
  signature_ok   BOOLEAN NOT NULL,
  received_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at   TIMESTAMPTZ,
  process_status TEXT NOT NULL DEFAULT 'received'
                 CHECK (process_status IN ('received','processed','ignored','failed')),
  UNIQUE (provider, event_id)
);

-- ------------------------------------------------------------
-- AUDIT LEDGER — append-only. Nobody quietly rewrites history,
-- including the founder.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
  id          BIGSERIAL PRIMARY KEY,
  actor       TEXT NOT NULL,        -- 'system' | 'agent:<name>' | 'admin:<user>'
  action      TEXT NOT NULL,        -- 'EVIDENCE_ADDED' | 'REPORT_PUBLISHED' | 'ENTITLEMENT_GRANTED' | ...
  object_type TEXT,
  object_id   UUID,
  before_state JSONB,
  after_state  JSONB,
  reason      TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_object ON audit_log (object_type, object_id, occurred_at DESC);

-- There is deliberately NO admin path that writes report_versions.score.
-- Constitution rule 1: a score is a consequence of evidence and
-- methodology. To change a score, change or add evidence and
-- regenerate — which produces a new version and an audit row.
