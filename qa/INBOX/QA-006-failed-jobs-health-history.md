---
id: QA-006-failed-jobs-health-history
title: Failed jobs list and retry, health history per register
repo: ShelterKart-BE
branch: feature/admin-jobs
sha: 8e7d4e1
created: 2026-11-04
---

# QA-006: failed jobs, retry and register health history (S2b)

You are the QA agent. Your job is to verify, not to build. Read `qa/README.md` first and follow its rules.

## What is under test

ShelterKart-BE, branch `feature/admin-jobs`, commit in the header (stacked on `feature/admin-geo`). It adds the fifteenth migration (`source_health_history`) and three admin routes:

- `GET /api/admin/jobs/failed`: paid reports that stopped early (kind `report`, id `report:<ref>`) and deliveries that gave up after every automatic retry (kind `delivery`, id `delivery:<ref>:<channel>`, masked address). Reasons are scrubbed of e-mail and IP addresses.
- `POST /api/admin/jobs/:id/retry`: runs a failed job again, once. A report resumes from its saved state (nothing is researched or charged twice); a delivery makes one more attempt. A job that is not failed now is refused with `409`.
- `GET /api/admin/health/registers/history?days=`: one series per market that has a live register (10 of the 36), every nightly check in the last N days (1 to 90, default 30), oldest first, with `checks`, `healthy`, `uptime` and `latest`. Kept 90 days.

Known limits, stated by the builder: failed deliveries live in memory, so a restart forgets them (failed reports are saved with the investigation); a failed delivery cannot be produced through HTTP without finishing a real paid report, so that path is covered by unit tests only (A1). Say so in your result rather than skipping it silently.

## What the builder did and how it was tested

Built: `backend/engine/jobsAdmin.js` (the failed list, the retry, the register series and the three routes), a failed-delivery registry with a one-shot manual retry in `engine/delivery.js`, the failure reason kept on a paid report, `retryFailedReport` in `server.js`, `backend/health_history.sql`, the history rows written by `saveHealth`, and OpenAPI entries. Tested by the builder: 13 unit checks (`test/jobsadmin.test.js`: delivery gave up, retry once, never twice, the list, id check, series), 19 server checks (`test/harness/jobs.test.js`), the whole `npm test` (exit 0), and a run against a real Postgres 16 and a real server: the migration twice, a seeded failed paid report listed with the e-mail and IP scrubbed from its reason, retried to `202`, failing again with a new reason, three failing retries sending no mail through a mail stub, junk and unknown ids refused, history written, read in order with uptime, and rows older than 90 days removed. That run found one bug, fixed before this prompt: a failing retry sent the buyer the partial report again. Not tested by the builder: a failed delivery through HTTP (it needs a finished paid report; unit tests cover it), the missing-table case, and 300 failed jobs.

## Setup

```
git clone https://github.com/motiongriddigital/ShelterKart-BE.git sk-under-test6 && cd sk-under-test6
git checkout <sha from the header> && cd backend && npm ci && cd ..
docker run -d --name sk-qa-pg6 -e POSTGRES_PASSWORD=pw -e POSTGRES_DB=sk -p 5494:5432 postgres:16
export DATABASE_URL=postgres://postgres:pw@localhost:5494/sk
node tools/migrate.js
```

Save this as `/tmp/fetch-stub.js` (it stands in for the e-mail provider, no mail leaves the machine; `touch /tmp/sk-mail-fail` makes it fail, `rm` makes it succeed):

```
const real = globalThis.fetch, fs = require('fs');
globalThis.fetch = async (u, o) => {
  if (String(u).startsWith('https://api.resend.com/')) {
    if (fs.existsSync('/tmp/sk-mail-fail')) return { ok: false, status: 500, json: async () => ({}) };
    fs.appendFileSync('/tmp/sk-mails.log', JSON.stringify(JSON.parse(o.body).to) + '\n');
    return { ok: true, status: 200, json: async () => ({ id: 'em_1' }) };
  }
  return real(u, o);
};
```

