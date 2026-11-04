---
id: QA-013-signin-lockout
title: Sign-in codes: a stranger can no longer lock the owner out (option A)
repo: ShelterKart-BE
branch: fix/signin-lockout
sha: 0cfc7a1
created: 2026-11-04
---

# QA-013: the sign-in lockout fix

You are the QA agent. Your job is to verify, not to build. Read `qa/README.md` first and follow its rules. Terminal only, no browser.

## What is under test

ShelterKart-BE, branch `fix/signin-lockout`, commit `0cfc7a1` (stacked on `feature/admin-engines`, `4ac4f0b`). Before: anyone who typed another person's e-mail address could use up that address's 5 codes an hour and its one-a-minute cooldown, and each new code replaced the owner's open code, so the owner could not sign in. Now, on `POST /api/auth/request-code`:

- The one-a-minute cooldown and the five-an-hour cap are counted per e-mail AND per requesting address (`req.ip`), not per e-mail alone.
- A request from a different address within 60 seconds of a code that is still open gets the normal `202` reply with no `devCode` and no e-mail, and the open code is NOT replaced.
- Once 20 codes were issued for one e-mail in an hour, further requests get the same quiet `202` (no mail, open code kept) while the last code is open; when it has expired, mail is sent again. The operator is alerted once an hour per e-mail.

## What the builder did and how it was tested

Changed `backend/accounts/index.js` and `backend/accounts/store.js` (new `lastCodeState`; `lastCodeAt` and `countCodesSince` take an optional address). Three new tests in `backend/test/accounts.test.js` (34 pass, 0 fail). Full `npm test` exit 0. Run by hand against a real server in memory mode: first request `202` with `devCode`; same address again `429 cooldown`; other address `202` without `devCode`; the first code still signed in. Not tested by the builder: a real clock over the 20-an-hour path, and the operator alert reaching a real channel.

## Setup (no Docker, no database: memory mode)

```
git clone https://github.com/motiongriddigital/ShelterKart-BE.git sk-be13 && cd sk-be13
git checkout 0cfc7a1 && cd backend && npm ci
NODE_ENV=development PORT=4031 TRUST_PROXY=loopback ACCOUNTS_ENABLED=on AUTH_PEPPER=pppppppppppppppppppppppppppppppppppppppp ACCOUNTS_ALLOW_MEMORY=true ACCOUNTS_DEV_ECHO=true ACCESS_TOKEN_SECRET=x QUOTE_SECRET=x PAYMENT_WEBHOOK_SECRET=x LIVE_JOBS_DIR=/tmp/sk-qa13-jobs node server.js > /tmp/sk-qa13.log 2>&1 &
```

Use bash. `B=http://127.0.0.1:4031`. Simulate different requesters with the header `X-Forwarded-For: <address>` (believed because of `TRUST_PROXY=loopback`). Helper:
`rc(){ curl -s -w ' [%{http_code}]\n' -X POST -H 'content-type: application/json' -H "X-Forwarded-For: $2" -d "{\"email\":\"$1\"}" $B/api/auth/request-code; }`
and `vc(){ curl -s -w ' [%{http_code}]\n' -X POST -H 'content-type: application/json' -H "X-Forwarded-For: $3" -d "{\"email\":\"$1\",\"code\":\"$2\",\"termsAccepted\":true}" $B/api/auth/verify-code; }`
No e-mail provider is set, so the log will show `[accounts] the sign-in code could not be sent` once per code that is really issued; that line is how you count real sends.

## Checks

Run each in order. For every check write PASS or FAIL and, on FAIL, the exact output. Use a fresh e-mail address per section (a1@, a2@ ...) so earlier checks do not interfere.

| # | Do this | Expect |
| --- | --- | --- |
| A1 | in `backend`: `node test/accounts.test.js` | last line `34 passed, 0 failed` |
| A2 | `npm test` (needs Playwright and python3; mark BLOCKED with the reason if missing) | exit code 0 |
| B1 | `rc a1@example.com 1.1.1.1` | `202`, body has `ok` true, `cooldownSeconds` 60, `codeLength` 6 and a six-digit `devCode` (call it C1) |
| B2 | `rc a1@example.com 1.1.1.1` straight away | `429`, `code` `cooldown`, `retryAfter` between 1 and 60 |
| B3 | `rc a1@example.com 2.2.2.2` straight away | `202`, body exactly `{"ok":true,"cooldownSeconds":60,"codeLength":6}`: NO `devCode` |
| B4 | `grep -c "could not be sent" /tmp/sk-qa13.log` | `1` (B3 sent nothing) |
| B5 | `vc a1@example.com <C1> 3.3.3.3` | `200`, `isNewUser` true: the stranger's request did not cancel the owner's code |
| C1 | `rc a2@example.com 1.1.1.1`, wait 61 s, `rc a2@example.com 2.2.2.2` | `202` with a `devCode` (C2): a second address is sent a fresh code after a minute |
| C2 | `vc a2@example.com <first devCode> 5.5.5.5` | `400`, `code` `invalid_code`: the older code was replaced |
| C3 | `vc a2@example.com <C2> 5.5.5.5` | `200` |
| D1 | For `a3@example.com` from `1.1.1.1`: five requests, 61 s apart (about 4 minutes) | all five `202` |
| D2 | a sixth from `1.1.1.1`, 61 s later | `429`, `code` `rate_limited`, `retryAfter` 3600 |
| D3 | the same e-mail from `9.9.9.9` right after D2 | `202` (the cap is per address; the stranger's address is not blocked by `1.1.1.1`'s history) |
| E1 | Unknown and malformed input: `rc nope 1.1.1.1`; `rc "" 1.1.1.1`; a POST with no body | `400` `invalid_email` each, never `500` |
| E2 | A banned or blocked path is unchanged: skip if you cannot create a ban; say so | n/a or `403` |
| F1 | LONG (about 21 minutes; start it in a second terminal at the beginning and come back): for `a4@example.com`, request from 20 different addresses (`10.0.0.1` to `10.0.0.20`), 61 s apart | all `202`, each with a `devCode`; log shows 20 real sends for this address |
| F2 | immediately after, one more from `10.0.0.99` | `202` with NO `devCode`; no new send line in the log; the 20th code (last `devCode`) still signs in with `vc` |
| F3 | `grep -i "bulk" /tmp/sk-qa13.log` | there is no operator channel configured, so the alert goes nowhere; report whether the log shows the attempt or nothing, and say so honestly |
| F4 | wait for the last code to expire (10 minutes after F1 ended, or sign in with it first and then ask again) and request once more from a new address | `202` WITH a `devCode`: mail resumes |

## Look hardest at

- A request that replaced or cancelled an open code when it should not have (B3 to B5, F2).
- A reply that differs in shape or status between "sent" and "absorbed" in a way that tells a stranger whether a code is open (B1 versus B3: only `devCode` may differ, and it exists only because of `ACCOUNTS_DEV_ECHO`).
- Whether a limit applies per e-mail alone anywhere (D3).
- The honest limit: a stranger with a new address every minute can still replace the owner's code once a minute; the fix removes the lockout, not the nuisance. Say if you think that is acceptable.

## Teardown

Stop the server (`kill` the `node server.js` you started) and remove `/tmp/sk-qa13.log` and `/tmp/sk-qa13-jobs`.

## Report

Write `qa/OUTBOX/QA-013-signin-lockout.md` from `qa/RESULT-TEMPLATE.md`, then commit and push as in `qa/README.md`.
