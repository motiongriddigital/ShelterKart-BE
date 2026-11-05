# ShelterKart API contract

`openapi.yaml` in this folder is the HTTP contract of `backend/server.js`, written in OpenAPI 3.1. It was written from the code and checked against a locally running server (no database, no AI engine, no payment provider) for every status code and error body that does not need one of those. Where a response is large or could not be exercised, the description says "shape not fully documented" instead of guessing.

The code is the source of truth. If the two disagree, the contract is wrong.

## How to read the contract

- One path item per route, one operation per method. `x-source` is the line in `backend/server.js` where the route is registered. `x-rate-limit` names the limiter in front of the handler (none means none).
- `security` states who may call it. `security: []` means public. A list with `{}` first means the credential is optional (the report is the free preview without it).
- Every operation lists a 403 for the CORS refusal. It is the same response everywhere and comes from middleware, not from the handler.
- Error bodies are `{ "ok": false, "error": "..." }`. Some add `code`, `reason`, `requote` or `country`. Exceptions are called out in the operation (for example `GET /api/admin/stats` and `GET /api/developer-response/{reportRef}` have no `ok` field on success, and `POST /api/track` and the event stream return a bare `{ "ok": false }` on 400).
- The six retired paths are registered with `app.all`, so each answers 410 to every method. The contract lists GET, POST, PUT, PATCH and DELETE for each. These 30 operations are the only ones without a 2xx response.
- Route count: 58 routes are registered with `app.get` or `app.post` in `server.js`, and the contract has 58 operations for them. The six retired paths are one more registration (`app.all`). To recount: `grep -cE "app\.(get|post|put|patch|delete)\(" backend/server.js` prints 58.
- Validate with `npx --yes @redocly/cli@latest lint docs/api/openapi.yaml`.

## Authentication

| Scheme | Used by | How |
|---|---|---|
| none | search, quote, checkout, tracking, disputes, replies, health, reference data, guide, samples, SEO | Public. Cost is limited by rate limiters, the daily research cap and the proof of work, not by credentials. |
| access token | `X-Report-Access` header, or `t` query parameter on pages and the event stream | A signed token for one report reference, valid 30 days, issued after payment. Without it the report is the free preview. `GET /r/{ref}/pdf` requires it. |
| admin Basic | every `/api/admin/*` route | HTTP Basic against `ADMIN_USERNAME` and `ADMIN_PASSWORD`. 503 if either is unset. Also behind `adminLimiter`: 20 requests per 15 minutes per IP, counting successful requests. |
| webhook signature | the three `/api/payments/*webhook` routes | Razorpay: `X-Razorpay-Signature`. Merchant of Record (Dodo): `webhook-id`, `webhook-timestamp`, `webhook-signature`. Generic: `X-SK-Signature`. Each is an HMAC over the exact raw body. |

Webhook routes use `express.raw` and are listed in `OWN_BODY_PARSER` so that the global JSON parser skips them. The raw bytes are what is signed. No JSON parser, and no proxy or middleware that re-serialises the body, may sit in front of them.

## CORS, API_BASE, ALLOWED_ORIGINS and PUBLIC_BASE_URL

These four settings must agree. What the code does:

- The browser pages (`shelterkart-frontend.html` and `admin.html`) have `const API_BASE = ""` and call `API_BASE + '/api/...'`. Empty means demo mode. Set it to the API's origin with no trailing slash, in both files. `LAUNCH.md` shows `https://api.your-domain.com`.
- `ALLOWED_ORIGINS` is a comma-separated list of exact origins (scheme, host, port; no path, no trailing slash, no wildcard). The server compares the request's `Origin` header to that list as plain strings. A request with no `Origin` header always passes.
- A request with an `Origin` that is not listed gets 403 `{ "ok": false, "error": "Origin not allowed" }` from every route, including GET pages. In production an empty list refuses everything that carries an `Origin`; outside production an empty list allows everything.
- The list must therefore contain the origin of the website, the origin that serves `admin.html`, and the API's own origin. The API's own origin is needed because `/start` and `/r/{ref}` are served by the API and their script posts back to the API with relative URLs, and browsers send an `Origin` header on same-origin POST requests. This was verified against a local server: a POST with `Origin` equal to the server's own address and an `ALLOWED_ORIGINS` that did not list it returned 403.
- The cors middleware is configured with only the origin check. Allowed methods are the library default (GET, HEAD, PUT, PATCH, POST, DELETE), allowed request headers are echoed from the preflight request (so `X-Report-Access`, `Authorization` and `Content-Type` work), credentials are not enabled, and no response headers are exposed. A browser script on another origin therefore cannot read `Retry-After`, `RateLimit-*` or `Content-Disposition`.
- `PUBLIC_BASE_URL` (falling back to `SITE_URL`) is one origin, used for three things: the `Sitemap:` line in `robots.txt` and every URL in `sitemap.xml`; the link e-mailed or sent by WhatsApp to the buyer, `{PUBLIC_BASE_URL}/r/{ref}?t={token}`; and the merchant checkout's return and cancel addresses, `{PUBLIC_BASE_URL}/?sk_ref={ref}&sk_purchase={purchaseId}`. The first two assume it serves the backend's pages (`/r/...`, `/samples/...`, `/guide`) and the sitemap also lists the static website pages; the third assumes it serves the website's home page. With the website and the API on different origins those cannot all be true. This is listed under "needs a human" below.
- Without `PUBLIC_BASE_URL`, `GET /sitemap.xml` answers 404 and the merchant checkout cannot start (503 "Payment could not be started right now").

## Who calls what

Routes the website (`shelterkart-frontend.html`) calls with `API_BASE`:

