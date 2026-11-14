# Freemium engine, slice 2: implementation plan and status

Written 14 November 2026. Requirements in `PRD.md`, design in `TDD.md`.

## Slices

| # | Slice | Tests | Status |
| --- | --- | --- | --- |
| F1 | `engine/previewStates.js`: the reasons table, `refusal`, `failureNote`, `nextUtcMidnight` | `test/previewstates.test.js` | planned |
| F2 | Start call uses the table; counters; busy gains `code: "busy"` | `test/harness/preview-states.test.js` | planned |
| F3 | Failed sweep recorded and persisted; report call `state`; stream error event; admin status | `test/harness/preview-states.test.js` | planned |
| F4 | OpenAPI, route snapshots (no new routes), docs status, local CI | contract tests | planned |

## Not built, with the reason

The preview with no AI from the registers (PRD section 7: a register lookup needs the developer's legal name and the project index is empty at launch), a "notify me" e-mail (privacy decision), slice 3 (needs the owner's Gemini key) and slice 4 (the owner's judgement of the default).

## Verification and not verified

To be filled after the slices.
