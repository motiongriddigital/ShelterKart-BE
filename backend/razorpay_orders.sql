-- ============================================================
-- SHELTERKART — RAZORPAY ORDERS ON PURCHASES (migration 016)
--
-- Razorpay's own documentation: store the order id against the
-- transaction, and verify every payment signature with the order id
-- FROM YOUR SERVER -- never the one the browser sends back. These
-- columns are where that server-side order id lives.
-- ============================================================
ALTER TABLE report_purchases ADD COLUMN IF NOT EXISTS provider            TEXT;
ALTER TABLE report_purchases ADD COLUMN IF NOT EXISTS provider_order_id   TEXT;
ALTER TABLE report_purchases ADD COLUMN IF NOT EXISTS provider_payment_id TEXT;
ALTER TABLE report_purchases ADD COLUMN IF NOT EXISTS paid_at             TIMESTAMPTZ;

-- One Razorpay order belongs to exactly one purchase, and one payment
-- can settle exactly one purchase.
CREATE UNIQUE INDEX IF NOT EXISTS uq_report_purchases_provider_order
  ON report_purchases (provider, provider_order_id) WHERE provider_order_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_report_purchases_provider_payment
  ON report_purchases (provider, provider_payment_id) WHERE provider_payment_id IS NOT NULL;

COMMENT ON COLUMN report_purchases.status IS
  'pending_payment -> paid (set only by a verified provider signature or signed webhook) | refunded';
