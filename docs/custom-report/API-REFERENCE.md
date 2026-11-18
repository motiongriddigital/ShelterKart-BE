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
| `tier` | `"free"` \| `"paid"` | no, default `"free"` | `free`: Tavily basic depth, 5 results, teaser only. `paid`: advanced depth, 8 results, full sections + sources |

**Response `200`**
```json
{
  "ok": true,
  "ref": "CR-3F9A2B1C7E0D",
  "tier": "free",
  "query": "Hubtown Celeste Mumbai",
  "summary": "string",
  "highlights": ["string"],
  "sections": [{ "heading": "string", "body": "string", "sourceUrls": ["https://..."] }],
  "sources": [{ "title": "string", "url": "https://..." }],
  "searchedResultCount": 5,
  "generatedAt": "2026-11-18T10:00:00.000Z"
}
```
`sections`/`sources` are always `[]` for `tier: "free"`. Every URL in `sourceUrls`/`sources` is guaranteed to be a
URL Tavily actually returned (anything Groq invents is dropped).

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
