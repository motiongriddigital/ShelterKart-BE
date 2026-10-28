# ShelterKart backend

ShelterKart judges a new-build property project for a buyer before they pay the developer. A buyer names a project; several AI engines investigate it using official registers and web search; the buyer gets a free preview and pays for the full report: linked findings, each marked verified, reported or inferred, plus the questions to put to each team at the developer. The report never tells anyone whether to buy.

This repository holds the API, the investigation engine, pricing and payments, the database migrations, the shared tooling and the current website files (kept here as test fixtures until the frontend repository takes them over). The product's rules are in [CONSTITUTION.md](CONSTITUTION.md).

## Status

| Works | Not yet proven |
| --- | --- |
| 859 automated checks pass on a clean install; CI runs them, a real-Postgres run with the smoke test, and a Docker image build | Any run with real credentials: Razorpay, Dodo Payments sandbox, a live AI run, e-mail and WhatsApp delivery, the backup restore drill |
| `docker compose up --build` gives a working local stack | A deploy: no hosting target is chosen ([docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)) |
| Local checks on the container: non-root user, health check, Chromium prints a PDF | A real register connector feeding search (see [LATEST.md](LATEST.md) and [HANDOVER.md](HANDOVER.md)) |

## Run it

```
docker compose up --build
curl localhost:4000/api/health
```

This starts PostgreSQL 16 (host port 5440, `DB_PORT` overrides it), applies the migrations, seeds the pricing tables and starts the API on port 4000. Without Docker, with your own Postgres:

```
cd backend && npm ci && cp .env.example .env     # fill in DATABASE_URL and the rest
cd .. && export DATABASE_URL=postgres://user:password@localhost:5432/shelterkart
node tools/migrate.js && node tools/seed_pricing.js
cd backend && npm start
```

The two tools read `DATABASE_URL` from the environment only, not from `.env`; the server reads `.env`.

Never commit `.env` or any key. Only the `.env.example` files are committed.

## Test it

```
python3 -m venv .venv && .venv/bin/pip install -r tools/requirements.txt
cd backend && npm ci && npx playwright install chromium
PATH="$PWD/../.venv/bin:$PATH" npm test
```

The chain runs the logic suites, the harness suites with stubbed services and the browser suites. It expects 859 checks and exit code 0.

## What is where

| Path | Holds |
| --- | --- |
| `backend/server.js` | The Express API: buyer flow, payments, admin, report pages |
| `backend/engine/` | The investigator, dossier, research, registry lane, PDF, delivery, translation, bot guard, analytics |
| `backend/engines/` | The five AI vendor adapters and the router that picks the cheapest qualified one |
| `backend/connectors/` | The register-connector framework and its safety guards |
| `backend/pricing/`, `backend/payments/` | Quotes, tax gate, price book, refunds, provider-neutral payment layer |
| `backend/data/` | Price book, tax profiles, markets, payment routes, playbooks, sample reports, guide |
| `backend/*.sql` | Database migrations; `tools/migrate.js` applies exactly nine of them, the older files are inert |
| `backend/test/` | The test suites |
| `tools/` | Migration and seed scripts, smoke test, benchmarks, golden checks, audit scripts |
| `brand/`, `guide/`, `i18n/` | Design tokens and checks, the buyer guide, nine languages |
| `ops/`, `legal/` | Backup and restore scripts, the legal drafts for counsel |
| `Dockerfile`, `docker-compose.yml`, `.github/workflows/` | Container image, local stack, CI and release |
| `docs/` | Architecture, delivery pipeline, deployment, and `archive/` for historical documents |

## How it works

The diagrams are in [docs/architecture.md](docs/architecture.md): the components, the buyer journey and how a payment is decided. How changes reach production is in [docs/delivery-pipeline.md](docs/delivery-pipeline.md).

## Working on it

Short-lived branches, a pull request for every change, CI must pass: see [CONTRIBUTING.md](CONTRIBUTING.md). The go-live checklist (company, tax registration, merchant approval, legal review, credentials) is in [HANDOVER.md](HANDOVER.md). Older documents (`LAUNCH.md`, the original README and hand-off) are kept for history; where they disagree with `HANDOVER.md` and `LATEST.md`, those two win.
