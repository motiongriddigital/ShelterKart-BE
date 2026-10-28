# What the old static website did, and what the new frontend must do

The old website (`shelterkart-frontend.html`, the static pages, `admin.html`) was removed from this repository. Its last version is the git tag `static-site-last` (`git checkout static-site-last`), and the original delivery is archived outside the repository. This list is for the frontend repository: each item is something the backend still expects the website to do, or something that only existed in the old files. It was written from reading the code, so check each line against the backend before relying on it.

## The backend still serves

- The API under `/api/*` (contract in [docs/api/openapi.yaml](api/openapi.yaml)).
- Server-rendered report pages and PDFs: `/start`, `/r/:ref`, `/r/:ref/pdf`, `/samples/:id` and `/samples/:id/pdf`.
- The buyer guide: `/guide`, `/guide/pdf`, `/guide/card.pdf`, `/guide/card.png`.
- `/robots.txt` and `/sitemap.xml`. The sitemap lists pages such as `/about.html` and `/pricing.html`, which now live on the frontend; the list in `backend/server.js` (`PUBLIC_PAGES`) must be updated to the frontend's real paths.

## What the old website did that the new one must now do

1. **Serve `/share-card.png`.** Report pages (`backend/engine/dossierHtml.js`) set `og:image` to `PUBLIC_BASE_URL + /share-card.png`. The image is built by `brand/build_brand.py` (`brand/dist/share-card.png`, 1200 by 630).
2. **Policy and information pages**: about, contact, corrections, delivery, evidence, independence, methodology, pricing, privacy, refunds, terms. Razorpay checks the pricing, refund, terms and privacy pages before issuing live keys, and the policy pages showed "not ready to publish" until `tools/business.json` (legal name, address, grievance officer) is filled in. The terms and privacy text lived in the old page; the legal drafts for counsel are in `legal/`. Get the current text from the tag.
3. **The proof of work before a new investigation.** `GET /api/research/challenge` returns a signed puzzle; the browser must find a short string `s` so that the SHA-256 of `token + ":" + s` has at least `bits` leading zero bits (try `s` = 0, 1, 2 ... in base 36), then send `{ token, solution }` with the research request. The old page did this in `skSolvePow`; the server side is `backend/engine/botguard.js`.
4. **The buyer flow**: search, free preview, quote, checkout with Razorpay (India) or the merchant of record (elsewhere), access token, full report, restore access, developer right of reply, dispute. The routes and their auth are in the OpenAPI contract.
5. **The market list.** 36 markets in `backend/engine/markets.js` with their languages (`backend/engine/languages.js`) and `GET /api/markets`; the old page also drew a flag for each and ordered them largest first by market size.
6. **Languages.** Nine interface languages in `i18n/*.json` (English plus eight AI-checked translations; review status in `i18n/REVIEW.md`); reports stay in English and the site says so; the legal pop-ups were English only until a lawyer has reviewed a translation; Arabic is right to left while an embedded English report stays left to right.
7. **Analytics events** posted to `POST /api/track`; the events the backend counts are in `backend/engine/analytics.js`. What the old page promised about cookies and personal data is in its privacy text (in the tag); the new site must make the same or a better promise.
8. **The admin dashboard** (`admin.html`): it called the `/api/admin/*` routes with HTTP Basic auth and showed reports, disputes, replies, held negative findings, costs, tax exposure, AI engines, source health and the success metrics.
9. **The service worker and the web app manifest** (`sw.js`, `manifest.json`), if the new site should stay installable.
10. **Accessibility and layout work** the old site had been tested for: contrast of every state, 44 pixel touch targets, no sideways scrolling at 360 to 1920 pixels, voice search with confirmation. The browser scripts that checked this are in the tag.

## Settings that must agree

`API_BASE` (the frontend) with `ALLOWED_ORIGINS` and `PUBLIC_BASE_URL` (the backend). The backend's report pages call the API from their own origin, so `ALLOWED_ORIGINS` must include the backend's own address too. See the "needs a human" list in [docs/api/README.md](api/README.md).
