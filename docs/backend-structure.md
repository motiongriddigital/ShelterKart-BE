# Backend folder structure

Where code lives in `backend/`, why, and where new code goes. Written 2026-11-07 after `server.js` (1,853 lines, 67 routes written inline) was split. The split changed no behaviour: the same routes, in the same order where order matters, and every existing test passes unchanged.

## The shape

```
backend/
  server.js            entry: loads .env, builds the app, starts listening, exports the app for tests
  app.js               assembles the app: services, then the request pipeline, then the feature modules, then errors
  middleware/          things that run on requests
    pipeline.js          trust proxy, timing, helmet, CORS, body parsing, CSRF, API contract, HTTP cache, admin rate limit
    limiters.js          every named rate limiter (research, checkout, admin, track, replies ...)
    adminAuth.js         admin Basic auth (constant-time) and requireUuid
    asyncHandler.js      ah(): forwards async errors to Express
    rateLimit.js         the express-rate-limit wrapper
    errors.js            the last handler: no stack traces, no database text
  modules/             one file per feature: its routes, in the order they must be matched
    site.js              robots.txt, sitemap.xml, /api/health
    payments.js          quote, checkout, Razorpay and Dodo verification and webhooks, access
    investigate.js       buyer investigations (/start, /api/investigate, /r/:ref) and the admin investigator
    research.js          search and research, by-ref reads, document check, markets, languages, tracking, recovery
    responses.js         right of reply, corrections, disputes, developer responses
    guides.js            the home-buying guide and the sample reports
    search.js            candidate search mounts (backend/search)
    admin.js             the operator console: costs, engines, tax, source health, reports, analytics, stats, held reports
  services/            shared objects built once at start and handed to modules
    core.js              database pool, error log, audit, report store, accounts, analytics, translation, track()
    pricing.js           price book, buyer resolution, purchase settlement, gating, merchant checkout and reconciliation
    engines.js           AI engine router and its usage history
    registry.js          registry connectors and the nightly health check
    liveReports.js       the paid investigation lifecycle (jobs, spend caps, delivery, resume after restart)
    search.js            the search service
  lib/                 pure helpers with no state (pii.js)
  engine/ engines/ accounts/ payments/ pricing/ search/ social/ marketing/ connectors/
                       domain logic and adapters, unchanged: these already were the "services" layer
  test/                tests; test/fixtures/routes.*.json is the route snapshot
```

## How a request flows

`server.js` -> `app.js` -> `middleware/pipeline.js` (security, parsing, CSRF, contract, cache) -> a module in `modules/` -> domain code in `engine/`, `payments/`, `pricing/` and so on -> `middleware/errors.js` if anything throws.

Shared things are not imported from each other. A service is built in `services/`, added to the shared context `c`, and a module reads what it needs from `c` at the top of its `register(app, c)` function. A service that needs something built later by another service reads it as `c.name` at the moment it is used.

## Rules for new code

- A new route goes in the module of its feature. A new feature gets a new file in `modules/` and one name added to the list in `app.js`.
- Something two modules both need goes in `services/` (if it has state or is built from the environment) or `lib/` (if it is a pure function). Never import one module from another.
- Business rules go in `engine/`, `payments/`, `pricing/` or `accounts/`, not in a route handler. Handlers read the request, call domain code, and write the response.
- SQL stays out of handlers when it can: put it next to the domain code that owns the table. Migrations stay in the `.sql` files in `backend/`.
- Add a route on purpose: regenerate the snapshot and commit it with the change: `node -r ./backend/test/harness/stub-loader.js tools/dump_routes.js bare > backend/test/fixtures/routes.bare.json` (and `accounts` the same way). `test/routes.test.js` fails when a route disappears, appears, or moves behind a route it can overlap with.
- Comments explain why, as before. No emojis, no dead code.

## How this maps to a controllers/services/models layout

The front-end developer's layout (`config`, `controllers`, `middlewares`, `models`, `routes`, `services`, `utils`, `validation`, `app.js`) is the standard layered layout. Here:

| His folder | Here |
|---|---|
| `app.js` | `app.js` |
| `config` | `middleware/pipeline.js` (security and CORS settings) and environment reading in the services |
| `routes` + `controllers` | `modules/<feature>.js` (a route and its handler together, for now) |
| `middlewares` | `middleware/` |
| `services` | `services/` (shared) and `engine/`, `payments/`, `pricing/`, `accounts/` (domain) |
| `models` | not used: the database is PostgreSQL with plain SQL, tables in the `.sql` migrations; there is no ORM |
| `utils` | `lib/` |
| `validation` | `docs/api/openapi.yaml`, enforced by `engine/contract.js` (API_VALIDATION) |
| `sockets` | not applicable: progress streams use Server-Sent Events in `modules/investigate.js` |

## What is not done yet

- Handlers are still written inside the module files, so `modules/payments.js` (about 450 lines) holds the checkout and webhook logic. The next step is to move each handler's logic into a function in the domain folder (checkout first, then the Razorpay and Dodo webhooks) and leave the route as a thin call, one pull request per feature, with the route snapshot and the existing tests as the guard.
- `services/core.js` builds many unrelated things. It can be split once the handlers no longer reach into it directly.
- Moving the whole tree under `src/` was left out on purpose: it touches every test path and the Dockerfile for no gain.
