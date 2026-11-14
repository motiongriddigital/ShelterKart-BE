# Report PDFs: implementation plan and status

Written 14 November 2026. Requirements in `PRD.md`, design in `TDD.md`. Each slice is a commit with its tests; all run in `tools/ci-local.sh` (GitHub Actions is blocked by billing).

## Slices

| # | Slice | Tests | Status |
| --- | --- | --- | --- |
| S1 | `engine/pdfStore.js`: directory and memory stores, validation, atomic write, prune | `test/pdfstore.test.js` (18) | built |
| S2 | `renderPreviewPdf` in `engine/dossierHtml.js` | `test/pdfdocs.test.js` (template part, 7) | built |
| S3 | `engine/pdfDocs.js`: keys, free-view whitelist, single-flight, background yield, describe, counters | `test/pdfdocs.test.js` (14) | built |
| S4 | Routes `/r/:ref/preview.pdf` and `/r/:ref/pdf`, the `pdf` block on `GET /api/report/:ref`, OpenAPI, route snapshots, a link on the preview page | `test/harness/pdf-routes.test.js` (23) | built |
| S5 | Triggers (after the sweep, before delivery), files removed with the report, daily clean-up, admin status, `.env.example` | `test/harness/pdf-routes.test.js` | built |
| S6 | Real-Chromium test, docs status, local CI | `test/pdfreal.test.js` (runs where Playwright and Chromium exist, as in CI) | built; real run in the CI container |

## Verification

Requirement by requirement. "Test" names the file; every guard below was also broken on purpose and its test failed.

| Req | What | Verified by |
| --- | --- | --- |
| FR-1, FR-2, NFR-3 | free PDF holds the free view and nothing paid; "Free preview" mark and reference | `pdfdocs.test.js` sentinels (18 paid strings), `pdf-routes` (printed HTML has no "Every question, by stage"), footer text |
| FR-3 | full PDF is the existing full report | `pdf-routes` (printed HTML holds "Every question, by stage"), `pdfdocs` (sentinels present) |
| FR-4, FR-5 | held: no PDF, 423; no dossier: pending | `pdf-routes`, `pdfdocs` serve/describe |
| FR-6 | preview made after the first sweep, failure never fails it | `pdf-routes` (printed once after the search), `pdfdocs` ensure |
| FR-7 | full made before the delivery message | `pdf-routes` (one full print, e-mail then sent) |
| FR-8, FR-9 | single-flight; background yields to downloads | `pdfdocs` (ten requests, one print; queue skip counted) |
| FR-10 | content-keyed storage, old file replaced | `pdfdocs`, `pdfstore` |
| FR-11 | full stored only when complete | `pdfdocs` (two prints while completing, stored once complete) |
| FR-12, FR-13 | free route for anyone, no sign-in (changed 2026-11-14, see SHARING.md); full route entitled only, 403 `payment_required` with `previewPdf`; bad token keeps the generic 403 | `pdf-routes` |
| FR-14, FR-15 | headers; the full PDF still needs a session (401), the free one does not | `pdf-routes` |
| FR-16 | `pdf` block (kind, ready, url, filename, bytes, generatedAt, reason) | `pdf-routes`, `pdfdocs` describe |
| FR-17 to FR-19 | retention 7 days for previews; files removed with the report (admin purge); clean-up of orphans | `pdfstore` prune, `pdf-routes` (purge removes the files and the routes answer 404) |
| NFR-2 | printer guards unchanged (JavaScript off, network refused) | `pdf.test.js` (existing) and `pdfreal.test.js` hostile title |
| NFR-5, NFR-6 | store interface, no new dependency | code |
| NFR-1 | download from storage under 300 ms | not measured; a stored download reads one small file |

Found and fixed on the way: `purgeLiveJobs` counted a finished paid report as "still running" for as long as the process lived (the `completing` flag stays set after the job is done), so a takedown skipped it until a restart. It now looks at the status only.

## Not verified here (to be checked on a host)

Brand fonts in the PDF, two other PDF readers, a printer under load on the real host, the disk volume, the website buttons, a visual check of the free PDF's layout (the text and structure are tested, the look is not).

## Rollout

Merge, set nothing (`PDF_AUTO` defaults on). On staging: print one of each; open in two readers. Rollback: `PDF_AUTO=off`.

## Known behaviour

- A preview PDF is a snapshot: it carries the research date.
- Previews are not made while the printer is busy; the first download then makes them.
- English only; the sample PDFs are unchanged.
