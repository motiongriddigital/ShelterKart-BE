# Sign-in is by e-mailed code only (B5, no password)

Decided by the owner on 2026-11-25. The full-stack test (B5, 2026-11-19) found that the password was not a credential: any
password plus an e-mailed code signed in, replaced the stored password and ended every other session. Nothing ever checked a
password against the one on the account, so the field gave a false sense of security. The password is dropped from sign-in. The
e-mailed code is the only credential, as in the original product plan (`PRD.md`: "No password exists anywhere").

## What the person sees

| Moment | What happens |
|---|---|
| First time (no account) | Enter e-mail, tick the terms, get a code, enter the code. The account is created and the person is signed in. |
| Returning address | Enter e-mail, get a code, enter it. No terms tick needed. Other sessions stay signed in. |

There is no password field, no "add a password", no "forgot password".

## What the back end does

| Route | Change |
|---|---|
| `POST /api/auth/request-code` | `password` is no longer needed and no longer checked: a missing, weak or strange value is ignored, never hashed and never stored. A new address still needs `termsAccepted: true` (400 `consent_required` without it). |
| `POST /api/auth/verify-code` | Never sets or replaces a password and never ends another session. The reply still carries `passwordSet`, always `false`, so a client that reads it keeps working. |
| `GET /api/me` | `user.hasPassword` stays, `false` for every account made from now on. |

A front end that still sends `password` keeps working: the field is ignored. It should stop sending it and remove the field.

No migration. The columns `users.password_hash`, `users.password_set_at` and `auth_codes.password_hash` stay and are not
written to any more. An account that already holds a hash keeps it untouched and unused; it is erased with the account, as
before. To erase the old hashes for everyone, the owner can run
`UPDATE users SET password_hash=NULL, password_set_at=NULL` once. The password helpers in `accounts/secrets.js` and their unit
tests stay, for the day a real password login (hash checked at sign-in, a reset flow, a login lock-out) is wanted.

## What the front end needs

1. Remove the password field from the sign-in and sign-up dialog, and stop sending `password` to `request-code`.
2. Keep `termsAccepted: true` on the `request-code` call for a new address.
3. Remove any "add a password" or "change password" screen. `weak_password` is no longer returned.

## Tests

`test/password.test.js`: the password helpers (rules, salted slow hash), request-code needing no password, consent still needed for
a new address, a password that is still sent being ignored and never stored, signing in again ending no other session, an old
stored hash staying untouched and never leaking, and nothing about a password in events or the audit log.
