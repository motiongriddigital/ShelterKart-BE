-- User accounts: e-mail sign-in by code, cookie sessions, the user's reports, and the owner of each purchase.
-- Additive and idempotent. Applied by tools/migrate.js (thirteenth). See docs/accounts/TDD.md section 3.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS users (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email             TEXT NOT NULL,
  email_verified_at TIMESTAMPTZ,
  display_name      TEXT,
  country           TEXT,
  language          TEXT,
  phone             TEXT,
  phone_consent_at  TIMESTAMPTZ,
  terms_version     TEXT,
  privacy_version   TEXT,
  terms_accepted_at TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at     TIMESTAMPTZ,
  disabled_at       TIMESTAMPTZ,
  deleted_at        TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email_live ON users (lower(email)) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS auth_codes (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email_lower TEXT NOT NULL,
  code_hash   TEXT NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  expires_at  TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  ip_hash     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_auth_codes_email ON auth_codes (email_lower, created_at DESC);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash   TEXT PRIMARY KEY,
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL,
  revoked_at   TIMESTAMPTZ,
  ip_hash      TEXT,
  user_agent   TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS user_reports (
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  report_ref      TEXT NOT NULL,
  first_opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_opened_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, report_ref)
);

ALTER TABLE report_purchases ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_report_purchases_user ON report_purchases (user_id, report_ref) WHERE user_id IS NOT NULL;

-- Sign-in activity: every code request, wrong code, lock, rate-limit hit and sign-in, so an admin can see how often a person tried.
-- No code and no e-mail body is stored. The IP address is kept only as a peppered hash. Rows older than 90 days are deleted by the daily clean-up.
CREATE TABLE IF NOT EXISTS auth_events (
  id          BIGSERIAL PRIMARY KEY,
  at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  email_lower TEXT,
  user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  ip_hash     TEXT,
  kind        TEXT NOT NULL,
  detail      TEXT
);
CREATE INDEX IF NOT EXISTS idx_auth_events_email ON auth_events (email_lower, at DESC);
CREATE INDEX IF NOT EXISTS idx_auth_events_user ON auth_events (user_id, at DESC) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_auth_events_at ON auth_events (at);

-- Bans by an admin: an account (by e-mail) or an IP address (a raw IPv4 or range, or "hash:<peppered hash>" taken from a session).
CREATE TABLE IF NOT EXISTS bans (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  kind       TEXT NOT NULL CHECK (kind IN ('account', 'ip')),
  target     TEXT NOT NULL,
  reason     TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  created_by TEXT NOT NULL,
  lifted_at  TIMESTAMPTZ,
  lifted_by  TEXT
);
CREATE INDEX IF NOT EXISTS idx_bans_active ON bans (kind, target) WHERE lifted_at IS NULL;
