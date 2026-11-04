---
id: QA-010-report-contact-leak
status: pass
tested_sha: 0f343d9
machine: Windows 11, node v24.20.0, Git Bash (no database needed)
finished: 2026-11-04
---

# Result for QA-010-report-contact-leak

## Summary

The fix removes `contact` from the report JSON a reader receives, the test fails on the commit before the fix exactly as described, and I found no other route that returns the stored buyer contact to a reader. Two routes still show the whole brief: the admin report route (admin only, as the prompt allows) and none for readers.

## Checks

| # | Result | Evidence |
| --- | --- | --- |
| A1 | PASS | `all passing`, 7 lines `  ok` |
| A2 | PASS | `npm test` exit 0 (Chromium installed, python3 shim) |
| B1 | PASS | on `4ac4f0b` with the new test: `FAIL the response has no contact field`, `FAIL the previous buyer's e-mail address and phone number are not in the response`, `2 FAILED` (the other five `ok`) |
| B2 | PASS | `git diff --stat 4ac4f0b 0f343d9`: `backend/package.json`, `backend/server.js`, `backend/test/harness/contact.test.js` (3 files, 60 insertions, 2 deletions) |
| B3 | PASS | `gateBrief` (server.js ~275-283): when open, `const full = { ...brief, locked: false }; delete full.contact; return { brief: full, paywall };` The delete is on the copy; the stored brief is untouched. `previewOf(brief)` (locked path) is unchanged and was never carrying the contact (test line "the locked preview never carried the contact either"). |
| C1 | PASS | routes read, with what each can return: <br>- `GET /api/research/by-ref/:ref` (1108) and `POST /api/research` (1220): both return `gateBrief(...)`, contact removed. <br>- `GET /r/:ref` (846): renders `brief.dossier` only; `contact` is a top-level field of the brief (`dossierBrief.briefOf`, line 36), not part of the dossier. <br>- `GET /r/:ref/pdf` (865): `renderDossier(brief.dossier)`, dossier only. <br>- `GET /api/investigate/:ref/events` (821): events are built from `type, stage, round, message, phase, counts` (server.js 556, 685); no contact. <br>- `GET /api/me/reports` and `/api/me/export` (accounts/index.js 247-259): `reportsOf` returns ref, times, paid, amount, currency, projectName, market; no brief, no contact. <br>- `POST /api/research/quote`, `/checkout`, `/razorpay/verify`, `/access`, `/recover`: return quote, order or token data, never the brief. <br>- `POST /api/investigate/:ref/contact` (833): only stores the contact, answers `{ok:true}`. <br>- `GET /api/admin/reports` (listRecentReports): ref, title, place, market, developer, counts only. <br>- `GET /api/admin/reports/:ref` (1178): returns the whole brief including `contact`, admin login required. <br>No route found that can still return the contact to a reader. I read the code; I did not run a two-buyer purchase. |
| C2 | PASS | `deliverReport` (server.js 703-706): `const contact = (brief && brief.contact) \|\| job.contact;` then `DELIVERY.send({... email: contact.email, phone: contact.phone ...})`; delivery still reads it on the server. The test also checks "the contact is still kept on the server, for delivery". |
| C3 | PASS (reported) | `/api/admin/reports/:ref` does return the full brief, including `contact`, behind `adminAuth`. `dossierBrief.js` only places `contact` at the top of the brief (line 36) and cleans it (line 64). |

Look hardest at: front end (ShelterKart-FE `e8ca5cd`) has no `brief.contact` use; the only matches are the admin review queue (`r.contact` from disputes, a different thing) and the dispute form.

## Anything else you noticed

- `GET /api/admin/reports/:ref` returns the stored contact in plain form to anyone with the admin login. That is allowed by the prompt, but it is a place to cover in an access-control review.

## Environment problems

- None for this item (no database). A second clone `sk-be10-old` at `4ac4f0b` was used for B1.
