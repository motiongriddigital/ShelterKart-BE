> Historical document from the delivery of 2026-10-24. Parts are out of date (for example it describes a stubbed backend); the current state is in README.md, HANDOVER.md and LATEST.md.

# ShelterKart — Where Things Actually Stand
### A complete, honest handoff for whoever you hire next

---

## 1. What ShelterKart is

**The one-line version:** CIBIL for real estate. A buyer searches a
developer or a specific project; gets a free Trust Score and verdict
built entirely from public regulatory records; pays a small flat fee to
unlock the full findings (litigation, delivery history, financial
health, a drafted list of questions to bring to the sales office); can
subscribe for ongoing monitoring through possession.

**Non-negotiables, per the founder brief this was built against:**
- No score can ever be bought, raised, or suppressed by a developer, at
  any subscription tier.
- Every claim traces to a specific public source, or is explicitly
  flagged as an unverified public claim excluded from the score.
- Scope is **new-build, primary sales, direct from developer only** —
  not resale, not secondary market, not land.
- AI is a last-mile synthesis layer over verified records, never the
  source of a fact, and never called more than necessary (see the
  cost-tier logic in §3).

---

## 2. What exists right now — no mismatches, checked line by line

### The frontend (`shelterkart-frontend.html`)
**Fully real:** every UI interaction, every score calculation, the
free/paid gating logic, OTP flow UI, payment flow UI, search with typo
correction and disambiguation, accessibility (keyboard nav, focus
management, WCAG-AA contrast), the PDF-style report layout, the
shareable score card generator (canvas-based, real, produces an actual
PNG), mobile-responsive CSS. This is production-quality *frontend
engineering* — a developer can build on top of it with confidence.

**Entirely demo:** all developer/project data (7 developers, 9 projects
across India/UAE/UK/Singapore/Canada/Malaysia) lives in a hardcoded
JavaScript object in the file itself. Search is a client-side fuzzy
match (Fuse.js) over that ~16-entity list — **there is no database, no
live registry connection, and no AI call anywhere in this file.** The
"researching..." animation during search is a fixed `setTimeout` delay,
not a real pipeline running. Confirmed: zero references to any AI
provider anywhere in the codebase.

### The backend (`backend/server.js`, `schema.sql`)
**Real:** the Postgres schema, the dual-scoring formulas (company vs.
project, with the 85/15 project-inherits-from-company weighting), the
smart-cache-recheck logic (re-verify cheaply before re-running anything
expensive), rate limiting, CORS lockdown, input validation, the
OTP-issuance flow structure, the Stripe/Razorpay checkout *scaffolding*.

**Not real / stubbed:** `/api/report/:type/:id` returns HTTP 501 — there
is no data pipeline behind it. SMS sending, email delivery, WhatsApp
delivery, and the actual payment provider calls are all marked `TODO`
in the code. Most importantly: **`const API_BASE = ""` in the
frontend — the two are not even connected to each other right now.**
The frontend has never made a single real call to this backend.

### Everything else
A PDF report generator (Python script, for demo/reference purposes —
not wired into the live product), a logo (SVG master + PNG), and this
document.

---

## 3. What has to be built before this can go live

In the order I'd actually do them — not because a developer must follow
this exact sequence, but because each phase makes the next one testable:

