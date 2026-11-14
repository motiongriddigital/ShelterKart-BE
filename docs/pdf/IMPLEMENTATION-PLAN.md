# Report PDFs: implementation plan and status

Written 14 November 2026. Requirements in `PRD.md`, design in `TDD.md`. Each slice is a commit with its tests; all run in `tools/ci-local.sh` (GitHub Actions is blocked by billing).

## Slices

| # | Slice | Tests | Status |
| --- | --- | --- | --- |
| S1 | `engine/pdfStore.js`: directory and memory stores, validation, atomic write, prune | `test/pdfstore.test.js` | planned |
| S2 | `renderPreviewPdf` in `engine/dossierHtml.js` | `test/pdfdocs.test.js` (template part) | planned |
| S3 | `engine/pdfDocs.js`: keys, single-flight, background yield, describe, counters | `test/pdfdocs.test.js` | planned |
| S4 | Routes (`/r/:ref/preview.pdf`, `/r/:ref/pdf`), `pdf` in `GET /api/report/:ref`, OpenAPI | `test/harness/pdf-routes.test.js` | planned |
| S5 | Triggers (after sweep, before delivery), retention hooks, admin status, `.env.example` | harness, `test/pdfdocs.test.js` | planned |
| S6 | Real-Chromium test, docs status, route snapshots, local CI | `test/pdfreal.test.js` | planned |

## Verification, to be filled after each slice

- The checklist from the PRD, item by item: FR-1 to FR-19 and NFR-1 to NFR-6, each marked verified (with the test that proves it), not verified, or not applicable.
- Mutation checks listed in TDD section 8, each recorded as "broken, test failed".
- A real printed preview and full PDF opened and read (text extracted, page count, file size), with the sentinel check.

## Not verified here (to be checked on a host)

Brand fonts in the PDF, two other PDF readers, a printer under load on the real host, the disk volume, the website buttons.

## Rollout

Merge, set nothing (`PDF_AUTO` defaults on). On staging: print one of each; open in two readers. Rollback: `PDF_AUTO=off`.

## Known behaviour

- A preview PDF is a snapshot: it carries the research date.
- Previews are not made while the printer is busy; the first download then makes them.
- English only; the sample PDFs are unchanged.
