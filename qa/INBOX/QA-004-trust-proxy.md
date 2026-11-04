---
id: QA-004-trust-proxy
title: Configurable proxy trust (TRUST_PROXY), a forged X-Forwarded-For changes nothing by default
repo: ShelterKart-BE
branch: fix/trust-proxy
sha: 9e8cf62
created: 2026-11-04
---

# QA-004: TRUST_PROXY (SHEL-35)

You are the QA agent. Your job is to verify, not to build. Read `qa/README.md` first and follow its rules.

## What is under test

Repository ShelterKart-BE, branch `fix/trust-proxy`, commit as in the header. Until now the server was hard-coded to believe one proxy, so anyone who could reach the API directly could send a different `X-Forwarded-For` on every request and dodge every per-IP limit and IP ban. Now `TRUST_PROXY` decides: unset means no proxy is believed; a number means that many proxies; a list means those proxy addresses. `true` is refused. The stack under it is `feature/admin-error-log`, so the migrations are the fourteen from QA-002.

## Setup

```
git clone https://github.com/motiongriddigital/ShelterKart-BE.git sk-under-test4 && cd sk-under-test4
git checkout <sha from the header> && cd backend && npm ci && cd ..
```

No database is needed for this prompt (the limiter and the proxy setting do not touch it). Start the server in `backend` with each variant below, one at a time, always:

```
NODE_ENV=development PORT=4014 ADMIN_USERNAME=qa ADMIN_PASSWORD=qa-pass-123 ACCESS_TOKEN_SECRET=x QUOTE_SECRET=x PAYMENT_WEBHOOK_SECRET=x <variant> node server.js > /tmp/sk-qa4-<name>.log 2>&1 &
```

`B=http://localhost:4014`. Stop the server and wait for the port to free before the next variant.

## Checks

Part A: the builder's tests, run independently.

| # | Do this | Expect |
| --- | --- | --- |
| A1 | in `backend`: `node test/trustproxy.test.js` | ends `all passing 10`; ten lines starting `  ok`; includes the section "a forged header through real express" |
| A2 | `npm test` (needs Playwright and python3; mark BLOCKED with the reason if missing) | exit code 0 |
| A3 | `grep -n "trust proxy" backend/server.js` | one line, taking its value from the parsed setting. No literal `1` and no `true`. |

Part B: variant 1, `TRUST_PROXY` not set.

| # | Do this | Expect |
| --- | --- | --- |
| B1 | Send 30 wrong admin logins from one address with no header: `for i in $(seq 1 30); do curl -s -o /dev/null -w '%{http_code}\n' -u qa:wrong $B/api/admin/stats; done` | `401` repeated, then `429` appears within the first 25 requests (the security review saw 429 after 19) |
| B2 | Restart (to reset counters). Send 30 wrong logins, each with a different forged header: `for i in $(seq 1 30); do curl -s -o /dev/null -w '%{http_code}\n' -H "X-Forwarded-For: 9.9.9.$i" -u qa:wrong $B/api/admin/stats; done` | the SAME pattern as B1: `401` then `429`. If all thirty are `401`, the forged header was believed: FAIL, copy the output. |
| B3 | Right after B2, a correct login: `curl -s -o /dev/null -w '%{http_code}' -u qa:qa-pass-123 $B/api/admin/stats` | `429` while the limit window lasts (the limit is per address, not per header) |
| B4 | `cat /tmp/sk-qa4-unset.log` | no line starting `[proxy]` (not production, so no warning) |

Part C: variant 2, `TRUST_PROXY=1` (one proxy believed, the setting for a host behind one load balancer).

| # | Do this | Expect |
| --- | --- | --- |
| C1 | Restart with `TRUST_PROXY=1`. Repeat B2 | all thirty `401`, because each forged address now counts separately. This is the documented behaviour of the setting; the docs say the API must then be reachable only through the proxy. Write it as PASS if it matches, and say so in the report. |
| C2 | Repeat B1 (no header) | `401` then `429`, the header-less address is still limited |

Part D: variant 3, `TRUST_PROXY=true`.

| # | Do this | Expect |
| --- | --- | --- |
| D1 | Restart with `TRUST_PROXY=true`. `cat` the log | a line starting `[proxy]` and containing `every hop` |
| D2 | Repeat B2 | the same as B2 (`401` then `429`): a refused setting trusts no one |

Part E: other values.

| # | Do this | Expect |
| --- | --- | --- |
| E1 | `TRUST_PROXY=banana` | log line `[proxy] TRUST_PROXY has an entry that is not a hop count ... banana; trusting no proxy.`; the server still starts; B2 behaves as no proxy |
| E2 | `TRUST_PROXY=99` | a `[proxy]` line saying out of range; B2 behaves as no proxy |
| E3 | `TRUST_PROXY=127.0.0.1` (the QA machine's own address as the proxy) and repeat B2 | all `401`: a header from a listed proxy is believed. Then `TRUST_PROXY=10.0.0.0/8` and repeat B2: `401` then `429` (a header from an address that is not listed is ignored) |
| E4 | Production warning: start with `NODE_ENV=production`, `ALLOWED_ORIGINS=https://x.test`, the secrets above, `ADMIN_*`, `TRUST_PROXY` unset | a line `[proxy] TRUST_PROXY is not set` appears in the log. If production refuses to start for another reason, copy that reason, set what `backend/.env.example` marks as required, and try once more. |

Part F: the rest of the server did not change.

| # | Do this | Expect |
| --- | --- | --- |
| F1 | `curl -s $B/api/health` with and without a forged `X-Forwarded-For` | the same `200` body both times |
| F2 | `git diff --stat feature/admin-error-log fix/trust-proxy` | only `backend/server.js`, `backend/engine/trustproxy.js`, `backend/test/trustproxy.test.js`, `backend/package.json`, `backend/.env.example`, `docs/api/README.md`, `docs/DEPLOYMENT.md` |

## Look hardest at

- Any variant where a forged header lets more than the limit through when it should not (B2, D2, E1, E2, E3 second half).
- Whether anything else that reads `req.ip` changed: the sign-in log, IP bans and the admin "that would block your own address" check all use it.
- The wording of every `[proxy]` log line: is it clear to an operator what to set?

## Teardown

Stop the server. Nothing else was created.

## Report

Write `qa/OUTBOX/QA-004-trust-proxy.md` from `qa/RESULT-TEMPLATE.md`, then commit and push as in `qa/README.md`.