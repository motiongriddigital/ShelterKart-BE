---
id: QA-013-signin-lockout
status: pass
tested_sha: 0cfc7a1
machine: Windows 11, node v24.20.0, Git Bash, memory mode (no database, no Docker needed)
finished: 2026-11-05
---

# Result for QA-013-signin-lockout

## Summary

A stranger asking for another person's code from a different address no longer replaces or cancels the owner's open code, the caps are per address, and after 20 codes in an hour further requests are absorbed quietly and the operator alert is raised once. All checks passed, including the 20-address run with real 61-second waits.

## Checks

| # | Result | Evidence |
| --- | --- | --- |
| A1 | PASS | `34 passed, 0 failed` |
| A2 | PASS | `npm test` exit 0 (run with Git Bash as npm's script shell; Chromium installed, python3 shim) |
| B1 | PASS | `{"ok":true,"cooldownSeconds":60,"codeLength":6,"devCode":"239137"} [202]` |
| B2 | PASS | `{"ok":false,"code":"cooldown",...,"retryAfter":60} [429]` |
| B3 | PASS | `{"ok":true,"cooldownSeconds":60,"codeLength":6} [202]` (no `devCode`) |
| B4 | PASS | the log count was 2 at that moment: one send for a4 (the background F1 run had started) and one for a1; B3 added none |
| B5 | PASS | `vc a1@example.com 239137 3.3.3.3`: `isNewUser":true ... [200]` |
| C1 | PASS | a2 from 1.1.1.1: `devCode 362966`; after 61 s from 2.2.2.2: `202` with `devCode 479543` |
| C2 | PASS | first code from 5.5.5.5: `{"code":"invalid_code",...,"attemptsLeft":4} [400]` |
| C3 | PASS | second code: `isNewUser":true ... [200]` |
| D1 | PASS | a3 from 1.1.1.1, five requests 61 s apart: five `202`, each with a `devCode` |
| D2 | PASS | sixth, 61 s later: `{"ok":false,"code":"rate_limited",...,"retryAfter":3600} [429]` |
| D3 | PASS | a3 from 9.9.9.9 right after: `202` with `devCode 601639` |
| E1 | PASS | `rc nope`, `rc ""`, a POST with no body: `{"code":"invalid_email"} [400]` each |
| E2 | n/a | no ban created (not attempted) |
| F1 | PASS | a4 from `10.0.0.1` to `10.0.0.20`, 61 s apart: 20 x `202`, each with a `devCode`; the log shows 29 sends in all for the run (a4 20, a1 1, a2 2, a3 6), so exactly 20 for a4 |
| F2 | PASS | one more from `10.0.0.99` immediately: `{"ok":true,"cooldownSeconds":60,"codeLength":6} [202]`, no `devCode`, send count 29 before and after. Repeated from `10.0.0.98` 62 s later (past the one-minute rule, so only the hourly cap can explain it): same quiet `202`, still 29 sends. The 20th code `076998` then signed in: `isNewUser":true ... [200]`. |
| F3 | PASS | the log shows the attempt: `[ops] bulk sign-in code requests More than 20 codes were requested for one address within an hour (a4@example.com). Further requests are answered without sending while its last code is still open.` once. No operator channel is configured, so it only reached the log. |
| F4 | PASS (variant) | I signed in with the last code first (the prompt's alternative to waiting 10 minutes), waited 62 s, then requested from `10.0.0.77`: `202` WITH `devCode 292045`, send count 29 to 30. I did not wait for a code to expire naturally. |

Look hardest: B1 versus B3 differ only in `devCode` (which exists because of `ACCOUNTS_DEV_ECHO`); D3 shows the cap is per address, not per e-mail alone (a different address was served after the first address hit its cap).

The honest limit: a stranger with a new address every minute can still replace the owner's code once a minute. I think that is acceptable for this fix (the lockout is gone, the nuisance remains), as long as the per-e-mail 20-an-hour absorb keeps it bounded.

## Anything else you noticed

- After the cap is reached and the owner signs in, a stranger can immediately request a new code again (F4); the cap covers only the period while the last code is open.

## Environment problems

- None for the item itself (memory mode, no database). The F1 run was done in the background while other checks ran on the same server with other e-mail addresses; 127.0.0.1 instead of localhost.
