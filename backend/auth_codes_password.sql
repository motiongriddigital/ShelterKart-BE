-- A password offered when a sign-in code is requested, held against that code until it is verified, then moved onto
-- the account. Additive and idempotent. Applied by tools/migrate.js. See docs/accounts/PASSWORD.md.

ALTER TABLE auth_codes ADD COLUMN IF NOT EXISTS password_hash TEXT;
