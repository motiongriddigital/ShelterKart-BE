# Report PDFs: what the website side does

For the front-end developer. Short, because the PDF is made and served by the back end; the website only shows the right button. Written 14 November 2026. Nothing in `ShelterKart-FE` has to change for the PDFs to exist; this is what to add to show them.

## 1. What the back end provides

`GET /api/report/:ref` (already used for the report page) now carries `pdf`:

```json
{
  "ok": true, "ready": true, "held": false,
  "report": { "...": "PropertyReport as before" },
  "pdf": { "kind": "preview", "ready": true, "url": "/r/SK-1A2B3C4D5E6F/preview.pdf",
           "filename": "ShelterKart-Preview-Marigold-Heights.pdf", "bytes": 84213, "generatedAt": "2026-11-14T10:02:11.000Z" }
}
```

| Field | Meaning |
| --- | --- |
| `kind` | `preview` for a visitor who has not paid (free PDF), `full` for one who has (the paid report) |
| `ready` | `true`: the file is made and can be downloaded at once |
| `url` | same-origin path to open or download; the website's existing rewrite of `/r/*` already forwards it, with the cookie |
| `filename`, `bytes`, `generatedAt` | for the label ("84 KB, made 10:02") |
| `reason` | when `ready` is `false`: `pending` (research not finished), `completing` (paid report still being completed), `not_made` (the next request makes it, takes a few seconds), `unavailable` (the server cannot print: hide the button, say "use your browser's Print"), `held` (under review: no download) |

## 2. What to build

1. On the report page, show one PDF button from `pdf`:
   - `kind: "preview"`: "Download the free preview (PDF)", with the unlock offer next to it as the page already has.
   - `kind: "full"`: "Download the full report (PDF)".
2. `ready: true`: a link to `pdf.url` (a normal `<a href download>`; no fetch needed, the cookie is sent).
3. `ready: false` with `reason: "not_made"`: the same button; opening it makes the file (a few seconds), so show a spinner while the download starts. With `pending` or `completing`: a disabled button with "The PDF will be ready when the research finishes"; re-read `GET /api/report/:ref` when the page already polls for progress.
4. `unavailable` and `held`: no button.
5. A visitor who has not paid and opens the full-PDF url (for example from an old e-mail) gets `403` with `{ code: "payment_required", previewPdf: "/r/<ref>/preview.pdf" }`: show "Unlock the full report to download this PDF" and offer `previewPdf`.
6. Do not build the PDF in the browser and do not link `/samples/*.pdf` for live reports; those are the three sample reports only.

## 3. Not needed

No new route handler in `src/app/api` (the `/r/*` rewrite covers both PDF urls), no new dependency, no change to the sample reports or the guide.

## 4. Tests worth having

The button for each `kind`; a disabled button for `pending`; no button for `unavailable`; the 403 `payment_required` message.

## 5. Order of work

After the back end ships (see `IMPLEMENTATION-PLAN.md`): the type `pdf?` on `PropertyReport`, the button component, the two messages. About half a day.
