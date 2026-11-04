---
id: QA-007-engine-history-costs
title: AI engine usage kept per day, history and costs routes
repo: ShelterKart-BE
branch: feature/admin-engines
sha: 4ac4f0b
created: 2026-11-04
---

# QA-007: AI engine history and costs (S3)

You are the QA agent. Your job is to verify, not to build. Read `qa/README.md` first and follow its rules.

## What is under test

ShelterKart-BE, branch `feature/admin-engines`, commit in the header (stacked on `feature/admin-jobs`). Until now the AI engine's usage counters lived in memory and reset at every restart. Now the meter feeds a history: one row per UTC day, engine and role, in the new table `engine_usage_daily` (the sixteenth migration): calls, failures, rescues (a call that succeeded after another engine failed), tokens, searches, cost in US dollars, total time and a latency histogram. Counts are held for 3 seconds and written together, and also written on SIGTERM and SIGINT. Two routes read it: `GET /api/admin/engines/history?days=` (1 to 90, default 7) and `GET /api/admin/engines/costs?days=` (paid reports with their AI cost and what buyers paid, 1 to 90, default 30). `p50Ms` and `p95Ms` are the upper bound of the histogram bucket the percentile falls in (bounds 100, 250, 500, 1000, 2000, 4000, 8000, 16000, 32000, 64000 ms; `120000` means slower than 64 seconds).

## What the builder did and how it was tested

Built: `backend/engines/history.js` (counting, batching, the database write, a failing write is kept and retried), a hook in `backend/engines/meter.js`, `backend/engine/enginesAdmin.js` (the two routes), `backend/engine_usage.sql`, and a clean-stop flush in `server.js`. Tested by the builder: 20 unit checks (`test/enginehistory.test.js`: counting, invariants, UTC midnight, the histogram, a failing database, the meter hook, cost rows), 21 server checks through the real route handlers (`test/harness/enginehistory.test.js`), and the whole `npm test` (exit 0). The builder also ran it against a real Postgres 16: the migration twice; three writers at once added up to 47 calls in one row with the histogram summed correctly; the history survived a restart; a SIGTERM written 2 calls that were still waiting for the timer; the costs route priced a report from its paid purchase and ignored a refunded one. The costs route first looked for purchases with status `active`, which the payment code never writes; it is fixed in `4ac4f0b` and was re-run with `paid` rows. Not tested by the builder: real AI calls (no AI key was used; the meter was fed directly), and a table that disappears while the server runs.

## Setup

```
git clone https://github.com/motiongriddigital/ShelterKart-BE.git sk-under-test7 && cd sk-under-test7
git checkout <sha from the header> && cd backend && npm ci && cd ..
docker run -d --name sk-qa-pg7 -e POSTGRES_PASSWORD=pw -e POSTGRES_DB=sk -p 5493:5432 postgres:16
export DATABASE_URL=postgres://postgres:pw@localhost:5493/sk
node tools/migrate.js
```

No real AI provider is used and no money is spent: the engines are fed through the meter by two small scripts. Save this as `/tmp/hist-qa.js` (it plays three server instances writing at once, as after restarts):

```
const root = process.cwd();
const { Pool } = require('pg');
const { createHistory } = require(root + '/engines/history');
(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const ev = (o = {}) => ({ engine: 'anthropic', role: 'research', ok: true, tokensIn: 100, tokensOut: 50, searches: 1, ms: 800, costUsd: 0.01, ...o });
  const a = createHistory({ pool, flushMs: 0 });
  for (let i = 0; i < 5; i++) a.record(ev());
  a.record({ engine: 'anthropic', role: 'research', ok: false, ms: 300 });
  a.record(ev({ rescued: true, ms: 5000 }));
  await a.flush();
  const b = createHistory({ pool, flushMs: 0 }), c = createHistory({ pool, flushMs: 0 });
  for (let i = 0; i < 20; i++) { b.record(ev()); c.record(ev()); }
  await Promise.all([b.flush(), c.flush()]);
  console.log(JSON.stringify(await createHistory({ pool, flushMs: 0 }).rows(1)));
  console.log(JSON.stringify((await pool.query('select calls, failures, rescues, cost_usd, lat from engine_usage_daily')).rows));
  await pool.end();
})();
```

