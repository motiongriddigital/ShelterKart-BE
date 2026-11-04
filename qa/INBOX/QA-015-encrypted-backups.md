---
id: QA-015-encrypted-backups
title: Encrypted database backups: schedule, manual run, notice, keys, decrypt and restore
repo: ShelterKart-BE
branch: feature/admin-backups
sha: 08ff3df
created: 2026-11-05
---

# QA-015: encrypted database backups

You are the QA agent. Your job is to verify, not to build. Read `qa/README.md` first and follow its rules. Terminal only, no browser. Use Git Bash and the native PostgreSQL 16 on this machine (a fresh database per section; `pg_dump`, `pg_restore`, `psql` and `createdb` must be on PATH: add the PostgreSQL `bin` folder to PATH for the shell if they are not). Use 127.0.0.1, `T=$(cygpath -m /tmp)` for any path handed to node, and stop servers by process id.

## What is under test

ShelterKart-BE, branch `feature/admin-backups`, commit `08ff3df` (stacked on `fix/qa-round-1`, `cb1b0cc`). New: `backend/engine/backups.js`, migration seventeen `backend/backups.sql`, `tools/backup-decrypt.js`, four admin routes, `docs/admin/BACKUPS-DESIGN.md`. Behaviour: every 14 days (`BACKUP_EVERY_DAYS`) and on demand the server runs `pg_dump`, streams it through AES-256-GCM into `BACKUP_DIR`, hashes and re-reads the file, and records the attempt in `backups`. Off until `BACKUP_KEY_ID` and a matching 64-hex `BACKUP_KEY_<id>` are set. File layout: `SKBK1`, key-id length, key id, 12-byte IV, ciphertext, 16-byte tag.

## What the builder did and how it was tested

18 unit checks (`test/backups.test.js`), the full `npm test`, and by hand on macOS with PostgreSQL 16: a real `pg_dump` encrypted, decrypted and `pg_restore`d into a scratch database (5,000 rows identical), a wrong key refused, the Postgres-backed `backups` table written. Not tested by the builder: Windows (paths, `pg_dump` from node, rename of the partial file), the scheduled first run, two simultaneous runs against a large database, the rate limit through the real server.

## Setup

```
git clone https://github.com/motiongriddigital/ShelterKart-BE.git sk-be15 && cd sk-be15
git checkout 08ff3df && cd backend && npm ci && cd ..
createdb -h 127.0.0.1 -U postgres sk_qa15
export DATABASE_URL=postgres://postgres:<password>@127.0.0.1:5432/sk_qa15
node tools/migrate.js
psql "$DATABASE_URL" -c "create table demo(a int, b text); insert into demo select g, md5(g::text) from generate_series(1,5000) g;"
T=$(cygpath -m /tmp); K1=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"); K2=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
```

Start the server (from `backend`) with the key; `B=http://127.0.0.1:4051`, admin login `-u maya:qa-pass-123`:

```
NODE_ENV=development PORT=4051 ADMIN_USERNAME=maya ADMIN_PASSWORD=qa-pass-123 ACCESS_TOKEN_SECRET=x QUOTE_SECRET=x PAYMENT_WEBHOOK_SECRET=x LIVE_JOBS_DIR=$T/sk-qa15-jobs BACKUP_DIR=$T/sk-qa15-bk BACKUP_KEY_ID=q1 BACKUP_KEY_q1=$K1 node server.js > /tmp/sk-qa15.log 2>&1 &
```

## Checks

Run each in order. For every check write PASS or FAIL and, on FAIL, the exact output.

