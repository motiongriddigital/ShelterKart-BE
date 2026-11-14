# Password sign-in

Asked for by the front-end developer on 2026-11-14: keep the current e-mail code sign-in, add a password to the account, and after the first time let people sign in with e-mail and password, with no code e-mailed.

## What the person sees

| Moment | What happens |
|---|---|
| First time (no account) | Enter e-mail, get a code, enter the code and choose a password. The account is created and signed in. |
| Next times | Enter e-mail and password. Nothing is e-mailed. |
| Forgot the password | "E-mail me a code" on the same page. The code proves the address, and the person chooses a new password in the same step. |
| Account made before this change (code only) | Signs in with a code as now, then is offered "add a password" once. Until then the code keeps working. |

The e-mail code stays the way in for a first sign-in, for a reset and as the fallback, so nothing that works today stops working.

## What the back end does

Two new routes and one new field. The two existing routes only gain optional input and output.

| Route | Purpose |
|---|---|
| `POST /api/auth/login` | `{email, password}`. A right password starts a session, same cookie as the code sign-in. |
| `POST /api/auth/password` | Signed in. `{password}` sets the first password; `{password, currentPassword}` changes it and ends the other sessions. |
| `POST /api/auth/verify-code` | Optional `password`. New account: sets it. Existing account: the reset path. Reply has `passwordSet`. |
| `GET /api/me` | `user.hasPassword`. |

The database change is two nullable columns on `users`: `password_hash` and `password_set_at`, added by the existing idempotent `accounts.sql`. Nothing is rewritten and no account is touched.

## Decisions taken, and why

- **scrypt with a secret mixed in.** The password is first run through HMAC with `AUTH_PEPPER`, then scrypt (N 32768, r 8, p 3, the OWASP setting for scrypt, about 0.14 s). A copy of the database alone cannot be attacked offline. The settings are stored in each hash, so they can be raised later and old hashes still verify. No new dependency: this is Node's own `crypto`.
- **One answer for every failure.** A wrong password, an address with no account and an account with no password all answer `401 invalid_credentials` with the same words, and the missing-account case does the same amount of work, so neither the answer nor the time says which addresses have accounts.
- **No "does this address have a password" lookup.** That would list customers to anyone. The page shows e-mail and password together with "e-mail me a code instead" beside it. The owner left this to the builder (2026-11-14); one page with generic answers is what OWASP asks for.
- **Locks.** 10 wrong passwords for one address in an hour lock password sign-in for that address, counted whether or not the account exists (OWASP: count unknown accounts too, or the lock reveals who has one; NIST: rate-limit failures, with a ceiling of 100); the code sign-in is not affected, so a locked person is never shut out. 30 attempts an hour per IP address. The quick check (proof of work) applies when it is on, as for requesting a code.
- **A weak password never burns a code.** It is checked before the code, so the person fixes it and uses the same code.
- **A reset or a change ends other sessions.** A stolen session does not survive the owner choosing a new password.
- **Rules.** 12 to 128 characters, not one repeated character, not on a short list of very common passwords, not the e-mail address. No composition rules (upper case, symbols): length is what helps. 12 follows OWASP ASVS; NIST's 2025 guidance asks 15 where a password is the only factor, which we did not take because the e-mail code is an equal way in and the extra length would only add friction at sign-up.
- **Privacy.** The hash is never in a response, the data export or an event. It is erased when the account is deleted.

## What the front end needs

1. Sign-in page: e-mail and password, a "Sign in" button, and "E-mail me a code" beside it. On `invalid_credentials` show the sentence from `error` and keep "E-mail me a code" in view. On `too_many_attempts` show `error`; the code route still works.
2. Code step (new account, or forgot): a password field next to the code, sent as `password` to `verify-code`. On `weak_password` show `error`; the code is still valid.
3. After a code-only sign-in, if `user.hasPassword` is false, offer "Add a password" using `POST /api/auth/password`.
4. Settings: change password with `currentPassword`.

Error codes: `invalid_credentials` (401), `weak_password` (400), `too_many_attempts` (429, with `retryAfter`), `account_disabled` (403), `challenge` (428, as for the code request). Full shapes are in `docs/api/openapi.yaml`.

## Settings

`AUTH_PASSWORD_FAILS_PER_HOUR` (default 10, allowed 3 to 200). Everything else reuses the accounts settings.

## Tests

`test/password.test.js` (21 checks, in-memory store, cheap scrypt settings). Seven guards were broken on purpose, one at a time, and each broke at least one test: the lock, the wrong-password record, the disabled check, ending sessions on reset, the current-password check, the weak-password-first order and the comparison itself.

## Not done

- Rehashing old hashes when the settings are raised (the stored settings make it possible later).
- Removing a password once set, and "sign out everywhere on change" is limited to ending the other sessions.
- A pwned-password check against an outside service: it would send data out, so it stays off unless the owner asks.
