# Sharing the PDFs

Decided by the owner on 14 November 2026, on top of the report PDFs (PRD, TDD in this folder).

## What changed

| Before | Now |
|---|---|
| The free preview PDF needed a sign-in. | No sign-in. Anyone with the report address can save, install or share the free PDF. It holds only the free view, as before. |
| Files were named `ShelterKart-Report-<Name>.pdf` and `ShelterKart-Preview-<Name>.pdf`. | `<Developer>_<date>_<code>.pdf` for the paid one and `<Searched>_preview_<date>_<code>.pdf` for the free one. |
| The paid PDF was a link in the e-mail. | The paid PDF is also attached to the e-mail, and the link stays. |
| My purchases had no PDF. | Each row of `GET /api/me/reports` carries `pdf` (paid) and `previewPdf`, each with `url` and `filename`. |

## File names

- Paid: the developer's legal name or brand from the research, else what the buyer searched for, then the research date and the first six characters of the report reference. Example: `Hubtown-Limited_2026-11-14_B2FCF2.pdf`.
- Free: what the buyer searched for (never the developer's name, which the free view does not show), then `preview`, the date and the code. Example: `Hubtown-Celeste_preview_2026-11-14_B2FCF2.pdf`.
- Letters, digits and hyphens only; at most 40 characters of name. Two researches of one developer on one day still differ by their code.
- A date and code, not a clock time: the name is the same on every download, in the e-mail and in the account, and a clock time would change whenever the file is made again.

## The e-mail

- The paid PDF is printed before the e-mail goes out (existing rule) and attached to it as `application/pdf`, with the same name as the download. The text says it is attached and still carries the link.
- `DELIVERY_ATTACH_PDF=off` turns it off. A file larger than `DELIVERY_ATTACH_MAX_BYTES` (default 3,000,000) is not attached; the e-mail carries the link only, as before. A PDF that was not ready within `PDF_BEFORE_DELIVERY_MS` also goes as link only.
- Works with Resend, Postmark and Brevo. A retry sends the same attachment. The file is never written to the delivery log.
- WhatsApp: the existing template message carries the report link, which downloads the PDF. Sending the PDF itself as a WhatsApp document needs a template with a document header and a media upload; not built.

## Tests

`test/attachment.test.js` (10), `test/pdfdocs.test.js` (file names), `test/harness/pdf-routes.test.js` (public preview, full still walled, the e-mail carries the named attachment), `test/accounts.test.js` (the PDF fields in my reports). Seven guards were broken on purpose and each broke a test.
