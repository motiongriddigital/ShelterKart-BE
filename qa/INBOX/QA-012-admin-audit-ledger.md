---
id: QA-012-admin-audit-ledger
title: An audit ledger for legal and takedown actions, and GET /api/admin/audit
repo: ShelterKart-BE
branch: fix/admin-audit-legal
sha: 01d7fe5
created: 2026-11-04
---

# QA-012: the admin audit ledger

You are the QA agent. Your job is to verify, not to build. Read `qa/README.md` first and follow its rules. Terminal only, no browser.

## What is under test

ShelterKart-BE, branch `fix/admin-audit-legal`, commit `01d7fe5` (stacked on `feature/admin-engines`, `4ac4f0b`). Resolving a dispute, approving or rejecting a developer's reply, releasing held adverse findings and purging a source used to write no audit row at all. Each now writes one row to the existing append-only table `audit_log`: actor (`admin:<username of the Basic login>`; the login is still one shared account, so this names the username, not the person), action (`DISPUTE_RESOLVED`, `REPLY_APPROVED`, `REPLY_REJECTED`, `HELD_FINDINGS_RELEASED`, `SOURCE_PURGED`), the object, the states and the reason. The action routes answer `audited: true` when the row was written; if it could not be, the action still happened, `audited` is `false` and the log says why. `GET /api/admin/audit` reads the ledger (newest first, 1 to 200 rows, filters `action` and `objectType`).

## What the builder did and how it was tested

Built: `backend/engine/adminAudit.js` (the ledger, the actor, the read route), calls in `server.js` after each of the five actions, an OpenAPI entry. Tested by the builder: 9 unit checks (`test/adminaudit.test.js`), 21 server checks through the real route handlers (`test/harness/audit.test.js`), the whole `npm test`, and a run against a real Postgres 16 with a real server: four actions written as four rows, actor `admin:maya`, UUID ids stored as object ids and a host stored as the reason, the read route and a wrong password (401). Not tested by the builder: the held-findings release with a real held report (it needs a finished report), a failing ledger write, and the limit and filter edge cases on the real database.

## Setup

```
git clone https://github.com/motiongriddigital/ShelterKart-BE.git sk-be12 && cd sk-be12
git checkout 01d7fe5 && cd backend && npm ci && cd ..
docker run -d --name sk-qa-pg12 -e POSTGRES_PASSWORD=pw -e POSTGRES_DB=sk -p 5488:5432 postgres:16
export DATABASE_URL=postgres://postgres:pw@127.0.0.1:5488/sk
node tools/migrate.js
cd backend
NODE_ENV=development PORT=4023 ADMIN_USERNAME=maya ADMIN_PASSWORD=qa-pass-123 ACCESS_TOKEN_SECRET=x QUOTE_SECRET=x PAYMENT_WEBHOOK_SECRET=x LIVE_JOBS_DIR=/tmp/sk-qa12-jobs node server.js > /tmp/sk-qa12.log 2>&1 &
```

Use bash. `B=http://127.0.0.1:4023`, admin login `-u maya:qa-pass-123`.

## Checks

| # | Do this | Expect |
| --- | --- | --- |
| A1 | in `backend`: `node test/adminaudit.test.js` | ends `all 9 passing` |
| A2 | `node -r ./test/harness/stub-loader.js test/harness/audit.test.js` | ends `all passing` |
| A3 | `npm test` (needs Playwright and python3; mark BLOCKED with the reason if missing) | exit code 0 |
| B1 | `GET $B/api/admin/audit` with no login and with a wrong password | `401` both |
| B2 | with the login, on the empty database | `200`, `rows` `[]` |
| C1 | `curl -s -X POST -u maya:qa-pass-123 -H 'content-type: application/json' -d '{}' $B/api/admin/disputes/5f0c1c1e-8a3b-4c52-9d3a-1b2c3d4e5f60/resolve` | `{"ok":true,"audited":true}` |
| C2 | the same for `$B/api/admin/responses/5f0c1c1e-8a3b-4c52-9d3a-1b2c3d4e5f60/approve` and `.../responses/6f0c1c1e-8a3b-4c52-9d3a-1b2c3d4e5f61/reject` | `audited` true for both |
| C3 | `curl -s -X POST -u maya:qa-pass-123 -H 'content-type: application/json' -d '{"host":"bad.example.test"}' $B/api/admin/purge` | `ok` true, `audited` true |
| C4 | `GET $B/api/admin/audit` | four rows, newest first (`SOURCE_PURGED`, `REPLY_REJECTED`, `REPLY_APPROVED`, `DISPUTE_RESOLVED`); each `actor` is `admin:maya`; the dispute and the two replies have the UUID as `objectId`; the purge has `objectId` null and `reason` `host bad.example.test` |
| C5 | `docker exec sk-qa-pg12 psql -U postgres -d sk -c "select id, actor, action, object_type, object_id, reason from audit_log order by id"` | the same four rows in the table |
| C6 | Search the body and the table for the password `qa-pass-123` and for the `Authorization` header value | not present |
| D1 | `?action=REPLY_APPROVED`, `?objectType=developer_reply`, `?objectType=nothing` | one row, two rows, no rows |
| D2 | `?limit=2`, `?limit=1`, `?limit=200` | `200` with 2, 1 and at most 200 rows |
| D3 | `?limit=0`, `-1`, `201`, `abc`, `1.5`, `1e2` | `400` with `code` `invalid`; never `500` |
| E1 | Malformed and unknown ids: POST `.../disputes/abc/resolve`, `.../responses/abc/approve`, `.../held/SK-ABCDEF123456/approve`, `.../held/abc/approve`, and `purge` with `{}` | `400`, `400`, `404`, `400`, `400`; the table has no new row from any of them |
| E2 | The same action routes with no login | `401`; no new row |
| E3 | A purge with a long url containing a query string with a made-up e-mail address: `-d '{"url":"https://x.example.test/a?mail=someone@example.com"}'` | `200`; look at the `reason` stored: report whether the address is kept (it is stored as given, clipped to 300 characters). Say if you think that is acceptable. |
| F1 | Break the ledger: `docker exec sk-qa-pg12 psql -U postgres -d sk -c "alter table audit_log rename to al_x"`, then resolve a dispute (C1 again), then `grep -c "\[audit\]" /tmp/sk-qa12.log` | the action answers `200` with `audited` **false**; the log has `[audit] could not record DISPUTE_RESOLVED`; the server is still up |
| F2 | Rename it back, resolve again | `audited` true; the new row is there; the row from F1 is not (it was never written) |
| G1 | The ledger is append-only by convention: `grep -n "audit_log" backend/*.js backend/engine/*.js \| grep -i "update\|delete"` | no UPDATE or DELETE on `audit_log` anywhere in the code; say if any exists |
| G2 | `POST`, `PUT`, `DELETE` on `$B/api/admin/audit` | `404` (there is no way to write or erase through the API) |

## Look hardest at

- An action that happened without a row and said `audited: true` (E1, F1).
- A row for an action that was refused (E1, E2).
- Personal data or secrets in `reason` or `after` (C6, E3).
- The honest limit: the actor is a username on a shared login, so the ledger cannot tell two people apart. Say if the response text or the docs suggest otherwise.

## Teardown

Stop the server; `rm -rf /tmp/sk-qa12-jobs`; `docker rm -f sk-qa-pg12`.

## Report

Write `qa/OUTBOX/QA-012-admin-audit-ledger.md` from `qa/RESULT-TEMPLATE.md`, then commit and push as in `qa/README.md`.