- Search and report: `POST /api/research`, `GET /api/research/by-ref/{ref}`, `GET /api/research/challenge`, `POST /api/investigate`, `POST /api/research/document-check`.
- Sale: `GET /api/pricing/countries`, `POST /api/research/quote`, `POST /api/research/checkout`, `POST /api/research/razorpay/verify`, `POST /api/research/access`, `POST /api/research/recover`.
- Other: `POST /api/track`, `POST /api/dispute`, `POST /api/developer-response`, `GET /api/developer-response/{reportRef}`, and a HEAD request to `/guide/pdf`.
- Browser navigations to the API: `/r/{ref}`, `/samples/{id}`, `/guide`.

Server-rendered pages and their helpers (opened by navigation, not called from the website's script): `/start`, `/r/{ref}`, `/r/{ref}/pdf`, `/samples/{id}`, `/samples/{id}/pdf`, `/guide`, `/guide/pdf`, `/guide/card.png`, `/guide/card.pdf`, `/assets/report-live.js`. The scripts inside `/start` and `/r/{ref}` call `POST /api/investigate`, `GET /api/investigate/{ref}/events`, `POST /api/investigate/{ref}/contact`, `GET /api/research/challenge`, `POST /api/research/quote`, `POST /api/research/checkout` and `POST /api/research/razorpay/verify` on their own origin.

Admin only (`/api/admin/*`, Basic auth):

- Called by `admin.html`: `stats`, `analytics`, `engines`, `tax`, `reports`, `reports/{ref}`, `disputes`, `disputes/{id}/resolve`, `responses`, `responses/{id}/approve|reject`, `held`, `held/{ref}/approve`, `source-health`, `source-health/run`.
- Not called by `admin.html`: `costs`, `delivery`, `purge`, `refunds`, and the four `investigate` routes.

Provider only: `POST /api/payments/razorpay/webhook`, `POST /api/payments/mor/webhook`, `POST /api/payments/webhook`.

Not called by either page: `GET /api/health` (the CI smoke test uses it), `GET /api/markets`, `GET /api/languages`, `GET /robots.txt`, `GET /sitemap.xml`, and the retired routes.

## Not documented, or needs a human

Shapes not fully documented:

- The report (`brief`) and the investigator `dossier`. Top-level fields are listed; nested objects (`registry`, `protections`, `reading`, `questions`, `responsible`, the dossier's checks) are produced by the research engine and are not described.
- `GET /api/admin/analytics` element shapes, `GET /api/admin/engines` (`usage`, role plans), `GET /api/admin/tax` (`progress`, `off`), `GET /api/admin/delivery` (`recent`), the review record returned by `POST /api/admin/held/{ref}/approve`, and the results of `POST /api/admin/source-health/run`.
- The event types on the investigation streams beyond `progress`, `error` and `done`.
- The bodies the payment providers send to the webhooks. They belong to Razorpay and Dodo.
- `reason` values for `not_on_sale`. Three were seen on a running server (`no_payment_route`, `registration_required`, `unverified`); the full list is in `backend/pricing/`.

Not exercised against a running server (read from the code only): the success paths of `POST /api/research` (needs an AI engine key), quote, checkout, razorpay verify, access, recover, document-check, refunds, held, the webhooks' settlement paths, and the PDF routes (need a database, a payment provider, an AI engine or the PDF renderer). Status codes and messages for those come from reading the handlers. Everything that does not need them (validation errors, 4xx and 503 guards, admin auth, rate limit bodies, CORS, health, reference data, pages, SEO, retired routes) was run.

Observations that need a human decision or a code change (the contract documents the behaviour as it is; nothing was changed in the code):

1. `PUBLIC_BASE_URL` serves two different roles (see above) and cannot be satisfied by split origins as the code stands.
2. `POST /api/payments/webhook`: a request whose `Content-Type` is not `application/json` throws inside an async handler and, on Node 23, ended the whole server process (verified locally). The other two webhooks answer 401.
3. Malformed JSON and bodies over 10 kb on any JSON route return 500 `Internal server error`, not 400 or 413, because the generic error handler ignores the error's status.
4. `POST /api/investigate/{ref}/contact` needs no token. Anyone who knows a report reference can set the contact that the finished report is delivered to.
5. `adminLimiter` counts every admin request, not only failed logins: 20 per 15 minutes per IP. Whether `admin.html` stays under that on a full refresh was not measured.
6. Helmet sends `Cross-Origin-Resource-Policy: same-origin` on every response, including `/guide/card.png`. A cross-origin `<img>` that points at the API would be blocked by the browser; fetch with CORS and navigation are not affected. Not tested in a browser.
7. The guide page's `og:image` is the fixed address `https://shelterkart.com/guide/card.png`, whatever `PUBLIC_BASE_URL` is.
8. A comment above `POST /api/track` says four event names are accepted; the code accepts seven.
9. In `POST /api/admin/investigate`, the failure alert text reads `job.ref`, which the admin job does not have, so the e-mail says "Report undefined".
10. State that lives in process memory: rate limit counters, the proof-of-work token replay set, running investigations, the daily research and investigation counters. The code comments assume one server instance. Behaviour behind more than one instance was not examined.
11. Rate limits, IP bans and the sign-in log key on `req.ip`. How much of `X-Forwarded-For` is believed is set by `TRUST_PROXY` (SHEL-35): unset means none (the connecting address is the client, a forged header changes nothing), a number means that many proxies in front, or a list of proxy addresses or named ranges (`loopback`, `10.0.0.0/8`). `true` is refused. Behind a load balancer it must be set, otherwise every client shares the balancer's address and one limit.
12. The static website pages named in the sitemap (`/`, `about.html`, and so on) are not served by this backend.
13. The contract is hand-written and there is no automated drift check in CI. The recount command above and the Control Room route list are the only checks used.
