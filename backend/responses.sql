-- Respond or correct: one table for developer replies and for corrections from anyone (replaces the two older, separate tables for new
-- submissions). A response is confirmed by e-mail, screened, and either published beside the finding (a reply) or checked against the
-- sources (a correction). Nothing here can change a finding: a finding changes only through a correction with evidence, which is public.
CREATE TABLE IF NOT EXISTS responses (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  public_ref       TEXT NOT NULL UNIQUE,                       -- what the sender and the public see: SKR-XXXXXXXX
  report_ref       TEXT NOT NULL,
  kind             TEXT NOT NULL CHECK (kind IN ('reply','supply','error','missing','grade','outdated','privacy','legal')),
  role             TEXT NOT NULL CHECK (role IN ('developer','reader','named')),
  finding_id       TEXT,
  finding_text     TEXT,
  body             TEXT NOT NULL,
  evidence_urls    TEXT[] NOT NULL DEFAULT '{}',
  sender_name      TEXT,
  email            TEXT NOT NULL,                              -- for the receipt and follow-up only; never shown publicly
  verification     TEXT NOT NULL DEFAULT 'unverified' CHECK (verification IN ('domain_match','unverified')),
  status           TEXT NOT NULL DEFAULT 'awaiting_confirmation'
                   CHECK (status IN ('awaiting_confirmation','in_review','held','published','corrected','not_changed','needs_info','declined')),
  screen_reasons   TEXT[] NOT NULL DEFAULT '{}',
  token_hash       TEXT NOT NULL,                              -- sha256 of the e-mail confirmation token
  status_key_hash  TEXT NOT NULL,                              -- sha256 of the key that lets the sender read the status
  resolution_note  TEXT,                                       -- public when the outcome is a correction
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at     TIMESTAMPTZ,
  published_at     TIMESTAMPTZ,
  resolved_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_responses_report ON responses (report_ref, status);
CREATE INDEX IF NOT EXISTS idx_responses_token ON responses (token_hash);
CREATE INDEX IF NOT EXISTS idx_responses_email ON responses (email, created_at);
-- Buyers who asked for their report to be delivered: told if a finding in it is corrected. Used for that one purpose only.
CREATE TABLE IF NOT EXISTS report_watchers (
  report_ref  TEXT NOT NULL,
  email       TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (report_ref, email)
);