| # | Do this | Expect |
| --- | --- | --- |
| A1 | in `backend`: `node test/backups.test.js` | ends `all 18 passing` |
| A2 | `npm test` (Git Bash; mark BLOCKED with the reason if Playwright or python3 is missing) | exit code 0; the migrations test now says seventeen |
| B1 | `node tools/migrate.js` on a second fresh database | `17 applied`, the last is `backups.sql`; run again: `0 applied, 17 already applied`. `psql -c "\d backups"` shows the table and the index `backups_started_idx` |
| C1 | `GET $B/api/admin/backups`, `/notice`, `/keys` and `POST /run` with no login and with a wrong password | `401` for all four, both ways |
| C2 | with the login: `GET /api/admin/backups/notice` before any backup | `200`, `notice.level` `warn`, text says no backup has been taken |
| C3 | `POST $B/api/admin/backups/run` | `200`, `backup` has `fileName` like `db-<UTC time>-q1.skbk`, `sizeBytes` > 0, a 64-hex `sha256`, `keyId` `q1`; the file exists in `$T/sk-qa15-bk` and no `.partial` file is left |
| C4 | `sha256sum` of that file | equals the `sha256` in C3 |
| C5 | `GET /api/admin/backups` | `enabled` true, `everyDays` 14, `keep` 6, one row `status` `ok`, `trigger` `manual`; `psql "$DATABASE_URL" -c "select id,status,trigger,key_id,file_name,sha256 from backups"` shows the same row |
| C6 | `GET /notice` and `GET /keys` | `level` `ok` with a next-due date 14 days out; `keys` is `[{id:q1, active:true, ageDays:0 ...}]` |
| C7 | Search for the key: `grep -c "$K1"` over the log `/tmp/sk-qa15.log`, over the output of C3, C5 and C6, over `psql ... -c "select * from backups"` and over the backup file itself | `0` everywhere |
| C8 | Read the first bytes of the file: `head -c 5 <file>` | `SKBK1`; the plain text of the demo rows (`md5` strings of 1 to 5000; try `grep -c "$(node -e "console.log(require('crypto').createHash('md5').update('1').digest('hex'))")" <file>`) is NOT found |
| D1 | Decrypt: `BACKUP_KEY_q1=$K1 node tools/backup-decrypt.js <file> $T/sk-qa15-restored.dump` | prints `ok: key q1`; the output file exists |
| D2 | `createdb sk_qa15_drill`, then `pg_restore --no-owner --dbname=postgres://postgres:<password>@127.0.0.1:5432/sk_qa15_drill $T/sk-qa15-restored.dump`, then `psql -d sk_qa15_drill -c "select count(*), min(a), max(a) from demo"` | `5000, 1, 5000` |
| D3 | Wrong key: `BACKUP_KEY_q1=$K2 node tools/backup-decrypt.js <file> $T/x.dump` | exit code 1, `wrong key or the file was changed`, no `x.dump` created |
| D4 | Tamper: copy the file, flip one byte in the middle (`node -e` that reads, XORs byte at length/2 with 1 and writes), decrypt the copy with the right key | exit code 1, same message, no output file |
| D5 | Truncate the copy by 10 bytes and decrypt; give a plain text file; give a missing path | each fails with a clear message, no stack trace, no output file |
| E1 | Failure path: start a SECOND server on port 4052 with the same environment except `DATABASE_URL=postgres://postgres:<password>@127.0.0.1:5432/does_not_exist`; `POST /run` | `502`, `code` `failed`; the error text does NOT contain the password or `postgres://`; `GET /notice` shows `level` `error` |
| E2 | After E1, no partial file in the second server's `BACKUP_DIR` (use a different `BACKUP_DIR` for it); `GET /backups` shows a `failed` row with a scrubbed `error` | as stated |
| E3 | Stop the second server. On the first, `POST /run` again | `200` (a failure does not wedge the next run) |
| F1 | Make the database large: `psql "$DATABASE_URL" -c "create table big as select g, md5(g::text) as m from generate_series(1,3000000) g"`. Fire two runs at once: `curl -s -X POST -u maya:qa-pass-123 $B/api/admin/backups/run & curl -s -X POST -u maya:qa-pass-123 $B/api/admin/backups/run; wait` | one `200` and one `409` with `code` `running`; exactly one new file |
| F2 | Rate limit: send manual runs until you have made more than three in an hour (count the ones from C3, E3 and F1) | the fourth within the hour is `429` |
| G1 | Keep: stop the server, restart with `BACKUP_KEEP=2` and a fresh `BACKUP_DIR`; wait for the limiter window by restarting (it is in memory); take three backups | exactly two `.skbk` files remain, the newest two; the `backups` table still lists all three rows |
| G2 | Rotation: restart with `BACKUP_KEY_ID=q2 BACKUP_KEY_q1=$K1 BACKUP_KEY_q2=$K2`; run one backup | the new file is named `...-q2.skbk`; `GET /keys` lists q1 and q2 with q2 active; the old q1 file still decrypts with `BACKUP_KEY_q1=$K1`; the new one decrypts with q2 only |
| G3 | Off state: restart with no `BACKUP_KEY_ID`; `GET /backups`, `GET /notice`, `POST /run` | `enabled` false; `level` `off`; `409` `not_configured`; the server runs normally otherwise |
| G4 | A malformed key: `BACKUP_KEY_ID=q1 BACKUP_KEY_q1=abc` | backups off (not a crash), no key text in the log |
| H1 | Schedule: fresh database, key set, `BACKUP_EVERY_DAYS=1`; start the server and wait up to 150 seconds without calling anything | a row with `trigger` `schedule` and `status` `ok` appears in `backups`, and a file exists |
| H2 | Restart the server right after H1 and wait 150 seconds | NO second scheduled backup (the last good one is less than a day old) |
| I1 | Follow `docs/admin/BACKUPS-DESIGN.md` "Restore" section literally in Git Bash | each command works as written; say which line needed a change on Windows |

## Look hardest at

- Key material anywhere it should not be (C7, E1, G4): logs, responses, the table, the file.
- A backup that reports `ok` but cannot be restored (D1, D2), or one that reports `ok` after a failed dump (E1, E2).
- A partial or half-written file left behind after a failure, or an open file handle that stops a rename on Windows (C3, E2, G1).
- Two runs at once (F1) and a restart in the middle of the schedule (H2).
- The `backups` table says `running` forever after a crash: kill the server (hard) during a run on the big database, restart, and report what `GET /backups` shows for that attempt (the server marks it failed about when the scheduler starts, which needs a key; say what you see).

## Teardown

Stop every server you started, drop `sk_qa15*` databases, remove `$T/sk-qa15-*` and `/tmp/sk-qa15.log`.

## Report

Write `qa/OUTBOX/QA-015-encrypted-backups.md` from `qa/RESULT-TEMPLATE.md`, then commit and push as in `qa/README.md`.
