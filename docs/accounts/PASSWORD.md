# A password on the account

Asked for by the front-end developer on 2026-11-14, then narrowed twice on 2026-11-14: keep the e-mail code as the only way to
sign in, but let the code's request also carry a password, which is saved to the account once that code is verified. There is
no separate password sign-in; every sign-in still e-mails a code. The second narrowing made the password compulsory on every
`request-code` call, and moved `termsAccepted` there too.

Making the password compulsory on every call (not just a deliberate set/change) raised a real problem: the account already
treats "a password came with this code" as an intentional set-or-reset, which ends every other session. If every normal
sign-in now carries a password too, every normal sign-in would silently log out the person's other devices. The fix: at
`request-code`, a password that matches the account's current one (checked, not just compared as hashes) is a no-op — nothing
is held against the code, and verifying it changes nothing and ends no session. Only a password that is new, or different
from the current one, is held and later applied.

## What the person sees

| Moment | What happens |
|---|---|
| First time (no account) | Enter e-mail, a password and tick the terms, get a code, enter the code. The account is created with that password, and the person is signed in. |
| Returning address, same password | Enter e-mail and the password already on the account, get a code, enter it. No terms tick needed, and nothing else changes: other sessions stay signed in. |
| Choosing to change the password | Request a new code for the same address with the new password; verifying that code replaces it and ends every other session. |
| Forgot the password | Same as changing one: request a code with the new password and verify it. |

The e-mail code is the only way in, now and later. A password on the account is stored for whenever the project needs it, but no
route today accepts a password instead of a code.

## What the back end does

Two fields moved onto `request-code`; `verify-code` lost both. No route was added or removed by this narrowing.

| Route | Change |
|---|---|
| `POST /api/auth/request-code` | `password` is now required: missing or weak answers 400 `weak_password` immediately, before any code is created or sent. If the address has an account with a password already, the submitted one is checked against it (`S.verifyPassword`); a match holds nothing against the code (a no-op at verify). Anything else - no account yet, no password yet, or a genuinely different one - is hashed and held against the code (column `password_hash` on `auth_codes`), not yet on the account. `termsAccepted: true` is now required here too, but only when the address has no existing account; without it, 400 `consent_required`, before any code is created or sent. An existing address does not need it. |
| `POST /api/auth/verify-code` | No longer takes `password` or `termsAccepted` — both were already settled by the matching `request-code` call. Once the code is right, a held password (if any) is applied to the account (set, or replaced, ending every other session) and the reply carries `passwordSet: true`; a code whose request matched the existing password holds nothing, so verifying it only signs in, same as before passwords existed. A new account is created freely here; consent was already checked. |
| `GET /api/me` | `user.hasPassword`, unchanged. |

The database change is two nullable columns: `password_hash`, `password_set_at` on `users` (`accounts_password.sql`), and
`password_hash` on `auth_codes` (`auth_codes_password.sql`) — a holding place for the password between the request and the
verify, not the account's own stored password. Nothing is rewritten and no account is touched by either migration.

## Decisions taken, and why

- **scrypt with a secret mixed in**, same as before: the password is first run through HMAC with `AUTH_PEPPER`, then scrypt
  (N 32768, r 8, p 3, the OWASP setting for scrypt, about 0.14 s). No new dependency: this is Node's own `crypto`.
- **The password never reaches `verify-code`.** It is hashed once, at `request-code`, and carried by the code's own row until
  that code is consumed. A different code for the same address (a later `request-code` call) replaces the held password along
  with the code, the same way it already replaces the code itself.
- **A weak password never burns a code.** It is checked and refused at `request-code`, before a code exists, so the person
  fixes it and asks again rather than wasting a code they already have.
- **A verify that sets or replaces a password ends every other session; one that doesn't change it ends nothing.** A stolen
  session does not survive a new password landing on the account, but typing the same password back in (unavoidable now that
  it is sent on every sign-in) must not look like a reset and log out every other device.
- **Rules, unchanged.** 12 to 128 characters, not one repeated character, not on a short list of very common passwords, not
  the e-mail address. No composition rules: length is what helps.
- **Privacy, unchanged.** The hash is never in a response, the data export or an event. It is erased when the account is
  deleted, and the holding copy on `auth_codes` goes with the rest of that row when codes are purged (24 hours) or the account
  is scrubbed.

## What the front end needs

1. Every `POST /api/auth/request-code` call now needs a `password`, on every sign-in, not only sign-up or a change. A
   returning person types the password they already use; it is a no-op if unchanged.
2. A new address also needs `termsAccepted: true` on that same `request-code` call; without it, 400 `consent_required`
   before any code is sent. `POST /api/auth/verify-code` takes neither field any more.
3. On `weak_password` or `consent_required` from `request-code`, show `error` and let the person try again; no code was
   sent yet.
4. After verifying, `passwordSet` on the reply and `user.hasPassword` say whether the password changed. There is no route
   to sign in with it alone — every sign-in still goes through a code.

Error codes: `weak_password`, `consent_required` (both 400, from `request-code` only). Everything else is unchanged from the
plain code flow. Full shapes are in `docs/api/openapi.yaml`.

## Tests

`test/password.test.js`: the rules, the hashing, request-code requiring and refusing a password, requiring consent for a new
address, re-sending the current password as a no-op, verify-code applying a genuine change (new account, and replacing an
existing password with every other session ended), and what must never leak (the hash, in any response, export, or after
deletion).

## Not done

- Any route that signs in with a password instead of a code. If that is wanted later, `POST /api/auth/login` and
  `POST /api/auth/password` from the first draft of this feature are a reasonable starting point (see git history on this
  file) — they were removed on 2026-11-14 because the product decided every sign-in stays code-based for now.
- Rehashing old hashes when the settings are raised (the stored settings make it possible later).
- Removing a password once set.
- A pwned-password check against an outside service: it would send data out, so it stays off unless the owner asks.
