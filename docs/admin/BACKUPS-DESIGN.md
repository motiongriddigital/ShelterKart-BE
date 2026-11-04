# Database backups: design, what is built, what the owner decides

Status: built on `feature/admin-backups`. Off until a key is set. Two decisions are the owner's (below); the code works with either answer.

## What it does

- Every 14 days (`BACKUP_EVERY_DAYS`, 1 to 90) and on demand, the server runs `pg_dump --format=custom --no-owner`, streams the output through AES-256-GCM into one file in `BACKUP_DIR`, hashes the file, re-reads it to check the hash, and records the attempt in the `backups` table (migration seventeen). A failed attempt is recorded with a scrubbed reason and is retried after six hours, not every hour.
- The newest `BACKUP_KEEP` (6) good files are kept; older ones are deleted. Failed attempts never count towards the six.
- Connection details reach `pg_dump` as `PG*` environment variables, so the password is not in the process list. Error text is scrubbed of connection strings, passwords and long tokens before it is stored or shown.
- Routes (admin login): `GET /api/admin/backups`, `POST /api/admin/backups/run` (three an hour), `GET /api/admin/backups/notice` (what the header shows: off, ok, warn when none yet or more than two days overdue, error when the last attempt failed), `GET /api/admin/backups/keys` (key ids and ages only). No response ever holds key material.

## File format (`*.skbk`)

`SKBK1` | key id length (1 byte) | key id | IV (12 random bytes) | ciphertext (AES-256-GCM) | authentication tag (16 bytes). Because the tag covers the whole file, one changed byte or a wrong key stops the restore with an error and leaves no output. The key id in the header tells which key to use, so keys can be rotated: add `BACKUP_KEY_k2`, set `BACKUP_KEY_ID=k2`, and keep `BACKUP_KEY_k1` so older files still open.

## Decisions for the owner

1. **Where the files go.** Today: a folder (`BACKUP_DIR`). A folder on the same disk as the database does not protect against losing the host. Pick one: (a) a volume mounted from another machine or provider; (b) a folder that something else syncs off the host (rclone, rsync, the host's snapshot of that volume); (c) an object store (needs a small destination adapter: `put`, `list`, `remove`, about 40 lines, not built because the provider is not chosen).
2. **Who holds the key.** The key is read from the server's environment, so the server can write backups but a copy must be kept elsewhere (a password manager or a printed sealed copy). A key kept only on the host dies with the host and the backups become unreadable. Generate with `openssl rand -hex 32`. Rotating the key every 12 months is reasonable; the admin screen shows each key's age.

## Restore (rehearse before the first real backup counts)

Never restore over the live database. Use a scratch database.

```
# 1. fetch the newest db-*.skbk from the destination and the key from where it is kept
BACKUP_KEY_k1=<64 hex> node tools/backup-decrypt.js db-20261104T100000Z-k1.skbk restored.dump
# 2. restore into a scratch database
createdb shelterkart_drill
pg_restore --no-owner --dbname=postgres://.../shelterkart_drill restored.dump
# 3. check: counts of a few tables match what you expect; ops/restore_drill.sh does the same for the older nightly dumps
# 4. drop the scratch database and delete restored.dump
```

A rehearsal was run on 2026-11-04 on PostgreSQL 16 with a throwaway database: 5,000 rows and a JSONB table came back identical, and a wrong key was refused with no output file. Repeat it on the real host once, with the real key, before relying on this.

## Not built (on purpose)

- A restore button in the panel. Restoring is rare, dangerous and should be a person at a terminal.
- Backing up `LIVE_JOBS_DIR` (saved investigations). `ops/backup.sh` still does that, and the two can run side by side.
- An audit-ledger row for a manual backup: the ledger is on `fix/admin-audit-legal`; add one line there when the two branches meet.
- Alerts to the operator when a backup fails: the header notice shows it; wiring `alertOperator` is one line once the owner wants e-mail for it.

## Files

`backend/engine/backups.js`, `backend/backups.sql`, `tools/backup-decrypt.js`, `backend/test/backups.test.js` (18 checks), OpenAPI entries under Admin.
