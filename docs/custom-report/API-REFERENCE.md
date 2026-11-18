# Custom report pipeline: API reference

Tavily (search) + Groq (formatting), free tiers on both. Separate from `/api/research` and `/api/investigate` and
their multi-engine panel — see `backend/custom/*` and `backend/modules/customResearch.js`. Reports live in memory
only (24h TTL); PDF printing reuses the existing free, self-hosted Playwright printer (`engine/pdf.js`), no paid
PDF service.

## `POST /api/custom/research`
Runs the search and generates the report in one call.

**Body**
| Field | Type | Required | Notes |
|---|---|---|---|
| `query` | string | yes | Property, builder, or location name |
| `location` | string | no | Appended to the search query |
| `market` | string | no | Appended to the search query |
| `tier` | `"free"` \| `"paid"` | no, default `"free"` | Both tiers return the same fields below. `free`: Tavily basic depth, 5 results, smaller caps. `paid`: advanced depth, 8 results, higher caps (richer report) |

**Response `200`**
```json
{
  "ok": true,
  "ref": "CR-3F9A2B1C7E0D",
  "tier": "free",
  "query": "Hubtown Celeste Mumbai",
  "summary": "string",
  "highlights": ["string"],
  "keyFacts": [{ "label": "string", "value": "string", "sourceUrl": "https://..." }],
  "differences": [{
    "title": "string",
    "category": "string",
    "sellerClaim": { "value": "string", "detail": "string", "sourceUrl": "https://... or null" },
    "officialRecord": { "value": "string", "detail": "string", "sourceUrl": "https://..." },
    "impact": "string"
  }],
  "questions": [{
    "category": "string",
    "question": "string",
    "whyItMatters": "string",
    "goodAnswer": "string",
    "redFlag": "string",
    "priority": "top" | "standard"
  }],
  "pricing": [{ "label": "string", "size": "string", "quotedPrice": "string", "benchmarkPrice": "string", "differenceNote": "string", "sourceUrl": "https://..." }],
  "sources": [{ "name": "string", "detail": "string", "status": "confirmed" | "disagree" | "reported", "url": "https://..." }],
  "counts": { "sourcesChecked": 5, "confirmedFacts": 1, "differencesFound": 2, "questionsToAsk": 4 },
  "searchedResultCount": 5,
  "generatedAt": "2026-11-18T10:00:00.000Z"
}
```
Every `sourceUrl`/`url` in the response is guaranteed to be a URL Tavily actually returned for this query — a
`differences` entry is dropped entirely if its `officialRecord.sourceUrl` isn't grounded this way (its
`sellerClaim.sourceUrl` may legitimately be `null` — general marketing claims often aren't tied to one URL); a
`keyFacts`/`pricing`/`sources` entry is dropped if its `sourceUrl`/`url` isn't grounded. `questions` need no
grounding since they're the model's own analytical judgment, not factual claims. Caps per tier (array lengths,
enforced server-side after the model replies): `free` — 4 keyFacts, 3 differences, 8 questions, 2 pricing, 6
sources; `paid` — 6 keyFacts, 5 differences, 12 questions, 4 pricing, 10 sources. `counts` is computed from the
(already-filtered) arrays, not asked of the model, so it can't drift from what's actually in the response.

**Errors** — all `{ "ok": false, "code": "...", "error": "..." }`
| Status | Code | When |
|---|---|---|
| 400 | `invalid_query` | `query` missing/empty |
| 503 | `tavily_unconfigured` | `TAVILY_API_KEY` not set |
| 502 | `tavily_unreachable` / `tavily_error` | network failure / Tavily returned an error after one retry |
| 503 | `groq_unconfigured` | `GROQ_API_KEY` not set |
| 502 | `groq_unreachable` / `groq_error` / `groq_empty` / `groq_bad_json` | network failure / Groq error / empty or non-JSON reply |

## `GET /api/custom/research/:ref`
Re-fetches a previously generated report (e.g. after the PDF link is shared).

**Response `200`** — same shape as the `POST` response above.
**Response `404`** — `{ "ok": false, "code": "not_found", "error": "No report found for that reference." }`

## `GET /api/custom/research/:ref/pdf`
Renders the stored report as a PDF.

**Response `200`** — `application/pdf`, `Content-Disposition: attachment; filename="<ref>.pdf"`
**Response `404`** — unknown ref, same shape as above
**Response `503`** — `{ "ok": false, "code": "pdf_unavailable", "error": "..." }` if Chromium/Playwright isn't installed on this server

---

### Known limitations (v1, by design)
- No sign-in/payment gating yet — `tier` is just a request parameter, not enforced by a purchase.
- In-memory storage only — a server restart loses all generated reports.
- Both Tavily and Groq are called on their free tiers; no retry beyond one attempt, so a sustained rate-limit
  (free-tier quota) will surface as a `502`/`503` rather than queuing.
