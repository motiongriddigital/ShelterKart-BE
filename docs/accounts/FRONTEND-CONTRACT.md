# User accounts: what the website side builds

For the frontend developer. Read `PRD.md` section 6 for the flows and `docs/api/openapi.yaml` (tag Accounts) for every request and reply. This page is the checklist and the rules that are easy to miss.

Decisions already taken by the owner, subject to your discussion with them: the search can start without an account and the sign-in wall stands in front of the results (see section 3); paid reports belong to the account for good; there are no shared report links; samples, guide, pricing and policy pages stay public.

## 1. How the cookie works

- The session is a cookie named `__Host-sk_session` (production) or `sk_session` (development). It is `HttpOnly`: page scripts cannot read it and must not try.
- The browser already calls the API through the website's own origin (`/api/*` and `/r/*` rewrites in `next.config.ts`). That makes the cookie first-party. No `credentials` option is needed for same-origin `fetch`.
- Keep the rewrite list as it is. Add nothing for `/signin`: that route is yours.
- Server components that call the API directly (`API_ORIGIN`) have no cookie. When a server component needs the signed-in user, forward the header: `headers: { cookie: (await cookies()).toString() }` on that call. Prefer to load user data in the browser.
- Never store a session, token or e-mail code in `localStorage`, a cookie you set yourself, or the URL.

### Development on different URLs, production on one

Agreed with the frontend developer on 5 November: while developing, the frontend and the API run on different URLs (for example `http://localhost:5173` and `http://localhost:3000`); in production both are served from the same URL, or the frontend proxies `/api`.

- Production, same URL: nothing special. Same-origin calls, no CORS, the `__Host-sk_session` cookie.
- Development, different origins: every call must use `credentials: "include"` (`fetch`) or `withCredentials: true` (axios), or the browser neither stores nor sends the cookie. The API answers with `Access-Control-Allow-Credentials: true` for the origins in `ALLOWED_ORIGINS`; put the frontend's origin there (with an empty list, any origin is accepted outside production). Two ports on `localhost` count as the same site, so `SameSite=Lax` cookies work; two different domains (for example a frontend on a hosting preview address calling an API on another domain) do not, and are not supported.
- In development the cookie is named `sk_session` and has no `Secure` flag, so it works over plain `http://localhost`.
- State-changing calls (POST, PUT, PATCH, DELETE) that carry the session cookie must come from an origin in `ALLOWED_ORIGINS` or from the API's own origin. Browsers add the `Origin` header on their own. With `ACCOUNTS_CSRF=on` the API answers 403 `{ ok: false, code: "csrf", error: "This request came from an origin that is not allowed." }` to anything else; with `report` (the default on a developer machine; in production the default is `on`) it only logs the line `[csrf] would refuse ...`. Server-side callers that forward the visitor's cookie must also send an `Origin` header.
- Session lifetime: 30 days, extended while the visitor is active, at most 90 days in all. Logging out, logging out everywhere, an admin disabling or banning the account, and deleting the account end the session at once (the next call gets 401).

### Who is signed in, and is the e-mail verified

`GET /api/auth/session` never answers 401. Signed out: `{ ok: true, authenticated: false }`. Signed in: `{ ok: true, authenticated: true, emailVerified: true, expiresAt: "2026-12-05T10:00:00.000Z" }`. It is not cached. Use it on page load to decide whether to show the sign-in dialog, and `GET /api/me` (401 when signed out) when you need the profile. `GET /api/me` and the sign-in reply carry `emailVerified` too.

## 2. Calls

| Screen or moment | Call | Notes |
| --- | --- | --- |
| Open the app, header | `GET /api/auth/session`, then `GET /api/me` when it says `authenticated` | The first never answers 401. Do it once and keep the answer in a small store. |
| Sign-in, step 1 | `POST /api/auth/request-code` `{ email, language, pow? }` | 202 always for a valid address. Show "if that address can receive mail, a code is on its way". 429 `cooldown` and `rate_limited` carry `retryAfter`. 428 `challenge`: solve the proof of work the same way the search does, then repeat with `pow`. |
| Sign-in, step 2 | `POST /api/auth/verify-code` `{ email, code, termsAccepted? }` | 200 sets the cookie. 400 `invalid_code` has `attemptsLeft`. 400 `consent_required`: show the terms checkbox and send the same code again with `termsAccepted: true` (the code is still valid). 429 `too_many_attempts`: ask for a new code. 403 `account_disabled`. |
| Account menu | `POST /api/auth/logout`, `POST /api/auth/logout-all` | Clear the local user store, then go to the home page. |
| My reports | `GET /api/me/reports` | Rows with `ref`, `projectName`, `market`, `paid`, `purchasedAt`, `amount`, `currency`, `lastOpenedAt`. Link each to `/r/<ref>`. |
| Account page | `GET /api/me`, `PATCH /api/me` | `displayName` (kept as one line of plain text, up to 80 characters: HTML tags are removed, so show it as text), `country`, `language`; a phone only with the WhatsApp consent box. |
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

When the dialog opens, send one analytics event: `POST /api/track` with `{ "event": "signin_wall", "path": "/" }`, like the other page events. The server records the code request and the sign-in itself, so nothing else is needed; no user id or address goes into analytics.

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