Seed one paid report that failed (a saved investigation file is exactly what a real failure leaves behind), then start the server in `backend`:

```
mkdir -p /tmp/sk-qa6-jobs && cat > /tmp/sk-qa6-jobs/SK-RETRY1.json <<'J'
{"ref":"SK-RETRY1","input":{"query":"Hubtown Celeste","location":"Mumbai","country":"IN","market":"India"},"key":null,"status":"failed","paid":true,"contact":{"email":"buyer@example.com"},"costUsd":0.4,"capUsd":5,"delivered":true,"createdAt":1793800000000,"failedAt":1793800100000,"failError":"the engine refused for someone@example.com at 10.1.2.3","updatedAt":1793800100000,"saved":null}
J
rm -f /tmp/sk-mails.log /tmp/sk-mail-fail
NODE_OPTIONS="--require /tmp/fetch-stub.js" NODE_ENV=development PORT=4016 ADMIN_USERNAME=qa ADMIN_PASSWORD=qa-pass-123 ACCESS_TOKEN_SECRET=x QUOTE_SECRET=x PAYMENT_WEBHOOK_SECRET=x RESEND_API_KEY=re_x DELIVERY_FROM='SK <a@b.test>' PUBLIC_BASE_URL=https://sk.test LIVE_JOBS_DIR=/tmp/sk-qa6-jobs node server.js > /tmp/sk-qa6-server.log 2>&1 &
```

`B=http://localhost:4016`, `ADM="-u qa:qa-pass-123"` (in zsh, pass `-u qa:qa-pass-123` literally instead of through a variable). No AI key is set on purpose: a retried report fails again at once with `no AI engine is set up and allowed for research`. That is expected.

## Checks

