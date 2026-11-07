-- Indexes for foreign keys that the code deletes through or looks up (SHEL-64, indexing). Additive and idempotent.
-- Applied by tools/migrate.js (eighteenth). The tables are small, so plain CREATE INDEX is safe inside the runner's transaction.
-- Larger tables go in a file whose first line is "-- migrate: no-transaction" and use CREATE INDEX CONCURRENTLY.

CREATE INDEX IF NOT EXISTS idx_error_hits_error ON error_hits (error_id);
CREATE INDEX IF NOT EXISTS idx_report_purchases_buyer_lead ON report_purchases (buyer_lead_id) WHERE buyer_lead_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_subscriptions_buyer_lead ON subscriptions (buyer_lead_id) WHERE buyer_lead_id IS NOT NULL;