### Phase 0 — Wire what already exists together
- Deploy `backend/server.js` + Postgres somewhere real (Railway, Render,
  a small VPS — doesn't need to be fancy yet).
- Set `API_BASE` in the frontend to point at it.
- Confirm OTP-issuance, checkout-recording, and dispute-submission
  actually round-trip through the real API instead of the current
  demo-mode branches.
- This alone doesn't add data — it just makes the plumbing real.

### Phase 1 — The one hard part: a real data pipeline for a first market
This is the actual work of the company, and it's genuine data
engineering, not a coding task that can be estimated in developer-days
alone:
- Pick one launch market (Mumbai/MahaRERA is the obvious first choice
  given the existing demo content).
- Build a connector that pulls structured filings (registration status,
  litigation records, OC status) from MahaRERA's public portal —
  scraping or an official data-sharing arrangement if one exists.
- Only once that's flowing should the AI synthesis layer (Tier 2 in the
  cost model already coded into `server.js`'s comments) get wired in —
  its job is to turn retrieved documents into plain language, never to
  originate a fact.
- Everything else in this plan is meaningless without this step working
  for at least one city.

### Phase 2 — The integrations you specifically asked about
- **SMS**: MSG91 (India) or Twilio (international) account, wired into
  `/api/send-otp` where the `TODO` already marks the spot.
- **Email**: SendGrid or Postmark, for report delivery and receipts —
  currently has no code at all, needs building from scratch.
- **WhatsApp**: WhatsApp Business API (Meta) or a simpler
  click-to-chat/hosted-link approach for delivering the PDF — also
  needs building from scratch.
- **Payments**: Razorpay (India) / Stripe (international) — the
  checkout *records* are already wired; only the actual provider SDK
  call and webhook handling are stubbed.
- **PDF generation**: needs a real, automated renderer (headless
  Chrome/Puppeteer is the standard choice) that turns a report into a
  branded PDF on demand — the Python script I built is a one-off
  reference, not this.

### Phase 3 — Everything that isn't code
- **Legal review of the Terms & Conditions and Privacy Policy** — what
  exists in the live site is placeholder-quality language I wrote for a
  working demo, not something reviewed by a lawyer. This has to happen
  before real money or real personal data (phone numbers, emails) moves
  through the system.
- **A domain, real hosting, SSL** — the basics.
- **A decision on your bank account / payout setup** with whichever
  payment provider you choose.

---

## 4. What to tell a developer you're hiring

Hand them this document plus the codebase, and the honest scope is:

> "The frontend is done and doesn't need a rebuild — treat it as a spec
> for how the product should behave, and wire it to real data instead of
> the demo objects inside it. The backend is a real skeleton, not a
> prototype to throw away — the scoring math, caching strategy, and
> security model are already correct; it needs a real data pipeline
> behind `/api/report`, and SMS/email/WhatsApp/payment providers wired
> into the TODOs already marked in the code. The single hardest and
> most important piece is the MahaRERA data connector for the first
> launch city — budget that as its own project, not a line item."

---

## 5. Country expansion — verified, updated with two more confirmed today

**Currently represented in the demo** (India, UAE, UK, Singapore,
Canada, Malaysia) — each has *some* real public disclosure regime
behind the concept, but none has an actual live connector built — see
Phase 1 above.

**Confirmed via live search, genuinely strong candidates:**
- **Saudi Arabia** — REGA's "Wafi" platform: licenses off-plan
  developers, mandates escrow, public verification of license + escrow
  account. Real and structured.
- **Qatar** — Aqarat (Real Estate Regulatory Authority) runs a real
  estate developers' registry with periodic renewal, an escrow-account
  law (Law No. 6 of 2014, amended 2023), and a licensing committee —
  confirmed via search just now. Genuinely comparable in structure to
  UAE's DLD/RERA.
- **Bahrain** — its own RERA (Real Estate Regulatory Authority, under
  a 2017 law) runs a developer register with mandatory reporting,
  escrow-account trustees, and real penalties for non-compliance —
  confirmed via search just now. A national registry platform (not yet
  clear how much of it is public-facing vs. regulator-internal — worth
  a developer confirming before committing).
- **Kuwait and Oman** — same GCC regulatory wave is underway across
  both (per the Trowers & Hamlins summary found in the same search),
  but I have not verified either one specifically enough to recommend
  them at the same confidence as Qatar/Bahrain/Saudi yet.
- **Hong Kong** — the First-hand Sales of Residential Properties
  Ordinance requires public sales brochures with real disclosure depth;
  plausible, not yet verified as deeply as the GCC states above.

**Confirmed harder — same reason the USA was excluded originally:**
- **Australia** — state-by-state, same fragmentation as the US. NSW
  specifically has a strong public register (Residential Apartment
  Buildings Act orders) — a Sydney-first approach is plausible, a
  national launch is not as one effort.

**Updated recommendation**: the GCC region as a whole — UAE (already
live), Saudi Arabia, Qatar, Bahrain — is the strongest coherent next
step, not just Saudi Arabia alone. Four markets that share a broadly
similar regulatory pattern (licensing + mandatory escrow + a named
regulator) are cheaper to build a second, third, and fourth connector
for than four unrelated markets would be — the schema-mapping work
from the first GCC connector partly transfers to the next one.

## 6. Coverage honesty — adopting a better model than "live / not live"

A binary "this country is live, this one isn't" list is honest, but a
better version of the same honesty — worth adopting now, before more
countries get added — is a **coverage level shown per search result**,
not just per country:

| Level | Meaning |
|---|---|
| **Full** | A real connector exists; findings are cited to specific filings |
| **Partial** | Some structured data exists; gaps are explicitly named, not hidden |
| **Insufficient** | Searchable, but the honest answer is "not enough public data to score" |

This is strictly better than today's "4 live countries, nothing else
exists" model for one reason: it lets the product be honestly
*searchable* everywhere without ever pretending depth that isn't there.
The site currently doesn't distinguish this — everything shown is
implicitly "Full." Worth building once a second real connector exists
and there's an actual "Partial" case to show; premature before that.

## 7. The Constitution

A one-page, permanent set of rules — trust can't be purchased, every
statement is labeled Fact/Inference/Opinion/Prediction, corrections are
never silent, AI's exact permissions — now lives in `CONSTITUTION.md`
alongside this document. It's short on purpose: a governance document
nobody actually re-reads doesn't govern anything.

## 8. A brainstorm session was reviewed — here's the disposition

A separate AI brainstorm (10 "Bibles," 40+ pages, hundreds of named AI
agents, a full rewrite on Next.js/NestJS/Neo4j/Kubernetes) was reviewed
in full. Adopted vs. not, for a clean record:

**Adopted:**
- Coverage-tier honesty model (§6 above) — genuinely better than a
  binary live/not-live list.
- Fact / Inference / Opinion / Prediction as an explicit labeling
  discipline — folded into `CONSTITUTION.md`, rule 2.
- A short, permanent Constitution — but one page, not ten volumes.
- Qatar and Bahrain added to the verified-candidate list (§5).

**Rejected, with reasons:**
- **Rebuilding the frontend from scratch** ("archive as Prototype V0").
  The current build is real, tested (see the DOM-stub runtime suite),
  accessible, and legally reasoned. Discarding working, verified code
  to start over on a heavier stack, before a single real data
  connector exists, is the single most common way solo-founder
  projects stall permanently. Rejected outright.
- **Hundreds of named AI agents / a full "AI Operating System" org
  chart.** Multi-model cross-validation (already adopted two rounds
  ago) is real and useful. A Chief Marketing AI reporting to a Chief
  Executive AI is organizational theater for a company pre-first-launch.
- **Microservices, Neo4j, Kubernetes, Kafka, six databases.**
  Infrastructure sized for a company with real scale and real traffic.
  Postgres and one well-organized backend is correct for one market
  and a handful of users — not a compromise, the right call at this
  stage.
- **A "would ShelterKart buy this?" yes/no verdict.** This is
  investment advice dressed as a trust score, and a materially worse
  legal position than a neutral score with a labeled opinion. The
  underlying instinct (make the takeaway feel personal) is fine; the
  yes/no framing isn't.
- **"195 countries, day one," even with confidence tiers.** If ~190 of
  those return "insufficient evidence" on every search, that's the same
  disclaimer 190 times, not a global product. Searchable everywhere,
  honest about depth where real data exists — yes. Claiming day-one
  global coverage — no.



---

## Paywall integrity — server-side gating (added)

**The defect.** The demo frontend ships every paid finding in the
client bundle (`PROJECTS` — 16,648 bytes, 45 paid findings) and decides
what to display from a `localStorage` boolean. Two bypasses, both one
line in devtools:

```js
localStorage.setItem('sk_unlocked_reports',
  JSON.stringify([{type:'project',id:'lodha-park',ref:'X',unlockedAt:Date.now()}]))
console.log(PROJECTS['lodha-park'])   // or skip the UI entirely
```

No frontend change can fix this. A gate the client evaluates is not a
gate. The revenue loss is the obvious half; the half that matters more
is that CONSTITUTION.md treats a report as a traceable artifact tied to
an identified buyer. Anonymous extraction destroys the audit trail —
there is no record of who holds which version of which finding, so a
later correction cannot be delivered to whoever relied on the
superseded one.

**What was built.** `GET /api/report/:type/:id` now resolves the caller
from a signed session cookie (not a header or query param the client
can set), checks the `entitlements` table server-side, and returns paid
fields only on an active entitlement.

Redaction happens at the source via `FREE_FIELDS`, an **allow-list**:
the unentitled response is constructed from permitted keys rather than
having paid keys stripped out of a full object. Verified — zero paid
values survive into an unentitled response, and a paid field added in
future is withheld by default. That is the safe direction to fail; a
deny-list leaks every field someone forgets to add to it.

**What is still open.** The demo frontend continues to hold data
client-side, because it runs with `API_BASE = ""` and has no server to
ask. The gate is real but unreached until the frontend is wired to the
API. Until then, treat the demo as a public preview and assume every
value in it is disclosed.

Order of operations when connecting:
1. Issue signed session cookies on OTP verification (`SESSION_SECRET`
   is already required at boot).
2. Insert `entitlements` rows only from a verified payment webhook —
   never from a client call.
3. Remove `DEVELOPERS` / `PROJECTS` from the bundle; fetch from
   `/api/report/...` instead.
4. Only then is the paywall real.
