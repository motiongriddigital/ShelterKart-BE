# User accounts and sign-in: product requirements

Status: decisions D1 to D5 accepted by the owner on 3 November 2026, to be discussed further with the frontend developer (board items SHEL-50 to SHEL-56). Written 3 November 2026. Companion documents in this folder: `TDD.md` (how it is built), `FRONTEND-CONTRACT.md` (what the website side builds), `IMPLEMENTATION-PLAN.md` (slices, tests, rollout). The HTTP contract is in `docs/api/openapi.yaml`, tag Accounts.

Everything marked "Decision" is a default chosen so work can start. Section 11 lists each one; changing a default changes the technical documents in a named place.

## 1. Summary

Today nobody has an account. A buyer searches anonymously, pays, and is given a signed link and a token kept in the browser's local storage. The client now requires that every visitor who searches, whether for a free preview or a paid report, signs in first, and that signed-in users have their data and purchases stored in the database.

This document specifies sign-in by e-mail code, a cookie session, a stored user record, a stored list of the user's reports and purchases, and the rule "no account, no search, no report".

## 2. Why

| Reason | Detail |
| --- | --- |
| Protect AI spend | Every search that is not served from a stored report starts a paid investigation. Today the only guards are a proof-of-work check, per-IP limits and daily caps. A signed-in user can be limited, counted and stopped individually. |
| Durable purchases | Paid access today is a token in one browser's local storage plus an e-mailed link. Clearing the browser, changing device or losing the e-mail means "recover by typing the Razorpay payment ID". An account makes a purchase belong to a person. |
| Know the buyer | The client's plan depends on paid reports per week, repeat use and cost per buyer. Without an identity none of the repeat-use numbers exist. |
| Fix known weaknesses | A refunded purchase can still obtain a fresh 30-day token (SHEL-38). Buyer e-mail and phone sit in saved-investigation files outside the deletion routine (SHEL-42). Both go away when access follows a purchase row and contact data lives on the user record. |
| Support | "I paid and cannot see my report" becomes "sign in with the e-mail you paid with". |

## 3. Goals

1. A visitor cannot see results, open a report page or buy a report without being signed in. A search may start before sign-in; the wall stands in front of the results (D1).
2. Signing in needs only an e-mail address and a code. No password exists anywhere.
3. A signed-in user stays signed in for 30 days on that device and can sign out, and can sign out everywhere.
4. Every purchase is stored against the user. Paid access is read from the database, so it survives a new device, a cleared browser and a lost e-mail.
5. A user can see their reports ("My reports"), export their data and delete their account.
6. Nothing in the public part of the product breaks: samples, guide, pricing, policy pages, right of reply, corrections and payment webhooks stay public.
7. The whole feature sits behind one switch. With the switch off the product behaves exactly as it does today.

## 4. Non-goals for the first release

- Passwords, password reset, security questions.
- Sign in with Google, Apple or phone codes. Designed for, not built (section 11, D7).
- Teams, shared accounts, B2B or developer accounts. Developers stay outside the system and use the right of reply.
- Admin accounts and roles. Admin keeps its separate login for now.
- Subscriptions or "watch this project" for accounts. The existing watcher table keeps working with the user's e-mail.
- Linking analytics to users. Analytics stays anonymous (see section 8).
- Importing old buyers. Nothing is deployed, so there are none.

## 5. Users

| User | Needs |
| --- | --- |
| First-time buyer | Understand why an account is needed before being asked, sign in in under a minute without a password, and keep the search they typed. |
| Returning buyer | Be recognised, see earlier reports and purchases, open a paid report from any device. |
| Buyer abroad | Sign in from any country. Codes must arrive in minutes. The sign-in screen works in the nine site languages. |
| Owner / support | See that a user exists, that a purchase belongs to them, and delete a user on request. |
| Counsel | Consent, privacy and deletion behave as the privacy text and the legal pack promise. |

## 6. User flows

### 6.1 First visit, not signed in

1. The visitor lands on the site. Public pages work as before.
2. They type a project and press search. The search starts. A few seconds later, before any result is shown, the page opens the sign-in dialog and keeps the typed project. The exact moment is for the owner and the frontend developer to settle (SHEL-54).
3. They enter an e-mail address and press "Send code"; a new address also ticks the terms and privacy consent.
4. A six-digit code arrives by e-mail within about a minute and is valid for 10 minutes.
5. They enter the code. The dialog closes, they are signed in, and the results appear. The search that was already running is not repeated.

### 6.2 Returning, signed in

Search, preview and paid reports work as today. The header shows an account menu with "My reports", "Account" and "Sign out".

### 6.3 Buying

