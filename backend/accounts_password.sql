-- Optional password on a user account (scrypt, with the server secret mixed in). Sign-in by e-mail code keeps working with or without it.
-- Additive and idempotent. Applied by tools/migrate.js (twentieth). See docs/accounts/PASSWORD.md.

ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_set_at TIMESTAMPTZ;
