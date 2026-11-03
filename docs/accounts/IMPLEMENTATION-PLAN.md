# User accounts: implementation plan and status

Written 3 November 2026. Epic SHEL-50 on the board. Design in `TDD.md`, requirements in `PRD.md`.

## Slices

| Slice | Content | Status on 3 Nov |
| --- | --- | --- |
| S1 | Migration `accounts.sql` (13th), `secrets.js`, `config.js`, `store.js` (Postgres and memory) | Built. 31 unit checks in `test/accounts.test.js`. Applied twice on a real Postgres 16. |
| S2 | Sign-in, session and account routes (`index.js`), cookie, guards, clean-up | Built and tested, including against a real database with `tools/smoke_accounts.js`. |
| S3 | The wall in `server.js`: guards, entitlement by purchase, purchase owner, no-token report pages, recover retired, account e-mail for delivery | Built. `test/harness/accounts.test.js` covers every guarded and public route, ownership, refund and sign-out. |
| S4 | Documentation: OpenAPI (tag Accounts), `.env.example`, this folder | Built. |
| S5 | Funnel events (`signin_wall`, `signin_code_requested`, `signin_verified`) in analytics | Not built. Needs the owner to confirm the funnel in `PRD.md` section 9. |
| S6 | Hardening: configurable proxy trust (SHEL-35), startup check for the whole configuration (SHEL-43), security review, e-mail alerts on send failure rate | Partly: the accounts part of the startup check and the single-failure alert exist. SHEL-35 and SHEL-43 stay open. |
| S7 | Remove the old access-token code | Not before the flag has been on in production for 30 days. |

## What was verified

- `npm test`: the previous 907 checks unchanged with accounts off, plus the new unit and harness suites.
- Real Postgres 16 in a throwaway container: 13 migrations apply, a second run applies none, the existing smoke test passes in production mode with accounts off, and `tools/smoke_accounts.js` passes against a second server with accounts on (17 checks). Afterwards the database held the user, the revoked session, the used code and two audit rows.
- CI runs both smoke tests in the `real-run` job (second server on port 3001).

## What is not verified

- Real e-mail delivery: no provider is configured here. The code reaches the user only through `sendEmail`, which is covered by its own tests, and through the dev echo in tests.
- A browser. The cookie attributes are checked as strings, not in Chrome. Do this on staging (checklist below).
- The delivery e-mail to the paying account (`onReportPaid` with the buyer's address). It is built, but the test stub does not return the buyer's address, so no test covers it yet.
- The website side. Nothing in the frontend repository has changed.

## Staging checklist before switching on in production

1. Set `ACCOUNTS_ENABLED=on`, a random `AUTH_PEPPER` of at least 32 characters, an e-mail provider key and the sender, and leave `ACCOUNTS_DEV_ECHO` unset. The server refuses to start in production otherwise.
2. Sender domain records (SPF, DKIM, DMARC) in place; send a code to a Gmail and an Outlook address and read the delivery time.
3. In Chrome: sign in, check the cookie is `HttpOnly`, `Secure`, `SameSite=Lax`, named `__Host-sk_session`; sign out; check it is gone.
4. Open a report page in a private window: it must redirect to `/signin`.
5. Buy a report with a test card; read it on a second device by signing in with the same e-mail; refund it; confirm it falls back to the preview.
6. Request six codes for one address and see the limit; enter five wrong codes and see the lock.
7. Export and delete a test account.
8. Review by a second person of `backend/accounts/` and the guarded routes; run `/security-review`.

## Rollback

Set `ACCOUNTS_ENABLED=off` (or remove it) and restart. Every route behaves as before. The new tables stay and are unused.

## Known behaviour to be aware of

- A project's saved investigation is shared by everyone who searches it. With accounts on, the "your report is ready" e-mail goes to the buyer whose payment triggered the completion, and later buyers of the same finished report get it at once with a fresh e-mail to their own account.
- A search that starts without an account and is never followed by a sign-in still costs AI money, up to the existing caps.
- `GET /start` and the other backend-rendered pages link to `/signin`, which the website must provide.
