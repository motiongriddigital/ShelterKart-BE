-- ============================================================
-- SHELTERKART: WHERE A PAID REPORT CAME FROM (migration 012)
--
-- The marketing dashboard needs each paid report traced to the channel that brought the buyer. The payment arrives later, from the
-- provider's webhook, which knows nothing about the visit, so the checkout keeps the buyer's source (the UTM tags and referring page
-- of the first page of the visit, as the browser reports it) and the property's market on the purchase itself.
-- No identifier is stored: the same fields the first-party analytics already keeps per event.
-- ============================================================
ALTER TABLE report_purchases ADD COLUMN IF NOT EXISTS attribution JSONB NOT NULL DEFAULT '{}'::jsonb;
