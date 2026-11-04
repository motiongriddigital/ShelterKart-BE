---
id: QA-004-trust-proxy
status: fail
tested_sha: 9e8cf62fa7ce55d9c056aa68585a2fdca43f18dc
machine: Windows 11 Pro 10.0.22631, Git Bash, node v24.20.0, npm 11.2.0, Playwright 1.64.1 (package only, no browser installed), no Docker (not needed)
finished: 2026-11-04
---

# Result for QA-004-trust-proxy

## Summary

The TRUST_PROXY behaviour itself passed every check (B to F): by default a forged X-Forwarded-For changes nothing, and the setting, its refusals and its log lines work as described. The overall status is `fail` only because A2 (`npm test`) exits 1 on one test in `test/harness/buyer.test.js`; I did not establish whether that failure is caused by this branch.

## Checks

| # | Result | Evidence |
| --- | --- | --- |
| A1 | PASS (wording differs) | `node test/trustproxy.test.js` exit 0, 10 lines starting `  ok`, includes section "a forged header through real express". Final line is `all 10 passing`, not `all passing 10` as the prompt says. |
| A2 | FAIL | `npm test` exit 1. Only failure: `  FAIL the PDF downloads with the token (where Chromium is installed) or says how to print one`, then `1 FAILED`. Test (buyer.test.js:82) accepts 200 `%PDF` or 503; the actual status was neither (not captured). Chromium is not installed here (no `ms-playwright` folder), which may be the cause. The chain stops at that test, so every test after it in the `npm test` script did not run, including `test/trustproxy.test.js`, `accounts*.test.js` and `errorlog` harness (trustproxy.test.js was run separately in A1). I did not run the base branch to see if it fails the same way. |
| A3 | PASS | `server.js:26: app.set('trust proxy', TRUST.setting);` one line, no literal `1` or `true`. |
| B1 | PASS | 20x `401`, then `429` from request 21 on (30 requests). |
| B2 | PASS | Identical pattern to B1: 20x `401`, then `429` x10, with a different forged header each time. |
| B3 | PASS | Correct login right after B2: `429`. |
| B4 | PASS | No line starting `[proxy]` (count 0). See note on the express-rate-limit ValidationError below. |
| C1 | PASS | `TRUST_PROXY=1`, B2: all thirty `401`. Matches the documented behaviour (each forged address counted separately). |
| C2 | PASS | `TRUST_PROXY=1`, no header: 20x `401` then `429`. |
| D1 | PASS | `[proxy] TRUST_PROXY=true would trust every hop and let any client choose its own address; trusting no proxy. Use a hop count or the proxy addresses.` |
| D2 | PASS | B2 pattern: 20x `401` then `429`. |
| E1 | PASS | `[proxy] TRUST_PROXY has an entry that is not a hop count, a named range or an address: banana; trusting no proxy.` Server started; B2: `401` x20 then `429`. |
| E2 | PASS | `[proxy] TRUST_PROXY=99 is out of range (1 to 10); trusting no proxy.` B2: `401` x20 then `429`. |
| E3 | PASS (after a note) | `TRUST_PROXY=127.0.0.1` with `curl http://localhost:4014` gave `401` x20 then `429`, because on this machine `localhost` resolves to `::1`, which is not the listed `127.0.0.1`. Retried over `http://127.0.0.1:4014`: all thirty `401` (header believed). Over `http://[::1]:4014` with `127.0.0.1` listed: `401` then `429`; with `TRUST_PROXY=loopback`: all `401`. `TRUST_PROXY=10.0.0.0/8`, B2: `401` x20 then `429` (header ignored). |
| E4 | PASS | `NODE_ENV=production ALLOWED_ORIGINS=https://x.test`, TRUST_PROXY unset, started without other changes. Log: `[proxy] TRUST_PROXY is not set: every client is counted by the address that connects to this server. Behind a load balancer that is one address for everyone; set the number of proxies in front, or their addresses.` |
| F1 | PASS | `/api/health` returns `{"ok":true,"service":"shelterkart-api","time":...}` `[200]` both with and without `X-Forwarded-For: 1.2.3.4`. |
| F2 | PASS | `git diff --stat origin/feature/admin-error-log origin/fix/trust-proxy` lists exactly: backend/.env.example, engine/trustproxy.js, package.json, server.js, test/trustproxy.test.js, docs/DEPLOYMENT.md, docs/api/README.md (83 insertions, 3 deletions). |

## Anything else you noticed

- With `TRUST_PROXY` unset, sending a request that carries `X-Forwarded-For` makes express-rate-limit print a `ValidationError ... ERR_ERL_UNEXPECTED_X_FORWARDED_FOR` stack trace to the log (seen in `/tmp`-style log after B2; it prints for the limiter's key generator). It is not a `[proxy]` line, but it is noisy for every forged request in a default install and not mentioned in the docs. Consider setting the limiter's `validate: { xForwardedForHeader: false }` or documenting it.
- Other `req.ip` readers (not changed in this diff, so they follow the setting automatically): `accounts/admin.js:107` (self-ban check), `accounts/index.js:46,62,150,189` (sign-in log, IP hash, codes, sessions), `server.js:177` (analytics). I did not exercise these (no database).
- Operators: `TRUST_PROXY=127.0.0.1` does not trust `::1`. The `loopback` name works for both; worth a line in docs/DEPLOYMENT.md.
- The `[proxy]` messages are clear and each says what to set. The out-of-range message gives the range (1 to 10).

## Environment problems

- Playwright's browser (Chromium) is not installed on the QA machine; I did not download it. A2 may pass with it.
- `qa/README.md` is not on the commit under test; I read it from `ops/admin-plan-and-qa`.
- Servers were started from Git Bash on Windows; `/tmp` logs were written to the session temp folder instead.
