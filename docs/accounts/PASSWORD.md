# A password on the account

Asked for by the front-end developer on 2026-11-14, then narrowed on 2026-11-14: keep the e-mail code as the only way to sign in,
but let the code's request also carry a password, which is saved to the account once that code is verified. There is no separate
password sign-in; every sign-in still e-mails a code.

## What the person sees

| Moment | What happens |
|---|---|
| First time (no account) | Enter e-mail (and, if the page asks for one, a password), get a code, enter the code. The account is created, the password (if any) is saved, and the person is signed in. |
| Later, choosing to add or change a password | Request a new code for the same address with the new password; verifying that code replaces it and ends every other session. |
| Forgot the password | Same as changing one: request a code with the new password and verify it. |

The e-mail code is the only way in, now and later. A password on the account is stored for whenever the project needs it, but no
route today accepts a password instead of a code.

## What the back end does

One field moved, nothing new was added as a route.

| Route | Change |
|---|---|
| `POST /api/auth/request-code` | Gained an optional `password`. A weak one answers 400 `weak_password` immediately, before any code is created or sent. A good one is hashed and held against that code (column `password_hash` on `auth_codes`), not yet on the account. |
| `POST /api/auth/verify-code` | No longer takes `password`. Once the code is right, if the code it matched was requested with a password, that password is applied to the account (set, or replaced if one already existed, ending every other session) and the reply carries `passwordSet: true`. |
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
- **A verify that sets or replaces a password ends every other session.** A stolen session does not survive a new password
  landing on the account.
- **Rules, unchanged.** 12 to 128 characters, not one repeated character, not on a short list of very common passwords, not
  the e-mail address. No composition rules: length is what helps.
- **Privacy, unchanged.** The hash is never in a response, the data export or an event. It is erased when the account is
  deleted, and the holding copy on `auth_codes` goes with the rest of that row when codes are purged (24 hours) or the account
  is scrubbed.

## What the front end needs

1. Wherever a password is offered (sign-up, or a settings page offering "add a password" or "change password"), send it as
   `password` on the `POST /api/auth/request-code` call for that address, then call `POST /api/auth/verify-code` as normal
   (no `password` field there). On `weak_password` from `request-code`, show `error` and let the person try again; no code
   was sent yet.
2. After verifying, `passwordSet` on the reply and `user.hasPassword` say whether a password is now on the account. There is
   no route to sign in with it — every sign-in, including this account's next one, still goes through a code.

Error codes: `weak_password` (400, from `request-code` only). Everything else is unchanged from the plain code flow. Full
shapes are in `docs/api/openapi.yaml`.

## Tests

`test/password.test.js`: the rules, the hashing, request-code holding and refusing a password, verify-code applying it (new
account, and replacing an existing one with every other session ended), and what must never leak (the hash, in any response,
export, or after deletion).

## Not done

- Any route that signs in with a password instead of a code. If that is wanted later, `POST /api/auth/login` and
  `POST /api/auth/password` from the first draft of this feature are a reasonable starting point (see git history on this
  file) — they were removed on 2026-11-14 because the product decided every sign-in stays code-based for now.
- Rehashing old hashes when the settings are raised (the stored settings make it possible later).
- Removing a password once set.
- A pwned-password check against an outside service: it would send data out, so it stays off unless the owner asks.
