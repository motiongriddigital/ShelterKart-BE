---
id: QA-010-report-contact-leak
title: A report no longer carries the e-mail and phone of whoever unlocked it to other readers
repo: ShelterKart-BE
branch: fix/report-contact-leak
sha: 0f343d9
created: 2026-11-04
---

# QA-010: the stored contact of a report is not sent to readers

You are the QA agent. Your job is to verify, not to build. Read `qa/README.md` first and follow its rules. Terminal only, no browser.

## What is under test

ShelterKart-BE, branch `fix/report-contact-leak`, commit `0f343d9` (stacked on `feature/admin-engines`, commit `4ac4f0b`). The brief of a report keeps the contact (e-mail and phone) of the buyer who unlocked it, for delivery and corrections. The route that returns a report to a reader (`GET /api/research/by-ref/:ref`) sent the whole brief to anyone entitled to it, and a preview is shared by every buyer of the same project, so a later buyer could read an earlier buyer's e-mail address and phone number in the JSON. The fix removes `contact` from what a reader receives in `gateBrief` (`backend/server.js`); the server still keeps it.

## What the builder did and how it was tested

Found by a read-only review of the code (it was not exercised then). The builder wrote a harness test first that registers a brief with a contact and fetches it through the real route handler: it failed (2 checks) before the change and passes after (7 checks). The whole `npm test` passes. Not tested by the builder: a real browser or a real purchase by two buyers (that needs an AI engine to create a report), and every other place a report or part of it might be returned.

## Setup

```
git clone https://github.com/motiongriddigital/ShelterKart-BE.git sk-be10 && cd sk-be10
git checkout 0f343d9 && cd backend && npm ci
```

No database is needed.

## Checks

| # | Do this | Expect |
| --- | --- | --- |
| A1 | in `backend`: `node -r ./test/harness/stub-loader.js test/harness/contact.test.js` | ends `all passing`; 7 lines start `  ok` |
| A2 | `npm test` (needs Playwright and python3; mark BLOCKED with the reason if missing) | exit code 0 |
| B1 | In a second clone, check out the commit before the fix and run the same test against it: `git clone ... sk-be10-old && cd sk-be10-old && git checkout 4ac4f0b && cd backend && npm ci && git show 0f343d9:backend/test/harness/contact.test.js > test/harness/contact.test.js && node -r ./test/harness/stub-loader.js test/harness/contact.test.js` | `2 FAILED`: "the response has no contact field" and "the previous buyer's e-mail address and phone number are not in the response". This proves the test sees the leak. |
| B2 | `git diff --stat 4ac4f0b 0f343d9` | exactly three files: `backend/server.js`, `backend/package.json`, `backend/test/harness/contact.test.js` |
| B3 | Read the change in `gateBrief` in `backend/server.js` | the `contact` field is deleted only from the copy sent to the reader; `previewOf` (the locked preview) was never carrying it |
| C1 | Find every route that returns a report, or part of one, to a reader or a buyer: `grep -n "getByRef\|getByRefAsync\|registerBrief\|\.contact" backend/server.js backend/accounts/*.js backend/engine/reportPages.js backend/engine/pdf.js`, then read each hit | for each place say whether the stored `contact` (e-mail or phone) could reach a reader: the report JSON, the report page `/r/:ref`, the PDF, the investigation event stream, the account's list of reports, the account data export. List every route you checked and what it returns. A route that can still return the contact is a FAIL: quote the line. |
| C2 | The delivery path: `grep -n "contact" backend/server.js \| grep -n "deliverReport\|DELIVERY"` and read `deliverReport` | the contact is still read on the server to send the report to the buyer (so the fix did not break delivery) |
| C3 | `grep -rn "contact" backend/engine/dossierBrief.js` and the `/api/admin/reports/:ref` route | the admin route may show the contact (it is behind the admin login); say if it does |

## Look hardest at

- Another route returning the same brief (C1). The review found one; it did not check them all.
- The account data export and the "my reports" list: they may return briefs or contacts.
- Whether a buyer's own contact is needed by the front end after this change (search `ShelterKart-FE` for `brief.contact` if you have it; the builder found none).

## Report

Write `qa/OUTBOX/QA-010-report-contact-leak.md` from `qa/RESULT-TEMPLATE.md`, then commit and push as in `qa/README.md`.