1. A signed-in user opens a preview and presses unlock. The payment window no longer asks for e-mail or phone: the verified account e-mail is used for the receipt and the report copy.
2. Payment completes through Razorpay or the merchant of record. The purchase row carries the user's id.
3. The paid report opens at once. The same report opens on any device after signing in.

### 6.4 Lost access

There is nothing to recover. Sign in again with the same e-mail. The old "recover by payment ID" screen is retired when accounts are on.

### 6.5 Signing out

"Sign out" ends this device's session. "Sign out everywhere" ends all of them.

### 6.6 Deleting the account

The user confirms by typing DELETE. Sessions end at once. Personal data on the user record is erased; purchase records stay without a name or e-mail because accounting and tax law may require the amounts to be kept (counsel to confirm, section 11, D8). The confirmation says that paid reports will no longer open.

## 7. Requirements

Priority: M = must for release, S = should, C = could.

### 7.1 Sign-in

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-1 | Request a code with an e-mail address. The reply is the same whether or not the address has an account. | M |
| FR-2 | The code has six digits, expires after 10 minutes, and can be tried 5 times. Requesting a new code invalidates the older one. | M |
| FR-3 | A correct code creates the user if none exists (with the terms and privacy versions accepted), marks the e-mail verified and starts a session. | M |
| FR-4 | A request for a new code can be made once every 60 seconds, at most 5 per hour per address and 20 per hour per IP address. | M |
| FR-5 | The code request needs the existing proof-of-work check when `BOT_GUARD` is on, so bots cannot mail-bomb. | M |
| FR-6 | E-mail addresses are compared case-insensitively, trimmed, at most 254 characters, one `@`. Aliases such as `+tag` are kept as given. | M |
| FR-7 | Sign-in is refused with a clear message for accounts that have been disabled. | S |
| FR-8 | A blocklist of disposable e-mail domains can be switched on. | C |

### 7.2 Session

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-9 | The session is a random token in an HttpOnly, Secure, SameSite=Lax cookie. The database stores only a hash. | M |
| FR-10 | A session lasts 30 days from sign-in, extended while in use, never beyond 90 days in total. | M |
| FR-11 | Sign out revokes the session at once. Sign out everywhere revokes all of the user's sessions. | M |
| FR-12 | The session cookie is never readable by page scripts and never appears in logs. | M |

### 7.3 The sign-in wall

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-13 | With accounts on, these answer 401 `{ ok: false, code: "auth_required" }` without a session: the progress and results stream, read a report, quote, checkout, payment verification, access check, document check, the live event stream, the report pages and their PDF. Starting a search needs no session in the default mode and does with `ACCOUNTS_SEARCH_GATE=start`. The full list is in `TDD.md` section 6. | M |
| FR-14 | These stay public: samples, the guide and its downloads, pricing and market lists, language list, challenge, tracking, health, policy pages, the right-of-reply and corrections routes, the dispute route and the payment webhooks. | M |
| FR-15 | The server-rendered report pages send an unsigned visitor to the website's sign-in route with a safe `next` address. | M |
| FR-16 | With accounts off, none of the above changes. | M |

### 7.4 Purchases and access

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-17 | Checkout stores the user's id on the purchase. A purchase without a user is refused when accounts are on. | M |
| FR-18 | A user may read the full report of a project if and only if they hold a paid, not refunded, purchase for it. | M |
| FR-19 | A refund removes access at the next request. | M |
| FR-20 | The receipt and the report copy go to the verified account e-mail. The buyer contact form and its storage in saved-investigation files are retired. | M |
| FR-21 | The existing signed access tokens keep working only while accounts are off. | M |

### 7.5 Account data

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-22 | `GET /api/me` returns the signed-in user. | M |
| FR-23 | The user can set a display name, country and language. Country feeds default pricing. | S |
| FR-24 | "My reports" lists every report the user opened or bought, newest first, and shows which are paid. | M |
| FR-25 | The user can download their data as a JSON file. | M |
| FR-26 | The user can delete the account (section 6.6). | M |
| FR-27 | Phone number for WhatsApp delivery is optional, needs a separate consent and is stored on the user. | C |

### 7.6 Non-functional

| ID | Requirement |
| --- | --- |
| NFR-1 | Verifying a code answers in under 300 ms at the 95th percentile with a warm database. |
| NFR-2 | A code e-mail is handed to the provider within 2 seconds of the request. Delivery depends on the provider and the sender domain records. |
| NFR-3 | Codes and session tokens are never stored or logged in clear text. |
| NFR-4 | Every sign-in, failed code, sign-out and deletion is written to the existing audit log. |
| NFR-5 | The feature adds no new npm dependency unless the technical document says so. |
| NFR-6 | All new text exists in the nine site languages before release; the English text is the reference. Non-English text is machine drafted and marked unreviewed, as the site's other languages are. |
| NFR-7 | Touch targets are at least 44 px, the code field uses `autocomplete="one-time-code"`, and the dialog works with a keyboard and a screen reader. |

