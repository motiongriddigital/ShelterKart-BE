---
id: QA-012-admin-audit-ledger
status: pass
tested_sha: 01d7fe5
machine: Windows 11, node v24.20.0, Git Bash, native PostgreSQL 16.15 on 127.0.0.1:5432 (no Docker daemon)
finished: 2026-11-04
---

# Result for QA-012-admin-audit-ledger

## Summary

Every check in the prompt behaves as expected: the five actions write one row each under `admin:maya`, refused requests write nothing, the read route filters and validates, a missing ledger leaves the action done with `audited:false` and the server up. Three things to note for the builder: the ledger accepts actions on objects that do not exist, it stores a pasted e-mail address from a purge url, and nothing in the database stops an UPDATE or DELETE.

## Checks

| # | Result | Evidence |
| --- | --- | --- |
| A1 | PASS | `all 9 passing` |
| A2 | PASS | `all passing` |
| A3 | PASS | `npm test` exit 0 (run with Git Bash as npm's script shell, to be consistent with QA-011; Chromium installed, python3 shim) |
| B1 | PASS | no login `401`, wrong password `401` |
| B2 | PASS | `{"ok":true,"rows":[]}` |
| C1 | PASS | `{"ok":true,"audited":true}` |
| C2 | PASS | approve and reject: `{"ok":true,"audited":true}` each |
| C3 | PASS | `{"ok":true,"purged":0,"purgedFromStorage":0,"audited":true}` |
| C4 | PASS | four rows newest first: `SOURCE_PURGED` (objectId null, reason `host bad.example.test`), `REPLY_REJECTED`, `REPLY_APPROVED`, `DISPUTE_RESOLVED`; `actor` `admin:maya`; the UUIDs are the objectIds |
| C5 | PASS | the same four rows in `audit_log` (ids 1 to 4) |
| C6 | PASS | `qa-pass-123` and the base64 of the login: 0 matches in the route body and in the whole table |
| D1 | PASS | `action=REPLY_APPROVED` 1 row; `objectType=developer_reply` 2 rows; `objectType=nothing` 0 |
| D2 | PASS | `limit=2` 2 rows, `limit=1` 1 row, `limit=200` 4 rows (all there are) |
| D3 | PASS | `0`, `-1`, `201`, `abc`, `1.5`, `1e2`: `400` `"code":"invalid"` each |
| E1 | PASS | `disputes/abc/resolve` 400, `responses/abc/approve` 400, `held/SK-ABCDEF123456/approve` 404, `held/abc/approve` 400, `purge` with `{}` 400; rows 4 before and 4 after |
| E2 | PASS | all five routes without login: `401`; rows 4 before and after |
| E3 | PASS (note) | `-d '{"url":"https://x.example.test/a?mail=someone@example.com"}'` gave `200 audited:true` and the stored reason is `url https://x.example.test/a?mail=someone@example.com`: the address is kept as given. Not acceptable in my view: an append-only table cannot honour an erasure request, so e-mail addresses (and similar query-string data) should be stripped from `reason` before the row is written. |
| F1 | PASS | `audit_log` renamed: resolving a dispute answered `{"ok":true,"audited":false} [200]`; log has exactly one line `[audit] could not record DISPUTE_RESOLVED: relation "audit_log" does not exist`; `/api/health` 200 |
| F2 | PASS | renamed back, resolve again: `audited:true`; rows 5 before F1 and 6 after (only the F2 row, with its own id `...e5f63`; the F1 row was never written) |
| G1 | PASS | no UPDATE or DELETE on `audit_log` anywhere in `backend/*.js`, `backend/engine/*.js` or `backend/accounts/*.js`. Also no trigger, rule or REVOKE in the `.sql` files, so the table is append-only by convention only. |
| G2 | PASS | `POST`, `PUT`, `DELETE` on `/api/admin/audit`: `404` each |

## Anything else you noticed

- Resolving a dispute with a made-up id (`5f0c1c1e-...5e5f60`, no such dispute in the database) answers `{"ok":true,"audited":true}` and writes a `DISPUTE_RESOLVED` row; the same for approving and rejecting a reply that does not exist. The row says an action happened on an object that was never there. Look hardest: "a row for an action that did not happen".
- The documentation says the actor is `admin:<username>`; nothing in the response suggested it identifies a person.
- The admin limiter counts refused requests (20 per 15 minutes per address); I used `TRUST_PROXY=1` with a different `X-Forwarded-For` per call to avoid being locked out by the 4xx checks.

## Environment problems

- No Docker daemon: native PostgreSQL 16.15, database `sk_qa012` (dropped). 127.0.0.1 instead of localhost; jobs folder in the Windows temp folder.
