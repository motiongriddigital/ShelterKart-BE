# Report PDFs: product requirements

Status: draft for the owner, written 14 November 2026. Companion documents in this folder: `TDD.md` (how it is built), `FRONTEND-CONTRACT.md` (what the website side does, which is little), `IMPLEMENTATION-PLAN.md` (slices, verification, rollout). Control Room: epic SHEL-86 (to be filed with the first slice).

Everything marked "Decision" is a default chosen so work can start. Section 11 lists each one.

## 1. Summary

A buyer who searches should get a proper PDF as soon as the research is ready, without waiting for a download to be "printed" and without having to pay for the first one. There are two PDFs, and they are different documents:

- The **preview PDF** (free): what the free preview page shows, as a short, honest take-away document that ends in the invitation to unlock the full report. It contains nothing that is paid.
- The **full PDF** (paid): the complete report, the document the buyer paid for, kept for as long as the report lives.

Both are made by the server by itself, shortly after the research they describe finishes, stored, and served from storage. Today only the full PDF exists, it is printed from scratch on every download, it is only reachable after payment, and nothing prepares it in advance.

## 2. Why

| Reason | Detail |
| --- | --- |
| The free preview has no take-away | The preview page is a web page. A buyer who wants to show it to a spouse, a lawyer or a bank, or read it later, has nothing to keep. A PDF of the free view is also what a buyer forwards, which brings the next buyer. |
| The paid PDF is slow and uncached | Every download starts a headless Chromium print (one to several seconds, at most two at a time). Ten buyers opening the same report in the same minute print it ten times. |
| Nothing is ready when the buyer arrives | The PDF is made on the click. The "your report is ready" e-mail links to a PDF that is only made when the link is opened. |
| Free and paid must never mix | If a preview PDF is ever built from the full report by hiding parts, a single mistake gives the paid content away. The free document must be built from the free view only. |
| It was asked for | The owner asked that the PDF be ready as soon as the search is done, and that the paying and non-paying PDFs differ. |

## 3. Goals

1. When the first research sweep of a project finishes, the free preview PDF is made and stored without anyone asking.
2. When the paid report is complete, the full PDF is made and stored without anyone asking, before the buyer is e-mailed.
3. A download is served from storage in well under a second; the printer is only used when nothing is stored.
4. The free PDF contains the free view and nothing else; the full PDF contains the whole report. A test proves the free PDF holds no paid text.
5. If the report changes (a correction, a new finding, the research resuming), the stored PDF is replaced, never served stale.
6. A report that is deleted or ages out of retention takes its PDFs with it.
7. If PDF printing is not available on the server, nothing else breaks: the page says so and offers the browser's own print, as today.

## 4. Non-goals for the first release

- A new visual identity for the full PDF. The full report keeps its existing layout (`renderDossier`); only the free PDF is new. Brand fonts (Plex Sans, Fraunces) are an installation matter, listed as known.
- Translations. The PDFs are English, like the page.
- Attaching the PDF to the e-mail. The e-mail keeps a link; attachments need a provider decision and file-size limits.
- Object storage (S3). The store is a directory behind an interface, so a bucket can replace it when the host is chosen.
- A different PDF per country or per price. The free PDF carries no price.
- Editing or annotating a PDF, or a PDF of a bundle of reports.

## 5. Users

| User | What they need |
| --- | --- |
| Buyer, not paying | A free PDF of the preview to keep and share, with a clear way to unlock the rest. |
| Buyer, paid | The full PDF, ready, downloadable again and again from any device while signed in. |
| Front-end developer | One field on the report call that says which PDF exists, whether it is ready, and where it is. No guessing, no polling an e-mail. |
| Operator | To see how many PDFs were made, how many failed, and the printer's queue; to find out why one is missing. |

## 6. User flows

### 6.1 Free: search, preview, keep

1. The buyer searches (signed in). The first sweep finishes and the preview is ready.
2. Within seconds the server has printed the preview PDF and stored it. The report call (`GET /api/report/:ref`) now carries `pdf: { kind: "preview", ready: true, url: "/r/<ref>/preview.pdf", ... }`.
3. The buyer presses "Download preview PDF" and gets the stored file at once.
4. The PDF ends with the unlock link back to the report page.

