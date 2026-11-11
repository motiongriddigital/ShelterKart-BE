# AI engines by stage: free preview, paid report

The client's rule: the preview is sourced on free AI, paid AI runs only for paid reports. The engine router (`backend/engines/index.js`) enforces it per call, using the `stage` every call already carries. The preview is the `sweep` stage; everything after payment (`leads`, `reviewer`, `questions`) and every call without a stage (adviser, documents, translation) is the paid side.

| Setting | Effect |
| --- | --- |
| `AI_PREVIEW_ENGINES` | The preview sweep may use only these engines. Empty: any allowed engine. |
| `AI_PAID_ENGINES` | Every other stage may use only these. Empty: any allowed engine. |
| `AI_FREE_ENGINES` | Engines whose API key is a free tier. They serve the preview sweep and nothing else: never a paid stage, never documents, adviser or translation, whichever lists they are on. |

Nothing changes until one of them is set. A preview whose engines are not set up fails like any outage; it never falls back to a paid engine.

## Why a separate list for free keys

Whether a key is "free" belongs to the key, not to the vendor, so it is a setting. The agent research of 11 Nov (`plan-2026-11-11/RESEARCH-pricing-and-free-tiers.md`, unconfirmed beyond its own sources) reports that Google's free Gemini API tier may use prompts for training with human review, and that paid use does not. A sweep prompt contains only the property name and location the buyer typed, which is why it may go to a free tier; a document, a buyer's contact details or a finished paid report must not.

## What is not built

When free capacity runs out the preview fails with the existing outage message. A degraded preview built only from the registry connectors is not built.

## Choosing engines

Free limits and terms change. Read the vendor's current terms before putting an engine in `AI_FREE_ENGINES`, and measure cost per report (`/api/admin/engines/costs`) before moving an engine between lists.
