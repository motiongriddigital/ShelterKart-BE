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

## The freemium engine (lean preview), SHEL-79

`INVESTIGATE_PREVIEW_MODE=lean` makes the free preview a fast first look instead of the full investigation. Off by default (`full`): with it off nothing changes, and the full prompt is byte for byte what it was.

| | full (default) | lean |
| --- | --- | --- |
| Free preview | the full investigation prompt and schema, answer up to 16,000 tokens | a first-look prompt: the registration record, how it is marketed, who sells it; at most 10 facts, 5 leads and 5 questions; answer up to `INVESTIGATE_LEAN_MAX_TOKENS` (4,000) |
| Stage of the preview | `sweep` | `sweep` (the only stage a free-tier engine may serve) |
| At payment | continues from the sweep: lead rounds, reviewer, questions | a deep sweep first (stage `deep`, a paid stage: never a free engine), told what the first look found, with `INVESTIGATE_DEEP_SEARCHES` searches, `INVESTIGATE_DEEP_FETCHES` page reads and `INVESTIGATE_DEEP_PANEL` engines; then the same lead rounds, reviewer and questions |
| Free view | counts of the full sweep | smaller counts (tens of findings become about ten); the cards and the first questions are the same |

If the deep sweep fails (every engine down), the report is still built from the first look and the lead rounds and the failure is recorded; a spending stop before it skips it. A buyer who pays before any preview ran goes straight to the deep sweep. A preview saved by the full mode is never swept again. The cost of each stage, the deep sweep as its own line, shows in the job's per-stage costs.

Not measured: real cost or quality (no AI key has been used), and a free-tier engine has never answered the lean prompt. Whether lean saves money depends on how many free previews convert, which nothing here knows.

## What is not built

When free capacity runs out the preview fails with the existing outage message. A degraded preview built only from the registry connectors is not built (SHEL-79, slice 2).

## Choosing engines

Free limits and terms change. Read the vendor's current terms before putting an engine in `AI_FREE_ENGINES`, and measure cost per report (`/api/admin/engines/costs`) before moving an engine between lists.
