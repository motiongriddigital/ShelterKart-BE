# User accounts: what the website side builds

For the frontend developer. Read `PRD.md` section 6 for the flows and `docs/api/openapi.yaml` (tag Accounts) for every request and reply. This page is the checklist and the rules that are easy to miss.

Decisions already taken by the owner, subject to your discussion with them: the search can start without an account and the sign-in wall stands in front of the results (see section 3); paid reports belong to the account for good; there are no shared report links; samples, guide, pricing and policy pages stay public.

## 1. How the cookie works

- The session is a cookie named `__Host-sk_session` (production) or `sk_session` (development). It is `HttpOnly`: page scripts cannot read it and must not try.
- The browser already calls the API through the website's own origin (`/api/*` and `/r/*` rewrites in `next.config.ts`). That makes the cookie first-party. No `credentials` option is needed for same-origin `fetch`.
- Keep the rewrite list as it is. Add nothing for `/signin`: that route is yours.
- Server components that call the API directly (`API_ORIGIN`) have no cookie. When a server component needs the signed-in user, forward the header: `headers: { cookie: (await cookies()).toString() }` on that call. Prefer to load user data in the browser.
- Never store a session, token or e-mail code in `localStorage`, a cookie you set yourself, or the URL.

## 2. Calls

| Screen or moment | Call | Notes |
| --- | --- | --- |
| Open the app, header | `GET /api/me` | 200 with the user, or 401: signed out. Do it once and keep the answer in a small store. |
| Sign-in, step 1 | `POST /api/auth/request-code` `{ email, language, pow? }` | 202 always for a valid address. Show "if that address can receive mail, a code is on its way". 429 `cooldown` and `rate_limited` carry `retryAfter`. 428 `challenge`: solve the proof of work the same way the search does, then repeat with `pow`. |
| Sign-in, step 2 | `POST /api/auth/verify-code` `{ email, code, termsAccepted? }` | 200 sets the cookie. 400 `invalid_code` has `attemptsLeft`. 400 `consent_required`: show the terms checkbox and send the same code again with `termsAccepted: true` (the code is still valid). 429 `too_many_attempts`: ask for a new code. 403 `account_disabled`. |
| Account menu | `POST /api/auth/logout`, `POST /api/auth/logout-all` | Clear the local user store, then go to the home page. |
| My reports | `GET /api/me/reports` | Rows with `ref`, `projectName`, `market`, `paid`, `purchasedAt`, `amount`, `currency`, `lastOpenedAt`. Link each to `/r/<ref>`. |
| Account page | `GET /api/me`, `PATCH /api/me` | `displayName`, `country`, `language`; a phone only with the WhatsApp consent box. |
| Download my data | `GET /api/me/export` | A file download. |
| Delete my account | `DELETE /api/me` `{ confirm: "DELETE" }` | Explain first that paid reports will no longer open. |

## 3. The wall

The backend answers 401 `{ ok: false, code: "auth_required" }` from every guarded route. Treat that one reply as the only trigger: open the sign-in dialog, keep whatever the visitor typed, and after sign-in repeat the call that failed. Do not guess from your own state.

What is guarded and what is not is in `TDD.md` section 6. The ones you meet in the search flow:

1. `POST /api/investigate` is **not** guarded in the default mode: the search starts, you get `{ ref }`.
2. `GET /api/investigate/:ref/events` (the progress and results stream) **is** guarded. An unsigned visitor gets 401 before any event. After sign-in, open the stream again: it replays everything from the start, so nothing is lost.
3. Quote, checkout, payment verification, the report page and the PDF are guarded.

When to show the wall is your design decision with the owner: on pressing search, after about three seconds while the first steps show behind the dialog, or when the first result would appear. All three work with this API. If the owner prefers that no search starts without an account, the server setting `ACCOUNTS_SEARCH_GATE=start` makes `POST /api/investigate` return 401 too; the same handling covers it.

The server-rendered pages `/r/:ref` and `/r/:ref/pdf` redirect or refuse an unsigned visitor. `/r/:ref` answers 302 to `/signin?next=<path>`. Build `/signin` to read `next`, show the dialog, and after success go to `next` only if it starts with a single `/`.

## 4. Payment

- Remove the e-mail and phone fields from `PayModal`. The receipt and the report go to the account e-mail.
- `POST /api/investigate/:ref/contact` is now a no-op that answers `{ ok: true }`. Stop calling it.
- After payment, `POST /api/research/razorpay/verify` and `/api/research/access` answer `{ ok: true, entitled: true }` with no `token`. Open the report: `GET /api/research/by-ref/:ref` now returns the full report for the owner.
- Delete the `sk_access_<ref>` local-storage code, `useRestore` and `RestoreModal`. `POST /api/research/recover` answers 410 `use_account`.
- A purchase belongs to the account that started it. Another account gets 403 `not_entitled`.

## 5. Text and design

New strings, English first, then the nine languages through the existing `useT` files:

`signin.title`, `signin.why` (one line on why an account is needed), `signin.email.label`, `signin.send`, `signin.code.label`, `signin.verify`, `signin.resend`, `signin.resend.in`, `signin.terms` (with links to terms and privacy), `signin.checkspam`, `signin.error.invalid_email`, `signin.error.invalid_code`, `signin.error.too_many`, `signin.error.cooldown`, `signin.error.disabled`, `account.menu.reports`, `account.menu.account`, `account.menu.signout`, `account.signout_all`, `account.export`, `account.delete.title`, `account.delete.warning`, `account.delete.confirm`, `reports.title`, `reports.empty`, `reports.paid`, `reports.preview`.

Rules: touch targets at least 44 px; the code field `inputMode="numeric"`, `autoComplete="one-time-code"`, `maxLength=6`; the dialog follows the existing `useModalA11y`; the typed search survives the dialog; the resend button counts down from 60 seconds; no password field anywhere; the e-mail field is `type="email"` with `autoComplete="email"`.

## 6. Demo mode

With `NEXT_PUBLIC_DEMO_MODE` on there is no backend. Mock `/api/me` as signed out, make the dialog accept any six digits, and keep a fake user in memory only. Nothing from demo mode may write a cookie.

## 7. Tests the website side should have

The dialog opens on a 401 and the failed call is repeated after sign-in; a wrong code shows the tries left; the consent step keeps the code; sign-out clears the user store; My reports renders a paid and an unpaid row; the pay dialog no longer asks for e-mail or phone.

## 8. Order of work

1. API is ready on the branch `feature/user-accounts` in the backend repository and runs locally with `ACCOUNTS_ENABLED=on ACCOUNTS_ALLOW_MEMORY=true ACCOUNTS_DEV_ECHO=on AUTH_PEPPER=<32 or more characters>`. With the dev echo the code comes back in the `request-code` reply as `devCode`, so you do not need an e-mail provider to build.
2. Sign-in dialog and header, then the wall on 401, then My reports and the account page, then the payment changes.
3. The flag stays off in production until both sides are ready.
