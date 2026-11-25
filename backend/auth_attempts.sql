-- One row per sign-in code attempt that was allowed to run, with the connection it came from and whether that
-- connection asked for the code. Read by verify-code to budget attempts per connection, for connections other than
-- the requester, and for the address as a whole. Additive and idempotent. Applied by tools/migrate.js.
-- See docs/accounts/SIGNIN-LOCKOUT.md.

CREATE TABLE IF NOT EXISTS auth_attempts (
  id           BIGSERIAL PRIMARY KEY,
  email_lower  TEXT NOT NULL,
  ip_hash      TEXT,
  is_requester BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_auth_attempts_email ON auth_attempts (email_lower, created_at DESC);
