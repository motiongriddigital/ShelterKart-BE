-- ============================================================
-- ShelterKart — Database Schema
-- PostgreSQL 14+
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ------------------------------------------------------------
-- Developers (the entity, independent of any single project)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS developers (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name                TEXT NOT NULL,
  country             TEXT NOT NULL,
  city                TEXT,
  registration_number TEXT,
  is_claimed          BOOLEAN NOT NULL DEFAULT false,
  tier                TEXT NOT NULL DEFAULT 'free', -- free | verified | priority | analytics
  view_count          INTEGER NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_developers_name_trgm ON developers USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_developers_country_city ON developers (country, city);

-- ------------------------------------------------------------
-- Projects (belongs to a developer)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS projects (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  developer_id        UUID REFERENCES developers(id) ON DELETE SET NULL,
  project_name        TEXT NOT NULL,
  country             TEXT NOT NULL,
  city                TEXT,
  registration_number TEXT,
  price_band_min      NUMERIC,
  price_band_max      NUMERIC,
  currency            TEXT,
  view_count          INTEGER NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_projects_name_trgm ON projects USING gin (project_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_projects_country_city ON projects (country, city);
CREATE INDEX IF NOT EXISTS idx_projects_developer ON projects (developer_id);

-- ------------------------------------------------------------
-- Reports (cached, versioned — one row per generation)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reports (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  entity_type   TEXT NOT NULL CHECK (entity_type IN ('developer','project')),
  entity_id     UUID NOT NULL,
  country       TEXT,
  city          TEXT,
  score         INTEGER,
  status        TEXT NOT NULL DEFAULT 'Unverified', -- Unverified | Scored
  verdict       TEXT,                                -- Trusted | Proceed with Care | High Caution
  report_json   JSONB NOT NULL DEFAULT '{}'::jsonb,
  generated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reports_entity ON reports (entity_type, entity_id, generated_at DESC);

-- ------------------------------------------------------------
-- OTP verification (phone-based, used to gate PDF/email/WhatsApp delivery)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS otp_verifications (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contact_type  TEXT NOT NULL DEFAULT 'phone',
  contact_value TEXT NOT NULL,
  code          TEXT NOT NULL,
  verified      BOOLEAN NOT NULL DEFAULT false,
  attempts      INTEGER NOT NULL DEFAULT 0,
  expires_at    TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_otp_contact ON otp_verifications (contact_type, contact_value, created_at DESC);

-- ------------------------------------------------------------
-- Buyer leads (captured on OTP verification / checkout)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS buyer_leads (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name           TEXT,
  phone          TEXT,
  email          TEXT,
  phone_verified BOOLEAN NOT NULL DEFAULT false,
  report_ref     TEXT,
  captured_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_buyer_leads_phone ON buyer_leads (phone);
CREATE INDEX IF NOT EXISTS idx_buyer_leads_email ON buyer_leads (email);

-- ------------------------------------------------------------
-- Disputes / corrections (quiet, always-available per brief)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS disputes (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contact         TEXT,
  note            TEXT NOT NULL,
  report_ref      TEXT,
  previous_value  TEXT,
  corrected_value TEXT,
  status          TEXT NOT NULL DEFAULT 'open', -- open | reviewing | resolved | rejected
  submitted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_disputes_status ON disputes (status);

-- ------------------------------------------------------------
-- Developer Right of Reply — Constitution rule 5: "developers
-- have a right to respond." Distinct from `disputes` (which is a
-- buyer flagging something as wrong) — this is a developer
-- responding to a specific finding, never editing it. Requires
-- admin approval before it becomes public; never auto-published.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS developer_responses (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  report_ref      TEXT NOT NULL,
  finding_text    TEXT NOT NULL,   -- the specific finding being responded to, as submitted
  response_text   TEXT NOT NULL,
  contact_email   TEXT NOT NULL,   -- for admin follow-up only, never shown publicly
  status          TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected
  submitted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_devresponses_status ON developer_responses (status);
CREATE INDEX IF NOT EXISTS idx_devresponses_ref ON developer_responses (report_ref);

-- ------------------------------------------------------------
-- One-time report unlock purchases (distinct from Watch subscriptions)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS report_purchases (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  report_ref     TEXT NOT NULL,
  buyer_lead_id  UUID REFERENCES buyer_leads(id) ON DELETE SET NULL,
  amount         NUMERIC NOT NULL,
  currency       TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pending_payment', -- pending_payment | active | refunded
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_report_purchases_ref ON report_purchases (report_ref);

-- ------------------------------------------------------------
-- Watch subscriptions ("Watch This Property")
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS subscriptions (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id     UUID REFERENCES projects(id) ON DELETE CASCADE,
  buyer_lead_id  UUID REFERENCES buyer_leads(id) ON DELETE SET NULL,
  tier           TEXT NOT NULL,
  billing_type   TEXT NOT NULL, -- monthly | flat
  amount         NUMERIC NOT NULL,
  currency       TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pending_payment', -- pending_payment | active | cancelled
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_subscriptions_project ON subscriptions (project_id);

-- ------------------------------------------------------------
-- Seed: a couple of rows so /api/resolve returns something
-- immediately after setup (safe to delete).
-- ------------------------------------------------------------
INSERT INTO developers (name, country, city, registration_number, is_claimed)
VALUES ('Lodha Group', 'India', 'Mumbai', 'MAHA-DEV-0001', false)
ON CONFLICT DO NOTHING;
