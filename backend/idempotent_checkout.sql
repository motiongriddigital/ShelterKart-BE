-- ============================================================
-- SHELTERKART — IDEMPOTENT CHECKOUT (migration 017)
--
-- Nothing made a retried checkout safe: a network timeout followed by
-- the buyer clicking Unlock again created a second Razorpay order and
-- a second pending purchase row for the same intent. The buyer only
-- ever sees one of them, so the other becomes an orphaned pending row
-- -- confusing at best, a real duplicate-order-vs-duplicate-charge risk
-- at worst if both were ever paid.
-- ============================================================
ALTER TABLE report_purchases ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

-- One key names exactly one attempt. Two rows would mean two orders
-- for what the client believes is one action.
CREATE UNIQUE INDEX IF NOT EXISTS uq_report_purchases_idempotency_key
  ON report_purchases (idempotency_key) WHERE idempotency_key IS NOT NULL;

COMMENT ON COLUMN report_purchases.idempotency_key IS
  'Client-generated once per unlock attempt and kept in sessionStorage, '
  'so a retry -- even after a page reload -- resubmits the SAME key. '
  'The checkout route returns the existing purchase for a known key '
  'instead of creating a second one.';