And this as `/tmp/poke.js`; when the server is started with `NODE_OPTIONS="--require /tmp/poke.js"` it records two calls through the meter three seconds after start:

```
setTimeout(() => {
  const m = require(process.cwd() + '/engines').meter;
  m.ok('openai', 'read', { usage: { input: 7, output: 3 } }, 150, false, 0.003);
  m.ok('openai', 'read', { usage: { input: 7, output: 3 } }, 150, false, 0.003);
  console.log('poked');
}, 3000);
```

The server, always started in `backend` (one variant at a time, port 4017), `B=http://localhost:4017`. In zsh pass `-u qa:qa-pass-123` literally instead of through a variable:

```
NODE_ENV=development PORT=4017 ADMIN_USERNAME=qa ADMIN_PASSWORD=qa-pass-123 ACCESS_TOKEN_SECRET=x QUOTE_SECRET=x PAYMENT_WEBHOOK_SECRET=x LIVE_JOBS_DIR=/tmp/sk-qa7-jobs node server.js > /tmp/sk-qa7-server.log 2>&1 &
```

## Checks

| # | Do this | Expect |
| --- | --- | --- |
| A1 | in `backend`: `node test/enginehistory.test.js` | ends `all 20 passing` |
| A2 | `node -r ./test/harness/stub-loader.js test/harness/enginehistory.test.js` | ends `all passing` |
| A3 | `npm test` (needs Playwright and python3; mark BLOCKED with the reason if missing) | exit code 0 |
| B1 | `node tools/migrate.js` again, then `docker exec sk-qa-pg7 psql -U postgres -d sk -c "\d engine_usage_daily"` | `0 applied, 16 already applied`; primary key `(day, engine, role)`; `lat` is `integer[]` with 11 zeros as default |
| C1 | Start the server (no poke). Both routes without login, then with | `401`, then `200` |
| C2 | Empty database, both routes with login | history: `days` 7, `rows` `[]`, `totals` all 0, `byEngine` `[]`. costs: `days` 30, `reports` `[]`, `totals` `{reports: 0, costUsd: 0, avgCostUsd: 0, priced: 0, priceUsd: 0}`. No `null` or `NaN` anywhere. |
| D1 | In `backend`: `NODE_PATH=$PWD/node_modules node /tmp/hist-qa.js` | first line: one row with `calls` 47, `failures` 1, `rescues` 1, `tokensIn` 4600, `tokensOut` 2300, `searches` 46, `costUsd` 0.46, `costedCalls` 46, `avgMs` 879, `p50Ms` 1000, `p95Ms` 1000. Second line: `lat` `[0,0,1,45,0,0,1,0,0,0,0]`. This is three writers at once: if any count is short or doubled, FAIL and paste both lines. |
| D2 | `docker exec sk-qa-pg7 psql -U postgres -d sk -tc "select day, engine, role, count(*) from engine_usage_daily group by 1,2,3 having count(*) > 1"` | no rows (never two rows for one day, engine and role) |
| D3 | `GET $B/api/admin/engines/history?days=1` | the same numbers as D1, `byEngine` has one entry, `totals.calls` 47 |
| D4 | Restart the server (`kill` it, start it again), `GET .../history?days=7` | the same numbers: the history is in the database, not in memory |
| D5 | The invariants on every row of every response | `failures <= calls`; `rescues <= calls - failures`; `p50Ms <= p95Ms`; `costUsd` is a number, not a string; the response is JSON with no `NaN` |
| E1 | Stop the server. Start it with `NODE_OPTIONS="--require /tmp/poke.js"`. Wait until the log says `poked` (about 3 seconds), then within 2 seconds `kill -TERM <pid>`. Wait 2 seconds. `docker exec sk-qa-pg7 psql -U postgres -d sk -tc "select engine, role, calls, cost_usd from engine_usage_daily order by engine"` | the process has exited; there is a row `openai | read | 2 | 0.006`. The two calls were written by the stop, not by the 3-second timer. |
| E2 | The same, but `kill -9` instead of `TERM` | the calls may be lost (they waited for the timer): report what you saw. This is the known limit: at most the last 3 seconds can be lost on a crash. |
| E3 | Start the server with the poke, wait 6 seconds, then `kill -9` | the 2 extra calls are in the table (the timer wrote them) |
| F1 | Break the table while the server runs: start with the poke, `docker exec ... psql -c "alter table engine_usage_daily rename to eud_x"`, wait 7 seconds, `grep -c "engine-history" /tmp/sk-qa7-server.log`, `curl -s -o /dev/null -w '%{http_code}' $B/api/health` | the server is still up (health `200`), the log has `[engine-history] could not save usage, will try again` (a few times, not a flood); no crash |
| F2 | Rename it back (`alter table eud_x rename to engine_usage_daily`), wait 7 seconds, query the table | the calls that waited are now written once: the `openai` row has the right count, not doubled |
| G1 | Costs: stop the server. Make two paid-report files and one paid and one refunded purchase for the first (commands below) | the files exist |
| G2 | Start the server on `LIVE_JOBS_DIR=/tmp/sk-qa7-jobs`, `GET $B/api/admin/engines/costs?days=30` | `SK-COST1`: `costUsd` 0.62, `status` `done`, `priceUsd` about 31.8 (3000 INR at the price book's rate), `costShare` about 0.0195; `SK-COST2`: `costUsd` 1.1, `priceUsd` null, `costShare` null; `totals`: `reports` 2, `costUsd` 1.72, `avgCostUsd` 0.86, `priced` 1. The refunded purchase must not count. |
| G3 | Delete the files, set `"paid": false` in one, `"updatedAt"` 40 days ago in the other, restart, call the route | the unpaid one and the old one are not listed |
| H1 | `days` on both routes: `1`, `30`, `90` | `200` |
| H2 | `days`: `0`, `-1`, `91`, `1000`, `abc`, `1.5`, `1e1`, empty on history | `400` with `code` `invalid` (empty uses the default `200`); never `500` |
| H3 | Search every response and the table for prompt text, answers, an API key, an e-mail address | none: only counts, tokens, costs and times |
| H4 | `curl -s -X POST $B/api/admin/engines/history` | `404`; the existing `GET $B/api/admin/engines` still answers `200` with its in-memory view |
| I1 | Time of the history route with 30 days of data: `insert into engine_usage_daily (day, engine, role, calls, lat) select current_date - g, 'e' || (g % 5), 'r' || (g % 4), 10, '{0,0,0,10,0,0,0,0,0,0,0}' from generate_series(0, 89) g` then time `?days=90` | `200`, well under one second; report the time and the number of rows |

The files for G1 (run in a shell where `date` works):

```
mkdir -p /tmp/sk-qa7-jobs
echo '{"ref":"SK-COST1","input":{"query":"A","location":"Mumbai","country":"IN","market":"India"},"key":null,"status":"done","paid":true,"contact":null,"costUsd":0.62,"capUsd":2,"delivered":true,"createdAt":1793800000000,"updatedAt":'$(date +%s)'000,"saved":null}' > /tmp/sk-qa7-jobs/SK-COST1.json
echo '{"ref":"SK-COST2","input":{"query":"B","location":"Dubai","country":"AE","market":"UAE"},"key":null,"status":"failed","paid":true,"contact":null,"costUsd":1.1,"capUsd":2,"delivered":true,"createdAt":1793800000000,"updatedAt":'$(date +%s)'000,"saved":null}' > /tmp/sk-qa7-jobs/SK-COST2.json
docker exec sk-qa-pg7 psql -U postgres -d sk -c "insert into report_purchases (report_ref, status, amount, currency) values ('SK-COST1','paid',3000,'INR'),('SK-COST1','refunded',3000,'INR')"
```

## Look hardest at

- D1 and D4: counts lost, doubled, or reset by a restart. It is the point of the slice.
- F1 and F2: the counters must never take the server down, and must not double count when the database comes back.
- Cost in the wrong unit: `costUsd` is dollars, `priceUsd` is the buyers' payment converted to dollars.
- Anything that stores or returns text from a prompt or an answer.

## Teardown

Stop the server; `rm -rf /tmp/sk-qa7-jobs /tmp/hist-qa.js /tmp/poke.js`; `docker rm -f sk-qa-pg7`.

## Report

Write `qa/OUTBOX/QA-007-engine-history-costs.md` from `qa/RESULT-TEMPLATE.md`, then commit and push as in `qa/README.md`.