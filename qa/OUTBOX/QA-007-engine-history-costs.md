---
id: QA-007-engine-history-costs
status: fail
tested_sha: 4ac4f0b
machine: Windows 11, node v24.20.0, Git Bash, native PostgreSQL 16.15 on 127.0.0.1:5432 (no Docker daemon)
finished: 2026-11-04
---

# Result for QA-007-engine-history-costs

## Summary

Counting, the three-writer total, restart survival, the cost routes and day validation all work. One check fails: after the table comes back (F2), the calls that were waiting are not written until some later call arrives; while the server is idle the "will try again" never happens. E1 (graceful flush on SIGTERM) cannot be tested on Windows.

## Checks

| # | Result | Evidence |
| --- | --- | --- |
| A1 | PASS | `all 20 passing` |
| A2 | PASS | `all passing` |
| A3 | PASS | `npm test` exit 0 |
| B1 | PASS | `0 applied, 16 already applied.`; `engine_usage_daily_pkey PRIMARY KEY, btree (day, engine, role)`; `lat integer[] not null default '{0,0,0,0,0,0,0,0,0,0,0}'` |
| C1 | PASS | both routes `401`, then `200` |
| C2 | PASS | history `{"days":7,"totals":{... all 0},"byEngine":[],"rows":[]}`; costs `{"days":30,"reports":[],"totals":{"reports":0,"costUsd":0,"avgCostUsd":0,"priced":0,"priceUsd":0}}`; no null or NaN |
| D1 | PASS | line 1: `{"day":"2026-11-04","engine":"anthropic","role":"research","calls":47,"failures":1,"rescues":1,"tokensIn":4600,"tokensOut":2300,"searches":46,"costUsd":0.46,"costedCalls":46,"avgMs":879,"p50Ms":1000,"p95Ms":1000}`; line 2: `[{"calls":47,"failures":1,"rescues":1,"cost_usd":"0.460000","lat":[0,0,1,45,0,0,1,0,0,0,0]}]` |
| D2 | PASS | no rows |
| D3 | PASS | `totals.calls` 47, same numbers as D1, one `byEngine` entry |
| D4 | PASS | after restart: `totals` calls 47, failures 1, rescues 1, costUsd 0.46, 1 row |
| D5 | PASS | 0 violations (`failures<=calls`, `rescues<=calls-failures`, `p50Ms<=p95Ms`, costUsd a number); no NaN |
| E1 | BLOCKED (Windows cannot send SIGTERM to node) | server started with the poke; `poked` logged; `kill -TERM <pid>` returned 0 and the process was gone (port freed), but the table has only `anthropic | research | 47 | 0.460000`; no `openai` row. Under Windows `kill` ends node hard, so this says nothing about the clean-stop flush. |
| E2 | PASS (reported) | `kill -9` right after `poked`: no `openai` row (the 2 calls were lost), the known last-3-seconds limit |
| E3 | PASS | poke, wait 7 s, `kill -9`: `openai | read | 2 | 0.006000` |
| F1 | PASS | table renamed while running: `/api/health` 200; log has exactly one line `[engine-history] could not save usage, will try again: relation "engine_usage_daily" does not exist` over 30 s (no flood); no crash |
| F2 | FAIL | table renamed back, polled every 5 s for 40 s while idle: `openai` calls stayed 0 and the log had no further line; nothing was retried. With a later call at 25 s (second poke script, table restored at 14 s) the `openai` total became 3 (2 waiting + 1 new, cost 0.009, not doubled). So the held counts are kept and not doubled, but they are written only when new activity arrives, not within 7 seconds as the prompt expects. A server that goes quiet keeps them in memory only. |
| G1 | PASS | two job files and a paid + a refunded purchase for SK-COST1 created (`INSERT 0 2`) |
| G2 | PASS | `SK-COST1` `costUsd":0.62,"status":"done","priceUsd":31.7797,"costShare":0.0195`; `SK-COST2` `costUsd":1.1,"priceUsd":null,"costShare":null`; totals `{"reports":2,"costUsd":1.72,"avgCostUsd":0.86,"priced":1,"priceUsd":31.7797}` (refunded purchase not counted) |
| G3 | PASS | one file `paid:false`, the other `updatedAt` 40 days old: `"reports":[]`, totals 0 |
| H1 | PASS | days 1, 30, 90 on both routes: `200` |
| H2 | PASS | `0`, `-1`, `91`, `1000`, `abc`, `1.5`, `1e1`: `400 "code":"invalid"` on both routes; empty `days=` `200`; no `500` |
| H3 | PASS | no e-mail, key, prompt or answer in either response; the table has only day/engine/role as text columns |
| H4 | PASS | POST `404`; `GET /api/admin/engines` `200` |
| I1 | PASS | 90 days of data (92 rows): `?days=90` `200` in 0.017 s, then 0.004 s and 0.004 s |

## Anything else you noticed

- Admin limiter (20 per 15 minutes per address): I used `TRUST_PROXY=1` with a different `X-Forwarded-For` for each call.
- The retry gap in F2 is a design question: "will try again" appears in the message but no timer does it.

## Environment problems

- No Docker daemon: native PostgreSQL 16.15, fresh database `sk_qa007` (dropped). No SIGTERM on Windows (E1). Stub scripts and logs under the Windows temp folder (`C:/...` paths); 127.0.0.1 instead of localhost.