### 6.2 Paid: pay, wait, receive

1. The buyer pays. The deep research and the reviewer run, as today.
2. When the report is complete the server prints the full PDF, stores it, and then sends the "ready" e-mail. The `pdf` block now says `kind: "full"`.
3. The buyer downloads the full PDF from the page or the e-mail, today or in twenty days, from any device where they are signed in and own the purchase.

### 6.3 The report changes

A correction, a re-run or a late finding changes the report. The next time anyone asks, or when the change is saved, the PDF is made again from the new content. The old file is removed.

### 6.4 Printing is not available

The server has no Chromium. The report call says `pdf: { kind, ready: false, reason: "unavailable" }`; the page keeps the "print from your browser" instruction; the PDF routes answer 503 as today.

### 6.5 A buyer who has not paid asks for the full PDF

The full-PDF route answers 403 `payment_required` and names the preview PDF in the reply. Nothing from the full report is ever sent.

## 7. Requirements

### 7.1 Two documents

| ID | Requirement |
| --- | --- |
| FR-1 | The preview PDF is built from the free view only: the project block (name, place, registration ids, research date), the counts sentence, the "where the marketing and the record part ways" cards, the first three questions in full, the list of what the full report adds, the unlock link (no price: it depends on the buyer's country, and a PDF is forwarded), and the research-not-advice notice. |
| FR-2 | The preview PDF carries a visible "Free preview" mark on every page and the reference. It holds no finding text beyond the cards, no source list, no question beyond the first three, no tracker. |
| FR-3 | The full PDF is the existing full report (`renderDossier`), unchanged in content. |
| FR-4 | A held report (under review) has no PDF of either kind and the routes answer 423. |
| FR-5 | A report with no dossier yet (still working) has no PDF; the report call says `ready: false, reason: "pending"`. |

### 7.2 Making them

| ID | Requirement |
| --- | --- |
| FR-6 | When a first sweep finishes (status becomes `preview`), the preview PDF is made in the background. A failure never fails the sweep and is retried on the next request. |
| FR-7 | When a paid report reaches `phase: complete`, the full PDF is made before the delivery message is sent; if making it fails the message is still sent, with the page link. |
| FR-8 | Making is single-flight per report and kind: concurrent requests wait for one print. |
| FR-9 | Background making yields to downloads: when the printer's queue is not empty, background work for previews is skipped and left to the first request. |
| FR-10 | A PDF is stored under a key made from the report's content and the template version. A changed report or a changed template gives a new key; the old file is deleted. |
| FR-11 | A full PDF is stored only for a complete report. A request for an incomplete paid report prints on demand, is not stored, and says so in a header. |

### 7.3 Serving them

| ID | Requirement |
| --- | --- |
| FR-12 | `GET /r/:ref/preview.pdf`: anyone with the address, no sign-in (owner, 2026-11-14: the free PDF is for sharing). It always serves the preview PDF, even to a buyer who has paid (the full one has its own route). |
| FR-13 | `GET /r/:ref/pdf` (existing): the full PDF, only for a purchase that entitles the visitor, exactly as the full report page. Anyone else: 403 `payment_required` with `previewPdf` in the body. |
| FR-14 | Responses carry `Content-Type: application/pdf`, a filename, `Cache-Control: private, no-store` and `X-Robots-Tag: noindex`. Stored files are streamed with the content length. |
| FR-15 | The full PDF route sits behind the sign-in wall. The free preview PDF route does not (owner, 2026-11-14); both keep the general rate limits. |
| FR-16 | `GET /api/report/:ref` carries a `pdf` block: `kind` (`preview` or `full`), `ready`, `url`, `filename`, `bytes`, `generatedAt`, `reason` when not ready. The block describes the PDF this visitor may download now. |

### 7.4 Keeping and removing

| ID | Requirement |
| --- | --- |
| FR-17 | Preview PDFs are kept for `PDF_PREVIEW_DAYS` (default 7) after they were last made; full PDFs for as long as the report is kept (`JOB_RETENTION_DAYS`). |
| FR-18 | When a report is deleted, expired or purged (admin purge by source), its PDFs are deleted in the same step. |
| FR-19 | A clean-up runs at start and daily: it removes files past retention and files whose report no longer exists. |

### 7.5 Non-functional

| ID | Requirement |
| --- | --- |
| NFR-1 | A download of a stored PDF answers in under 300 ms at p95 on the reference server. |
| NFR-2 | Printing keeps the existing guards: JavaScript off, every network request refused, at most `PDF_CONCURRENCY` at once. |
| NFR-3 | No paid text in the preview PDF: proven by a test that prints a report with sentinel strings in every paid field and finds none of them. |
| NFR-4 | Disk use is bounded: previews expire; a size line per kind is shown to the operator. |
| NFR-5 | The store is an interface (`get`, `put`, `remove`, `list`) with a directory implementation and a memory one for tests. |
| NFR-6 | No new dependency. |

## 8. Privacy and compliance

The preview PDF holds the same facts as the preview page and nothing about the buyer. Neither PDF carries the buyer's e-mail, phone or name. Files are named by report reference and key, not by buyer. A report's PDFs are deleted with the report, which also honours account deletion (the report itself follows the retention rule). Because a preview PDF can be forwarded, it carries the research date and the notice that the research is a snapshot.

## 9. Success measures

| Measure | Target |
| --- | --- |
| Preview PDF ready within 20 s of the preview being ready | 95 percent |
| Full PDF ready before the "ready" message | 99 percent of complete reports (the rest fall back to on-demand) |
| Downloads served from storage | 90 percent or more |
| PDF saves per free preview, and per paid report | reported on the admin dashboard (the existing "PDFs saved" count, split by kind) |
| Paid content found in a preview PDF | zero, by test and by a monthly spot check |

## 10. Release and rollout

1. Behind `PDF_AUTO=on` (default on). Off restores today's behaviour exactly: only the on-demand full PDF.
2. Staging: print one of each from a sample report; open both in two PDF readers; check the free one holds nothing paid; check a held report refuses.
3. Production: no migration (files only). Rollback is `PDF_AUTO=off`; stored files are left to expire.

## 11. Decisions and open questions

| # | Decision (default) | Changing it affects |
| --- | --- | --- |
| D1 | Two documents; the free one is built from the free view only. | FR-1 to FR-3, tests |
| D2 | Automatic: preview after the first sweep, full when complete, before the delivery message. | triggers in `liveReports` |
| D3 | A directory store (`PDF_DIR`), not the database: previews are many and mostly never downloaded. | TDD section 4 |
| D4 | Preview PDFs expire after 7 days; full PDFs live with the report. | FR-17 |
| D5 | The free route is separate (`/r/:ref/preview.pdf`); the existing route stays the paid one. | FR-12, FR-13, front end links |
| D6 | The free PDF carries the unlock link and no price: the price depends on the buyer's country and a forwarded PDF would show the wrong one. | FR-1, the free PDF's cache key |
| D7 | Background previews yield to downloads. | FR-9 |
| D8 | English only; brand fonts are an installation step, not in scope. | non-goals |
| Q1 | Should the "ready" e-mail attach the full PDF (size about 200 to 400 KB) instead of linking? Needs the mail provider. | delivery |
| Q2 | Should a buyer who has paid also be able to download the preview PDF? Default yes (harmless, same facts). | FR-12 |
| Q3 | Should the preview PDF be public (no sign-in) so it can be shared by link? Answered by the owner on 2026-11-14: yes, no sign-in is needed to share or save the free PDF. | FR-15 |

## 12. Risks

| Risk | Mitigation |
| --- | --- |
| Paid text leaks into the free PDF | Built from the free view only; sentinel test; no shared "hide" logic. |
| Printer overload (a burst of sweeps) | Existing concurrency limit; background previews yield; on-demand fallback. |
| Stale PDF after a correction | Content-keyed storage; keys change with the report. |
| Disk fills | Seven-day preview expiry, daily clean-up, size shown to the operator. |
| Chromium missing or crashing on the host | `unavailable` state, 503 with guidance, nothing else depends on it. |
| A preview PDF read by a non-signed-in person through a leaked file link | Files are not web-served; only the route, behind the wall, reads them. |
