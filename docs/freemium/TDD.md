# Freemium engine, slice 2: the free preview states: technical design

Companion to `PRD.md`. Written 14 November 2026 after reading `modules/investigate.js`, `services/liveReports.js`, `engine/dossierBrief.js` and the search index.

## 1. What exists today

| Case | Where | What the buyer gets now |
| --- | --- | --- |
| Operator pause (`RESEARCH_PAUSED`, market pause) | `POST /api/investigate`, `pausedReason` | 503 `{ code: "paused", error }` |
| Daily count reached, or `INVESTIGATE_DAILY_CAP=0` | same, `investigateCap()` | 503 `paused`, one shared sentence |
| Daily dollar ceiling (`AI_DAILY_MAX_USD`) | same, `overDailyMax()` | 503 `paused`, the same sentence |
| A market's share reached | same, `marketCap()` | 503 `paused`, a market sentence |
| Too many running | same, concurrency check | 429 `{ error }`, no `code` |
| One account's allowance | same, `INVESTIGATE_PER_USER_DAILY` | 429 `quota` |
| The first sweep fails (every engine failed) | `.catch` after `job.inv.sweep` | `job.status = "failed"`; an SSE `error` event with a generic message; the saved report stays at phase `starting` |
| Report call for that report | `GET /api/report/:ref` | 202 `{ ready: false, phase: "starting" }` for ever |

## 2. Design

A pure module, `engine/previewStates.js`, owns the table of reasons: for each, `status`, `code`, `error` (the sentence), and how to compute `retryAt` from the clock. The routes and the failure handler call it; no route builds its own refusal any more.

```
REASONS = {
  engines_unavailable: { status: null,  code: 'engines_unavailable', error: '...', retry: 'minutes:5' },
  daily_budget:        { status: 503,   code: 'paused', error: existing sentence, retry: 'utc-midnight' },
  daily_cap:           { status: 503,   code: 'paused', error: existing sentence, retry: 'utc-midnight' },
  market_cap:          { status: 503,   code: 'paused', error: existing market sentence, retry: 'utc-midnight' },
  paused:              { status: 503,   code: 'paused', error: the operator's text, retry: null },
  busy:                { status: 429,   code: 'busy',   error: existing sentence, retry: 'minutes:3' },
  quota:               { status: 429,   code: 'quota',  error: existing sentence, retry: 'utc-midnight' },
}
refusal(reason, { now, text }) -> { status, body: { ok: false, code, reason, error, retryAt? } }
failureNote(reason, now)       -> { reason, error, retryAt }
nextUtcMidnight(now)           -> ISO string
```

`error` keeps today's sentence wherever one exists, so a website that shows only the text is unchanged.

## 3. Wiring

1. **Start call** (`modules/investigate.js`): each refusal becomes `const r = refusal(reason, ...); return res.status(r.status).json(r.body); ` and counts itself in the day's counters (`FP.refused[reason]++`). Reuse and twin answers are not refusals and are not counted. `FP.started++` when a new sweep begins.
2. **Failed sweep** (the `.catch` after `job.inv.sweep(...)`): `job.status = "failed"`, `job.failReason = "engines_unavailable"`, `job.previewFailedAt = now`, persisted with the job; `FP.failed++`; the SSE `error` event carries `reason` and `retryAt` (`liveEmit` and `publicEvent` pass them through).
3. **Report call** (`GET /api/report/:ref`): when there is no dossier, look at the live job: a failed, unpaid job answers `200 { ok: true, ready: false, state: "unavailable", ref, phase: "failed", reason, retryAt, error }`; otherwise `202` as before with `state: "working"` added. A paid job that failed keeps its existing handling.
4. **Counters** (`services/liveReports.js`): a small per-day object, reset when the UTC day changes, exposed on the container and added to `GET /api/admin/delivery` as `freePreview`.
5. **Persistence**: `failReason` and `previewFailedAt` are added to the saved job (visible in the saved file and to the operator). A search for the same project again already starts a new attempt (the failed job is skipped by the reuse test); a test pins it.

## 4. Security and privacy

No new personal data. `reason` and `retryAt` are not secrets. The public stream's `error` event carries the same two fields for every viewer (it carries no report content). Counters hold numbers only.

## 5. Failure behaviour

| Situation | Result |
| --- | --- |
| The counters object is missing (a test harness) | the call still answers; counting is skipped |
| `retryAt` cannot be computed | omitted, never invented |
| A failed job is reloaded after a restart with no `failReason` (saved before this change) | treated as `engines_unavailable` |
| A failed preview after a restart | the saved job keeps `failReason`; the report itself (a brief with no dossier) is held in memory, so the report call then answers 404 "not found" and the buyer searches again, which starts a new attempt |

## 6. Testing

1. `previewStates`: every reason maps to its status and code; sentences equal the current ones; `retryAt` for minutes and for UTC midnight (including 23:59:59 and the month end); no `retryAt` for `paused`.
2. Route harness: each refusal returns its reason, status, `code` and `retryAt`, and bumps its counter; a refusal never starts a sweep (the stand-in AI sees no call); reuse is not counted.
3. A failing engine: the sweep fails, the report call answers `state: "unavailable"` with the reason (not 202 for ever), the stream's `error` event carries the reason, a search again starts a fresh attempt that can succeed; a restart keeps the failed state.
4. A working preview is unchanged: 202 `state: "working"` then the report.
5. Admin status shows the day's counts by reason.
6. Mutation checks: reuse counted as refusal; failed shown as working; a code changed on an existing refusal.
