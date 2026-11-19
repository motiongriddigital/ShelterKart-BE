# Full report extras: first steps, letters, stamp

Added 19 November 2026 to make the paid PDF clearly different from the free one. All three exist only in the full report (`renderDossier`); the free preview PDF is built from `freeView` and carries none of them (`test/pdfextras.test.js` proves it).

| Part | Where | What it is |
| --- | --- | --- |
| First steps | End of "The record, counted" (page 2) | "Before you pay: three steps" (send the questions, hold each answer until the document is in hand, give your own lawyer the answers) and the three questions to send first, each named by team. It describes a process; it never says whether to buy. |
| Letters | New section "Send this to the developer", after the tracker | One page-sized letter per developer team (questions put to "your own ..." are left out), with its questions in full and the document that closes each. At most 12 questions per letter; the rest are named as being in "Every question, by stage". Our reasoning ("why it matters") is not in the letter. |
| Stamp | End of "About this report" | Reference, research date, a 16-character fingerprint (SHA-256 of the whole report content, `dossier.fingerprint`) and a check address. |

## Checking a copy

`GET /r/:ref/verify/:code` (no sign-in, 60 a hour per address, HTML, `noindex`, `no-store`). It says whether the fingerprint matches the report on file and shows nothing else from the report. The result is also in the `X-Verify-Result` header: `match`, `mismatch`, `unknown`, `invalid`, `held`. A copy that was edited, or a report corrected after the copy was made, shows `mismatch`. A match shows the content is unchanged; it does not endorse it.

The address starts with `PUBLIC_BASE_URL` (or `SITE_URL`); without one the stamp prints the path only. The site already forwards `/r/*` to this back end, so the front end needs no change.

## Limits

- The fingerprint proves the content matches the report we hold. It is not a signature: someone who edits both the PDF text and the fingerprint is caught only because the check is made against our copy, not the PDF's.
- A report that gains content later (corrections, a reply shown beside a finding) gets a new fingerprint, so older copies show `mismatch` and the page says why.
- No QR code: it needs a library; the address is printed and clickable.
- Stored PDFs are made again once, because `TEMPLATE_VERSION` moved from `pdf-1` to `pdf-2`.
