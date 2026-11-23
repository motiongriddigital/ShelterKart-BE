# Freemium engine, slice 2: what the website side does

For the front-end developer. Additive: nothing breaks if the website ignores these fields. Written 14 November 2026.

## 1. The start call (`POST /api/investigate`)

A refusal now always has this shape (the status code and the old `code` values are unchanged):

```json
{ "ok": false, "code": "paused", "reason": "daily_budget", "error": "New investigations are paused for today. Projects already investigated are still available.", "retryAt": "2026-11-15T00:00:00.000Z" }
```

| `reason` | Status | Say | When to offer a retry |
| --- | --- | --- | --- |
| `daily_budget`, `daily_cap`, `market_cap` | 503 | "Free previews are paused for today. Projects already checked are still open. Try again after (time)." | at `retryAt` |
| `paused` | 503 | The `error` text as given | no time known |
| `busy` | 429 | "Many searches are running. Try again in a few minutes." | at `retryAt` |
| `quota` | 429 | "You have used today's free searches. Projects already checked are still open to you." | at `retryAt` |

`retryAt` is a hint (an ISO time in UTC), not a promise.

## 2. A search that started and then could not run

The start call answered 202 with a `ref`. If the research then fails, the report call (`GET /api/report/:ref`) used to say "not ready" for ever. It now answers:

- still working: `202 { ok: true, ready: false, state: "working", ref, phase }` (as before, plus `state`)
- failed: `200 { ok: true, ready: false, state: "unavailable", ref, phase: "failed", reason: "engines_unavailable", error, retryAt }`

A search that was still running when the server restarted (every deploy does this) is settled the same way, with `reason: "restarted"`: "The server was restarted while this search was running. Nothing was charged. Please search again." `retryAt` is now, so "Search again" can be offered at once. The progress stream sends one `error` event with that reason and ends.

On `state: "unavailable"`: stop polling, say "We could not run this search just now. Nothing was charged. Try again in a few minutes." and offer "Search again" (a new start call works; it starts a fresh attempt). The progress stream's `error` event carries the same `reason` and `retryAt`.

## 3. Pages the back end serves

The report page and its live script already show the failure sentence; they will also say "try again after (time)" when `retryAt` is present. Nothing to build there.

## 4. Tests worth having

The message for each `reason`; polling stops on `state: "unavailable"`; "Search again" starts a new search.