| # | Do this | Expect |
| --- | --- | --- |
| A1 | in `backend`: `node test/jobsadmin.test.js` | ends `all 13 passing` (this is where the delivery path is covered) |
| A2 | `node -r ./test/harness/stub-loader.js test/harness/jobs.test.js` | ends `all passing` |
| A3 | `npm test` (needs Playwright and python3; mark BLOCKED with the reason if missing) | exit code 0 |
| B1 | `node tools/migrate.js` a second time, then `docker exec sk-qa-pg6 psql -U postgres -d sk -c "\d source_health_history"` | `0 applied, 15 already applied`; the table has `market`, `state`, `reason`, `detail`, `checked_at` and an index on `(market, checked_at DESC)` |
| C1 | All three routes (and the retry as POST) without login | `401` |
| C2 | `GET $B/api/admin/jobs/failed` with login | `200`, `total` 1, one job: `id` `report:SK-RETRY1`, `kind` `report`, `reason` `the engine refused for [email] at [ip]` (the address and IP are scrubbed), `retryable` true |
| C3 | Search the list body for `someone@example.com`, `10.1.2.3`, `buyer@example.com` | none of them |
| C4 | `POST $B/api/admin/jobs/report:SK-RETRY1/retry` | `202`. Wait 3 seconds, list again: still one job, but `failedAt` is now (not the 2026 seed time) and `reason` is `no AI engine is set up and allowed for research` |
| C5 | Retry it three more times, 2 seconds apart; then `cat /tmp/sk-mails.log` | each `202`; the mail log has NO lines. A retry that fails again must never e-mail the partial report a second time (the buyer's contact is on the job, so a bug here would send mail). |
| C6 | Retry ids that are not valid: `abc`, `report:`, `report:%2E%2E%2Fx`, `report:SK-RETRY1:email`, `delivery:SK-1`, `job:SK-1` | `400` each, body `code` `invalid` |
| C7 | `report:SK-NOPE` | `404`; `delivery:SK-NOPE:email` | `409` (not failed) |
| C8 | `GET $B/api/admin/jobs/SK-RETRY1/retry` and `POST $B/api/admin/jobs/report:SK-RETRY1/retry` without login | `404` and `401` |
| C9 | `select count(*) from report_purchases` and the refunds table before and after C4 and C5 | unchanged: a retry never charges or refunds |
| C10 | Two retries at once: `(curl -s -o /dev/null -w '%{http_code}\n' -X POST ... & curl -s -o /dev/null -w '%{http_code}\n' -X POST ... & wait)` | the server runs a retry to its end before it takes the next request when the failure is instant (as here), so both may be `202`: report what you saw and look at `/tmp/sk-qa6-server.log`; each `202` must match exactly one `completion failed` line. A `202` for a job that was NOT failed when it arrived would be a failure. (The unit test A1 covers the overlapping case with a slow delivery.) |
| C11 | Stop the server, set `"status":"done"` in `/tmp/sk-qa6-jobs/SK-RETRY1.json`, start it again, retry it | `409` `not_failed`; and set `"paid":false` with status `failed`: not listed, retry `409` |
| D1 | `GET $B/api/admin/health/registers/history` on a fresh database | `200`, `days` 30, `registers` has 10 entries (the markets that have a live register, from `backend/engine/markets.js`), each `checks` 0, `uptime` null, `points` [] |
| D2 | Add checks with this script, run in `backend`: `node -e "const {Pool}=require('pg');const {makePgStore}=require('./engine/persistence');(async()=>{const p=new Pool({connectionString:process.env.DATABASE_URL});const s=makePgStore(p);await s.saveHealth('in',{state:'healthy',everHealthy:true});await s.saveHealth('in',{state:'down',reason:'failing',consecutiveFailures:1,everHealthy:true,detail:'timeout'});await s.saveHealth('sg',{state:'healthy',everHealthy:true});await p.end()})()"` then call the route with `?days=7` | `in`: `checks` 2, `healthy` 1, `uptime` 0.5, `latest` `down`, points in time order `healthy` then `down`; `sg`: `checks` 1, `uptime` 1; no other market has checks |
| D3 | `?days=1`, `?days=90` | `200` |
| D4 | `?days=0`, `-5`, `91`, `1000`, `abc`, `1.5`, `1e3` | `400` with `code` `invalid` each; never `500` |
| D5 | Old rows: `update source_health_history set checked_at = now() - interval '100 days' where market='sg'`, then run the script of D2 again and `select count(*) from source_health_history where market='sg' and checked_at < now() - interval '90 days'` | `0` (rows older than 90 days are removed when a new check is written) |
| D6 | Restart the server, call the route again | the same checks (stored in the database, not memory) |
| D7 | Search both routes' bodies for personal data, stack traces or SQL text | none |
| E1 | Failed-list size: put 300 files like the seed (different `ref`s, `status` `failed`, `paid` true) in `/tmp/sk-qa6-jobs`, restart, call the list with and without `?limit=10` and `?limit=0`, `?limit=9999` | default returns at most 200 jobs (`total` 300); `limit=10` returns 10; `0` and `9999` do not fail (clamped); the response is fast (report the time) |

## Look hardest at

- C5: a failing retry sending the buyer another e-mail. The builder fixed this once already during its own real run; confirm it stays fixed.
- C10 and C11: a retry reaching a job that is not failed (done, unpaid, running).
- Any place a buyer's address or an IP address appears in a response.
- What happens at start if `source_health_history` does not exist yet (run the new code against a database where `migrate.js` has not been run): the nightly check must not crash the server; report what you saw.

## Teardown

Stop the server; `rm -rf /tmp/sk-qa6-jobs /tmp/sk-mails.log /tmp/sk-mail-fail /tmp/fetch-stub.js`; `docker rm -f sk-qa-pg6`.

## Report

Write `qa/OUTBOX/QA-006-failed-jobs-health-history.md` from `qa/RESULT-TEMPLATE.md`, then commit and push as in `qa/README.md`.