## 8. Privacy and compliance

- The account stores: e-mail, optional name, country, language, optional phone, consent timestamps and versions, created and last-login times. Nothing else about the person.
- Analytics stays anonymous. The daily salted visitor hash is not joined to users and user ids are not written to analytics events. This keeps the existing promise in the privacy text.
- Consent is explicit at first sign-in: terms and privacy, with a link to each, and the version accepted is stored.
- The existing source-consent banner (visit source stored on the device) is unchanged and separate.
- Export and deletion are self-service (FR-25, FR-26). The privacy page and the legal pack need new wording; counsel reviews it. The existing legal pack already lists open questions for counsel.
- E-mail codes are personal data in transit only; hashed codes are deleted after 24 hours.

## 9. Success measures

The client's current dashboard measures visitor to paid at 2 percent. With a sign-in wall that figure changes meaning, so the funnel is redefined, measured from anonymous events and from user counts:

| Step | Measure |
| --- | --- |
| Wall shown | Search attempts that opened the sign-in dialog |
| Code requested | Share of wall views that requested a code |
| Signed in | Share of code requests that verified (target at least 80 percent) |
| Searched | Signed-in users who started a search within the same visit |
| Paid | Signed-in users who bought (the client's North Star stays paid reports per week) |

Health numbers: code e-mail delivery time, failed-code rate, sessions per user, and accounts deleted. The existing target "unlock click to paid at least 50 percent" is unaffected. The visitor-to-paid target should be restated by the client as signed-in-user-to-paid, and the wall's drop-off is expected to lower the raw visitor figure.

## 10. Release and rollout

1. Build behind `ACCOUNTS_ENABLED=off`. Nothing changes for anyone.
2. Turn it on in staging with a real e-mail provider; run the acceptance script in `IMPLEMENTATION-PLAN.md`.
3. The website side ships its sign-in dialog and account pages against the same flag.
4. Switch on in production together with the first paid launch. Because nothing is live, there is no migration of existing buyers.
5. Rollback is switching the flag off. The new tables are additive and stay.

Release criteria: all tests pass in CI, the real-Postgres run covers the sign-in round trip, the security checklist in `TDD.md` section 9 is signed off, counsel has seen the privacy wording, and the e-mail domain records (SPF, DKIM, DMARC) are in place.

## 11. Decisions and open questions

| ID | Decision | Default used here | Needs |
| --- | --- | --- | --- |
| D1 | Where the wall stands | **Accepted:** the search starts, the wall stands in front of the results (`ACCOUNTS_SEARCH_GATE=view`). Switch to `start` to refuse unsigned searches. Cost note: an unsigned search that is never followed by a sign-in still spends AI money, within the existing caps | Owner, with the frontend developer (SHEL-54) |
| D2 | How long paid access lasts | **Accepted:** for the life of the account (today: 30 days per token) | Done |
| D3 | What stays public | **Accepted:** list in FR-14 | Done |
| D4 | Shared report links | **Accepted:** there are no shared report links; every report page needs a sign-in and paid content follows the buyer | Done |
| D5 | The wall versus the "free first look" in the investor deck | **Accepted:** the first look appears after a short wall, a few seconds into the search | The client should be told; the deck and the metrics change |
| D6 | E-mail provider and sender domain | Resend or Postmark (both already supported in code); domain and records from the client | Client (SHEL-55) |
| D7 | Phone and social sign-in | Not in version 1; schema leaves room | Owner |
| D8 | Deleting an account that has purchases | Personal data erased, purchase rows kept without identity | Counsel (SHEL-56) |
| D9 | Language of code e-mails | English first, nine languages when translations exist | Owner |

## 12. Risks

| Risk | Effect | Handling |
| --- | --- | --- |
| The wall lowers conversion | Fewer paid reports from cold traffic | Keep the dialog short, keep the typed search, explain why. Measure the funnel in section 9 from day one. |
| E-mail does not arrive | Nobody can sign in | Sender domain records, provider with good reputation, resend after 60 seconds, a clear "check spam" line, an alert when the send failure rate rises. |
| Code mail-bombing or guessing | Cost and abuse | Limits in FR-2 and FR-4, proof of work, constant replies. |
| Rate limits trust a spoofable header (SHEL-35) | Limits bypassed when the API is reachable directly | Fix SHEL-35 inside this work; deploy behind the website's proxy only. |
| Two repositories change together | The website and the API drift | The OpenAPI contract is the single source; the flag lets the API ship first. |
| Legal wording not ready | Release blocked | Counsel draft early; the flag stays off until approved. |
