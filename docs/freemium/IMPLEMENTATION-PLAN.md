# Freemium engine, slice 2: implementation plan and status

Written 14 November 2026. Requirements in `PRD.md`, design in `TDD.md`.

## Slices

| # | Slice | Tests | Status |
| --- | --- | --- | --- |
| F1 | `engine/previewStates.js`: the reasons table, `refusal`, `failureNote`, day counters | `test/previewstates.test.js` (8) | built |
| F2 | Start call uses the table; counters; busy gains `code: "busy"` | `test/harness/preview-states.test.js` | built |
| F3 | Failed sweep recorded and persisted; report call `state`; stream error event; admin status | `test/harness/preview-states.test.js` (19 checks) | built |
| F4 | OpenAPI, docs status, local CI | contract tests, local CI | built |

## Not built, with the reason

The preview with no AI from the registers (PRD section 7: a register lookup needs the developer's legal name and the project index is empty at launch), a "notify me" e-mail (privacy decision), slice 3 (needs the owner's Gemini key) and slice 4 (the owner's judgement of the default).

## Verification

| Req | What | Verified by |
| --- | --- | --- |
| FR-1, FR-2 | refusal shape, existing codes and statuses unchanged, busy gains `code` | `previewstates` (codes, statuses, sentences equal the old ones), harness (each reason) |
| FR-3 | plain sentences, nothing blames the buyer | read in review; the old sentences kept where they existed |
| FR-4, FR-5 | failed sweep recorded; report call 200 `state: unavailable`, 202 `state: working` | harness (saved job has `failReason`; report call both states) |
| FR-6 | stream error event carries `reason` and `retryAt` | harness (the events text) |
| FR-7 | no PDF for a failed or missing preview | existing PDF routes answer 404 with no dossier (`pdf-routes`) |
| FR-8 | search again starts a new attempt | harness (new ref, then a working preview) |
| FR-9 | admin counters by reason, per day | harness (deltas per reason, started, failed) |
| NFR-2 | no AI call on a refusal | harness (the stand-in saw no call) |

Every guard was broken on purpose and its test failed (failed shown as working; reason not recorded; refusals not counted; busy without its code).

## Not verified

The website's behaviour on the new fields; counters across several instances (they are per instance and per day, like the existing ones); the report call after a restart answers 404 for a failed preview (documented).
