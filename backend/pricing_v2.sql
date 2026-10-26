-- ============================================================
-- SHELTERKART — PRICING AND PAYMENTS, V1 (migration 022; the ninth required migration)
--
-- The fee for a report is set by the PROPERTY and the evidence depth, the same in dollars for every buyer. The
-- buyer's country decides the currency (a ladder of round price points per currency), the tax, and the
-- payment route. Everything that varies by country, currency or time is a row, so adding a country is data.
--
-- Reference tables (countries ... payment_routes) are filled from backend/data/*.json by
-- `node tools/seed_pricing.js`, so every price book and tax profile that ever applied stays auditable here.
-- The server itself reads the same reviewed release files.
--
-- Transactional tables (quotes, pricing_events, tax_ledger, refunds, invoices) are written by the server.
-- ============================================================

-- ---------- reference data ----------
CREATE TABLE IF NOT EXISTS countries (
  iso          TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  currency     TEXT NOT NULL,
  tax_profile  TEXT,
  selectable   BOOLEAN NOT NULL DEFAULT TRUE,
  blocked      BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE TABLE IF NOT EXISTS currencies (
  code        TEXT PRIMARY KEY,
  minor_unit  INT NOT NULL CHECK (minor_unit IN (0, 2, 3)),
  fine        BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE TABLE IF NOT EXISTS fx_snapshots (
  id        SERIAL PRIMARY KEY,
  as_of     DATE NOT NULL,
  source    TEXT NOT NULL,
  per_usd   JSONB NOT NULL
);
CREATE TABLE IF NOT EXISTS price_books (
  version     TEXT PRIMARY KEY,
  status      TEXT NOT NULL CHECK (status IN ('draft', 'active', 'retired')),
  fx_as_of    DATE,
  params      JSONB NOT NULL,
  guardrails  JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- only one book is active at a time
CREATE UNIQUE INDEX IF NOT EXISTS uq_price_books_one_active ON price_books ((status)) WHERE status = 'active';
CREATE TABLE IF NOT EXISTS price_ladders (
  book_version  TEXT NOT NULL REFERENCES price_books (version),
  currency      TEXT NOT NULL,
  rung          INT NOT NULL,
  usd_target    NUMERIC NOT NULL,
  amount        NUMERIC NOT NULL,
  PRIMARY KEY (book_version, currency, rung)
);
CREATE TABLE IF NOT EXISTS tax_profiles (
  id                TEXT PRIMARY KEY,
  mode              TEXT NOT NULL CHECK (mode IN ('we_collect', 'not_required_yet', 'registration_required', 'no_tax', 'unverified')),
  name              TEXT NOT NULL,
  rate_bps          INT NOT NULL DEFAULT 0,
  inclusive         BOOLEAN NOT NULL DEFAULT TRUE,
  registration_env  TEXT,
  thresholds        JSONB,
  threshold_mode    TEXT,
  verified          BOOLEAN NOT NULL DEFAULT FALSE,
  source            TEXT,
  valid_from        DATE
);
CREATE TABLE IF NOT EXISTS payment_routes (
  id          TEXT PRIMARY KEY,
  provider    TEXT NOT NULL,
  countries   TEXT[] NOT NULL,
  currencies  TEXT[] NOT NULL,
  enabled     BOOLEAN NOT NULL DEFAULT FALSE,
  note        TEXT
);

-- ---------- quotes: every price ever shown at unlock ----------
CREATE TABLE IF NOT EXISTS quotes (
  id                  TEXT PRIMARY KEY,
  report_ref          TEXT NOT NULL,
  buyer_session       TEXT NOT NULL,
  buyer_country       TEXT NOT NULL,
  country_source      TEXT NOT NULL,                 -- selected | network | billing | default
  currency            TEXT NOT NULL,
  property_value      NUMERIC,
  property_currency   TEXT,
  depth               TEXT NOT NULL,
  rung                INT NOT NULL,
  amount_net          BIGINT NOT NULL,               -- smallest currency unit
  tax_amount          BIGINT NOT NULL,
  amount_gross        BIGINT NOT NULL,
  tax_rate_bps        INT NOT NULL,
  tax_name            TEXT,
  tax_mode            TEXT,
  price_book_version  TEXT NOT NULL,
  issued_at           TIMESTAMPTZ NOT NULL,
  expires_at          TIMESTAMPTZ NOT NULL,
  status              TEXT NOT NULL CHECK (status IN ('open', 'used', 'superseded')),
  supersedes_id       TEXT,
  signature           TEXT NOT NULL,
  body                JSONB NOT NULL                 -- the quote exactly as issued; never edited, only its status changes
);
CREATE INDEX IF NOT EXISTS idx_quotes_ref_session ON quotes (report_ref, buyer_session, status);

-- ---------- audit trail: quote issued, country changed, billing mismatch, re-quote, refund, threshold... ----------
CREATE TABLE IF NOT EXISTS pricing_events (
  id          BIGSERIAL PRIMARY KEY,
  at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  type        TEXT NOT NULL,
  quote_id    TEXT,
  report_ref  TEXT,
  details     JSONB NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_pricing_events_type_at ON pricing_events (type, at);

-- ---------- tax exposure: sales per country and month, in the sale currency ----------
CREATE TABLE IF NOT EXISTS tax_ledger (
  country        TEXT NOT NULL,
  month          TEXT NOT NULL,                      -- 'YYYY-MM'
  currency       TEXT NOT NULL,
  gross_sales    NUMERIC NOT NULL DEFAULT 0,
  tax_collected  NUMERIC NOT NULL DEFAULT 0,
  PRIMARY KEY (country, month, currency)
);

-- ---------- money returned ----------
CREATE TABLE IF NOT EXISTS refunds (
  id            BIGSERIAL PRIMARY KEY,
  purchase_id   UUID NOT NULL,
  amount        NUMERIC NOT NULL CHECK (amount > 0),
  currency      TEXT NOT NULL,
  tax_reversed  NUMERIC NOT NULL DEFAULT 0,
  reason        TEXT,
  provider_ref  TEXT,
  status        TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_refunds_purchase ON refunds (purchase_id);

-- ---------- invoices: numbered without gaps ----------
CREATE TABLE IF NOT EXISTS invoice_counters (
  series  TEXT PRIMARY KEY,
  last    INT NOT NULL
);
CREATE TABLE IF NOT EXISTS invoices (
  id            BIGSERIAL PRIMARY KEY,
  purchase_id   UUID NOT NULL,
  number        TEXT NOT NULL UNIQUE,
  kind          TEXT NOT NULL CHECK (kind IN ('gst', 'export', 'provider')),
  country       TEXT NOT NULL,
  currency      TEXT NOT NULL,
  amount_net    NUMERIC NOT NULL,
  tax_amount    NUMERIC NOT NULL,
  amount_gross  NUMERIC NOT NULL,
  tax_rate_bps  INT NOT NULL,
  body          JSONB NOT NULL,
  issued_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_invoices_purchase ON invoices (purchase_id);

-- ---------- the purchase record gains what an audit needs ----------
ALTER TABLE report_purchases ADD COLUMN IF NOT EXISTS quote_id            TEXT;
ALTER TABLE report_purchases ADD COLUMN IF NOT EXISTS buyer_country       TEXT;
ALTER TABLE report_purchases ADD COLUMN IF NOT EXISTS billing_country     TEXT;
ALTER TABLE report_purchases ADD COLUMN IF NOT EXISTS billing_state       TEXT;
ALTER TABLE report_purchases ADD COLUMN IF NOT EXISTS amount_net          NUMERIC;   -- the sale, before tax
ALTER TABLE report_purchases ADD COLUMN IF NOT EXISTS tax_amount          NUMERIC;
ALTER TABLE report_purchases ADD COLUMN IF NOT EXISTS tax_rate_bps        INT;
ALTER TABLE report_purchases ADD COLUMN IF NOT EXISTS tax_mode            TEXT;
ALTER TABLE report_purchases ADD COLUMN IF NOT EXISTS price_book_version  TEXT;
ALTER TABLE report_purchases ADD COLUMN IF NOT EXISTS provider_fee        NUMERIC;   -- as the provider reported it
ALTER TABLE report_purchases ADD COLUMN IF NOT EXISTS net_revenue         NUMERIC;   -- written once, from settlement data; reduced by refunds
ALTER TABLE report_purchases ADD COLUMN IF NOT EXISTS buyer_kind          TEXT;      -- individual | business (V1 treats both as consumers)
ALTER TABLE report_purchases ADD COLUMN IF NOT EXISTS tax_id              TEXT;      -- as given by a business buyer; stored, not validated, in V1
CREATE INDEX IF NOT EXISTS idx_report_purchases_quote ON report_purchases (quote_id);

COMMENT ON COLUMN report_purchases.amount IS 'The GROSS total the buyer paid, in `currency`: exactly the quote total.';
COMMENT ON COLUMN report_purchases.net_revenue IS 'Price before tax, minus the provider fee, written once. Foreign-currency fees settle in rupees: reconcile from the settlement report.';
