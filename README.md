# ShelterKart — Final Consolidated Build

**The model, in one line:** CIBIL judges a borrower for a bank before it lends.
ShelterKart judges a developer/project for a buyer before they pay — using the
same kind of thing CIBIL uses: real records already sitting in public/regulatory
databases, turned into one honest score. Free to see. Paid to keep, download,
or get alerted on.

```
shelterkart/
├── shelterkart-frontend.html   ← open this directly, works standalone
└── backend/
    ├── server.js                ← Express API
    ├── schema.sql                ← Postgres schema
    ├── package.json
    └── .env.example
```

## What changed in this pass

- **Removed all "coming soon" clutter.** The hero used to render the 4 live
  markets *plus* 25 disabled/roadmap country chips. Per your instruction —
  a market is either live or it isn't shown — those 25 are gone entirely.
- **UK and Singapore now actually return results.** They were listed as live
  markets but had zero demo developers/projects behind them, so any real
  search there silently failed — that's very likely what read as "reports
  not working." Added one developer + one project in each.
- **Removed the page-wide grain/noise texture** for a flatter, cleaner
  surface — one less thing competing for attention.
- **Fixed the honesty gap on "Global Coverage"** — the label now reads
  "Currently Live In," matching the brief's own non-negotiable principle
  #7 (never claim coverage that isn't true yet).
- **Backend hardening**: locked-down CORS (only your real domain can call
  the API, not any script from anywhere), a pluggable CAPTCHA hook
  (Cloudflare Turnstile) gating the two routes that cost you real money per
  call (OTP send, checkout), a checkout rate limiter + sanity check on
  amounts, and a query-length cap on search to block abuse.

## Bugs found and fixed on the second pass

- **`payAndUnlock()` (the "Get Report" one-time purchase) called
  `/api/report-checkout`, which didn't exist on the backend** — it would
  have 404'd silently in production while the UI advanced to "unlocked"
  anyway, meaning a buyer could see the unlock screen with no server-side
  purchase record. Added the real endpoint (`/api/report-checkout` +
  `report_purchases` table) and made the frontend actually check the
  response before advancing.
- **Every payment/OTP call that previously swallowed its result in a bare
  `try{...}catch(e){}`** (Watch-flow OTP send, Watch-flow subscription
  confirm) now checks `data.ok` and shows a real error instead of silently
  proceeding as if it succeeded.

## Fourteenth pass — the globe, from real reference images this time

Three actual rendered mockups were reviewed (not text descriptions) —
a dark hero with a photorealistic dotted globe and gold connection
arcs, and two light versions with the same globe as a quiet background
watermark. Verdict, now that there was something concrete to evaluate:
the light versions are genuinely good and close to what was already
proposed as the acceptable version of "globe" — restrained, in the
site's existing navy/gold palette, not competing with the text.
Built a static SVG wireframe globe (latitude/longitude lines, five
gold city-dots, thin connecting arcs) as a low-opacity (0.11) backdrop
behind the hero, matching the reference images' restraint rather than
the earlier neon/particle-canvas version.

**Explicitly not adopted**: the hardcoded "40+ Countries / 190+
Authorities / 18M+ Documents" stats shown in the same mockups — worth
noting that the accompanying conversation *also* corrected itself on
this point independently, arriving at the same rule already in
`CONSTITUTION.md` (no claim without evidence). No fabricated numbers
were added.

Also cleaned up genuinely dead CSS left over from the arch decoration
removed several passes back — the class names were still in the file
with nothing left in the page using them.

Verified: syntax check, full DOM-stub suite across all 16 entities,
share card — clean.



**The "[object Object]" bug — root cause confirmed, not guessed.** Every
developer object had **two keys named `legal`** in the same object
literal: a plain string (the legal entity name, e.g. "Macrotech
Developers Ltd.") from an early round, and later — when the deep
content model was added — a `{summary, findings}` object for the
Legal & Registration section, using the *same key name*. JavaScript
object literals silently keep the last duplicate key, so `d.legal`
became the object everywhere, and `${d.legal}` in the subject-line
template stringified to `[object Object]`. Fixed by renaming the
string field to `legalName` across all 7 developers and updating the
one template that displays it. Verified directly — printed
`d.legalName` for all 7 and confirmed real strings, not objects.

**Pricing now scales with coverage, not just price band.** A
Partial-coverage report (no litigation/history/micro-market/questions
layer) was charging the same as a Full one — inconsistent with the
value actually delivered. `getFlatFee()` now applies a real ~40%
discount for Partial-coverage projects, rounded to a clean number.
Verified per-project, in every currency: Lodha Park (Full) stays at
₹2,499; every Partial project — Bellissimo, Amara, Oberoi Sky, Damac
Hills, Berkeley Southall, CDL Canninghill, both Sky Villas — now
genuinely costs less.

**Evidence Strength vs. Coverage — the confusing juxtaposition is now
explained, not just displayed.** These measure two different things:
Coverage is *how much* was investigated (which sections exist);
Evidence Strength is *how accurate* the findings that do exist are
(verified vs. unverified). A Partial-coverage project showing 100%
Evidence Strength isn't a contradiction — it means the few things
checked were all verified — but showing both numbers with no
explanation reads as contradictory, which is exactly what surfaced as
a real point of confusion. The badge now says so explicitly for
Partial-coverage reports: "measures accuracy of what's been checked,
not how much has been checked."

All three verified through the full pipeline — syntax check, the
DOM-stub runtime suite across all 16 entities, and standalone
verification scripts confirming the actual output values, not just
that the code runs without throwing.



**A second AI brainstorm batch was reviewed** (14 more documents — full
Next.js rewrite recommendation again, a 300-page "Product Bible," six
different user-role "workspaces," a Founder OS dashboard). Same verdict
as the first batch, for the same reasons: real, cheap improvements
adopted; premature-scope items rejected. One thing worth naming — the
batch contradicted itself on whether to keep the Trust Score as the
headline metric (most documents kept it, one said remove it). Sided
with keeping it: a single number is *more* consistent with "understood
in 2 seconds" than three supporting metrics would be, which several of
those same documents argue for elsewhere.

**Adopted: Evidence Strength.** A new `evidenceStrength()` function
computes the real percentage of an entity's findings that trace to a
cited public record vs. an unverified public claim — pulled from the
actual `.v` flags already in the data, not a fabricated confidence
score. Verified it produces genuinely differentiated numbers: Lodha
Group 83% (it has one unverified sentiment finding), Damac 88%, Lodha
Park 100% (no unverified findings exist in that project's current
data). Shown right next to the Coverage badge from last round.

**The mobile pass — and a real bug found in the process, not mobile-
specific.** The OTP digit inputs (both the report-unlock flow and the
Watch-subscription flow) had **no width, border, or background set
anywhere in the file** — they were relying entirely on inconsistent
browser default sizing for a 6-input-in-a-row layout, which would have
overflowed badly on any screen, mobile most visibly. Fixed with an
explicit 42px width (36px on very narrow phones) plus real border/focus
styling. Also tightened modal, watch-panel, and coverage-badge padding
for narrow screens, which were using the same padding as desktop.

File now has 13 responsive breakpoints (was 2 a few passes ago). Full
verification suite — syntax, all 16 entities locked/unlocked, share
card, typo correction — still passes clean.



Turned the "Full / Partial / Insufficient" coverage-tier model from
`HANDOFF.md` into a real, working badge on every report — computed
honestly from what data actually exists per entity, not asserted.
Verified directly: Lodha Park (the one project with wing-level status,
history, litigation, micro-market, and drafted questions) correctly
reads **Full Coverage**; all 8 other projects correctly read **Partial
Coverage**, since they only have the base legal/delivery/price layer.
This is the real value of the tier system — it's already telling the
truth about the current gap between the flagship example and everything
else, not waiting for a hypothetical future country with worse data to
demonstrate it. Deliberately uses navy/gold for the badge dot, not
green/amber — those stay reserved strictly for the trust-score verdict,
so the two signals never visually blur into each other.



**Found and fixed the actual reason the unlock price wasn't showing.** Not
a rendering delay, not infrastructure — a genuine race condition: the
code that set the button's price text ran *before* the button existed in
the DOM (it was on a line that executed prior to the innerHTML render
that creates the button), so `getElementById` silently returned null and
the `if(ib)` guard swallowed the failure. Fixed by computing the fee
inline in the template itself, removing the race condition entirely
instead of patching around it.

**Repalette, reasoned rather than reactive.** Moved off black/silver to
deep institutional navy + white + a disciplined gold accent. The
reasoning: blue is the single most empirically proven "trust" color
across cultures (why virtually every bank uses it) — black signals
power/exclusivity, not trust, specifically. More importantly: a
dark-dominant interface works against a "we have nothing to hide"
message, since darkness is the near-universal metaphor for concealment
("kept in the dark," "shed light on"). The hero — the actual first-two-
seconds moment — is now bright white with navy ink, not a dark vault.
Gold is reused from an earlier pass but now set against white+navy
(the Amex/HSBC-private-banking register) rather than against dark
marble, which is what made it read as "jewelry store" the first time.
Verdict colors (green/amber/red) are unchanged — still the one place
color signals something, and still reserved for exactly that.

**Free tier now genuinely shows a reason to unlock**, not just a locked
wall: a value line under the unlock button names the Questions to Ask
feature specifically, since that's the concrete USP, not abstract
"more findings."

Every change in this pass re-verified: syntax check, the full DOM-stub
runtime suite (all 7 developers + 9 projects, locked and unlocked, plus
the share card), and a fresh WCAG contrast pass on the new palette — all
clean, all attached.



You pushed back — rightly — that "virality is still just an idea" and
"are you happy with the palette" had been answered with review-level
opinions rather than action or a real independent stance. Two direct
responses:

**Built the shareable Trust Score Card for real, not as a proposal.**
`shareScoreCard()` + `drawShareCard()` render a branded 1200\u00d7630 PNG
client-side — no backend, no external library — with the score, verdict,
name, Passport ID, and ShelterKart branding, and trigger a real download.
It's linked from the score caption on *every* report, free or paid,
because the score and verdict are already free-tier information — sharing
it doesn't leak anything the paywall is supposed to protect. Verified by
actually running `shareScoreCard()` against both a project and a developer
entity through a canvas-stubbed version of the same Node harness used
last round — confirmed it draws without error for both entity types.

**One honest limitation**: this sandbox has no working canvas-rendering
library (no `node-canvas`, no Cairo, no network to install one), so I
cannot show you an actual rendered pixel preview of the card — only that
the drawing code runs correctly, and a hand-checked geometry pass (the
verdict tag and the name text sit close together, ~14px gap, which is
tight but shouldn't overlap). Worth a real look in an actual browser
before you treat the layout as finished.

**On the palette, directly**: yes to keeping black/silver as the core
identity — I'd defend that. No to being satisfied with how it's executed
on the report page specifically: it's still dense, same-weight body text
throughout, with hairlines as the only visual separation. That's a real
critique I'm making of my own work, not a hedge — it's the next thing to
fix, and it hasn\u2019t been touched yet.



Every point from this round, marked honestly as done or not — nothing
silently dropped:

**Done:**
- **Report flow reordered**: Company \u2192 Project \u2192 Micro-Market \u2192
  Questions to Ask, exactly as requested. "About the Developer" is now a
  real free-tier section (it didn't exist in the live site before this —
  it only existed in the demo PDF, which was itself a bug I found while
  fixing this).
- **Questions to Ask, integrated into the report** (my recommendation,
  reasoning below) — 8 real questions across Sales/CRM/Legal teams, every
  one derived from an actual finding in the report (Wing C's revision,
  the Wing B dispute, the encumbrance check), not a generic checklist.
- **Micro-Market Trends section**, new `MICROMARKETS` data structure keyed
  by area so it's reusable across any project in that market, not
  duplicated per-project. Deliberately built from self-consistent demo
  data (aggregated-style stats), not a fabricated "market average."
- **Hidden pricing, fixed everywhere**: the unlock button, the sticky bar,
  and the comparison table now all show the real fee (\u20b92,499 for Lodha
  Park) upfront — nowhere does "Unlock Full Report" hide what it costs
  anymore.
- **"No results found," fixed**: previously a typo or unindexed name hit
  a bare native `alert()` popup. Replaced with a proper in-page state,
  and it now offers a real "Did you mean?" suggestion.
- **"Did you mean," verified working**: built on plain Levenshtein
  distance (computed and checked directly, not just assumed from Fuse's
  fuzzy threshold) — "Loza Park" \u2192 correctly suggests "Lodha Park" (edit
  distance 2), confirmed by an actual test run, not just code review.
- **Same-name disambiguation, proven with a real test case**: added two
  genuinely same-named projects ("Sky Villas" in Mumbai and in Dubai,
  different developers) and confirmed both resolve correctly by
  developer + city, not by name alone.
- **Flag-color country chips** — implemented as a restrained accent (a
  3px underline in each country's flag colors), not a full saturated
  fill. That was a deliberate creative call, not me dodging the
  instruction: full flag-colored buttons would clash badly against the
  black/silver system and read cheap; the underline keeps the
  recognition value you asked for without breaking the restraint the
  palette is built on.
- **Every change verified by actually running the code**, not just
  reading it: built a Node/DOM-stub harness that executes the real
  `renderDeveloper`/`renderProject` functions from the live file and
  calls them for all 7 developers and all 9 projects (locked and
  unlocked) — all pass without throwing. This is a stronger check than
  previous passes used, and going forward it's how structural changes
  get verified before shipping, not just via static syntax checks.

**Not done — flagged honestly rather than glossed over:**
- Wing-level modeling, history, litigation, micro-market, and
  Questions to Ask exist **only for Lodha Park**. The other 8 projects
  still use the flatter model. That's real content-writing work for
  each one, not a quick pass.
- **Unit-mix/inventory data** (units by type, sold vs. unsold velocity)
  and **deeper title-chain detail** (7/12 extract, Index II, sub-registrar
  search report specifics beyond the encumbrance check) — both flagged
  in the last audit, neither built yet.
- **Virality mechanics** — the shareable Trust Score Card and public
  "recently flagged" feed are still ideas, not built. I called this out
  last round too and didn't get to it this round either; it's next.
- **A full independent creative visual pass on the report page** —
  the flag-chip decision was one real instance of exercising judgment
  rather than just executing, but I have not yet done the bigger visual
  work (the report page still reads denser/grayer than an actual
  institutional PDF) that a genuine ground-up creative pass would cover.

**On integrating Questions to Ask vs. a separate sheet** (you asked for
my judgment directly): integrated, because it's derived entirely from
that specific report's own findings and belongs with them contextually
— a separate file would fragment one paid deliverable into two things to
manage, undercutting the "$1 buys $100" feeling rather than reinforcing
it. It's still visually distinct enough (bordered, grouped by recipient)
to print or reference on its own if someone wants to bring just that
page into a meeting.



You caught a real domain-accuracy bug: the whole data model treated a
project as one monolithic building, when real RERA projects (Lodha Park
included) are usually multiple separately-registered wings, each with
its own OC status and completion percentage. Fixed for Lodha Park as the
flagship example — `PROJECTS['lodha-park']` now has a `wings[]` array
(3 wings, 2 complete with OC, 1 at 88% with one filed date revision), a
`history[]` timeline (7 dated events, launch through the most recent
revision), a dedicated `litigation` object (case-level detail, not mixed
into general findings), and a `possessionOutlook` with deliberately
hedged forward-looking language — never a guarantee, always framed as a
reading of the pattern in the data. `renderProject()` now builds its
section list dynamically, so numbering stays correct whether a project
has 2 paid sections or 6.

**Score changed from 81 to 77** as a direct result — a project that's
2/3 complete with one filed revision is not the same as "fully
delivered," and the score should say so. That's the model working
correctly, not a regression.

**Also fixed while in there**: the free/paid comparison table had no
mobile breakpoint — a 3-column grid with no override, which the file
now has 2 total mobile media queries to draw from (previously the file
had exactly 2 breakpoints total in ~1600 lines, which is a real gap I'm
flagging rather than fully solving this pass).

**Not yet extended to the other 6 projects** — Lodha Park is the proof
of concept; the same wing/history/litigation treatment needs to be
written for the rest, and that's real content-writing work, not a
one-line fix.

**The self-audit**, since it was asked for directly: color palette has
now changed three times on explicit instruction, which means I should be
forming and stating independent opinions rather than only executing —
so, stated plainly: I think black/silver is right and I'd defend it, but
the report page itself doesn't yet feel as premium as the palette
allows — it's still fairly dense/gray relative to an actual institutional
document. The homepage has no content below the search box — no
methodology transparency, nothing that builds trust before a search
happens. Nothing on the site is inherently shareable yet. Full list is
in my chat response for this round rather than duplicated here.



You were right, and I checked the actual numbers rather than argue: every
section (`legal_text`, `delivery_text`, `price_text`, etc.) was 10–13
words. The "locked" teaser and the "unlocked" content were nearly the
same length — the paywall was gating almost nothing. That's a real
product defect, not a styling one, and no amount of CSS work on top of
it would have fixed it.

**What changed**: replaced every one-line field, across all 7 developers
and all 7 projects (zero skipped — verified by script, not by eye), with
a real structure:
- A synthesized **summary paragraph** (analysis, not just a fact statement)
- An itemized, cited **"Key Findings" list** (3–4+ specific findings per
  section, each marked `[1]` if it traces to a checked public record or
  `†` if it's an unverified public claim excluded from the score — same
  verified/unverified convention the site already used, just applied
  consistently instead of once)
- Where genuinely defensible, an **"In Context" benchmark** — e.g. Lodha
  Group's portfolio-wide delivery record compared against the 3 Lodha
  projects actually in this dataset. Deliberately never a fabricated
  external "market average" — only comparisons the dataset can actually
  support, so nothing here overclaims what a demo can back up.

**The free/paid split is now real**: the locked-section teaser pulls the
*actual* finding count and flag count from the data ("6 findings on
record, including 1 unverified claim") instead of generic copy, so the
paywall signals real depth behind it rather than guessing at what might
be there. A free/paid comparison table now shows exactly what unlocking
adds, and a sticky "Unlock Full Report" bar appears once you've scrolled
past the free section (only while locked — gone the instant payment
succeeds).

**Proof, not just a claim**: regenerated the Lodha Park demo PDF against
this new data — it went from 1 page to 2, with a full "Key Findings" list
per section plus the Developer Context section and its benchmark. Same
file as before, ask for it again if you want to see the diff directly.

**Adopted from the other file, as asked** — not rejected wholesale:
a free-vs-paid comparison table and a sticky unlock bar, both rebuilt in
this site's own black/silver system rather than copied wholesale (their
version used glassmorphism and gold-on-black, which we'd already moved
away from for legibility reasons). Timeline and risk-heatmap components
from that file are still on hold — building them well means real
milestone-level and category-level data behind them, which the current
demo dataset doesn't have yet; adding the UI first without that data
would be exactly the "looks deep, isn't" problem this whole pass was
about fixing.



Purple was still one signature color too many. Rebuilt again to the exact
brief: black and silver, full stop, with color spent nowhere except the
trust score itself.

**Palette**: true black (`#0A0A0C`) for all structure and text, cool
near-white (`#F8F8F9`) for backgrounds, and a three-step polished-silver
system — `--gold` (mid silver, buttons/active states), `--gold-bright`
(shine, hover states and anything sitting on a dark background),
`--gold-deep` (dark pewter, for small text/labels on light backgrounds,
where actual silver would be too low-contrast to read). That three-step
split exists for one reason: literal silver is genuinely hard to read as
small text — a flat "make everything silver" pass would have failed the
80-year-old test on the first caption. Verified every pairing anyway
(table below).

**Verdict system reverted to real red/green**, on purpose — this
overrides the "silent = good" logic from two passes ago. You're right
that it doesn't hold for this audience: red/amber/green is the one color
code that needs zero explanation to literally anyone, at any age, in any
market. `--ok` is a deep, elegant emerald (`#1E7A42`), not a bright
"app" green; `--accent` red (`#C0392B`) doubles as the wordmark color, so
it's not a new addition — it's the one place the palette had color all
along, now doing double duty on purpose.

**Legibility pass** (the actual point of "an 80-year-old shouldn't
struggle"): every font-size under 13px in the entire file got bumped up
— captions, labels, tags, timestamps, all of it now sit at 13–14px
minimum instead of 10–12.5px, and body/paragraph text moved from
14.5–15px up to 16–16.5px. Re-verified contrast on every text/background
pairing in the palette — all clear WCAG AA, most clear AAA (7:1+):

| Pairing | Ratio |
|---|---|
| Ink body text on bone background | 17.94 |
| Silver-label text (`gold-deep`) on white | 7.96 |
| Black text on silver button | 10.15 |
| White text on black button | 18.64 |
| Trust-score green on white | 5.36 |
| Trust-score red on white | 5.44 |

**Diamond finish**: every primary/secondary button now has a restrained
diagonal shine sweep on hover (light catching a polished edge, not a
cartoon shimmer), and the score numeral gets a brief metallic flash the
instant its count-up animation finishes — the one moment on the page
designed to feel like a reveal. Both respect `prefers-reduced-motion` and
turn off entirely for anyone with that setting on.

Same method as every pass before this: variable names never changed, only
values — so this was a token-and-font-size sweep, not a rewrite. Full
syntax/ID/function integrity check and the full contrast table above both
verified clean before shipping.

## Fourth pass — repalette: black, bone, and one true signature color

The green read as consumer fintech (Robinhood, Cash App, Acorns all use
green-forward palettes) — the opposite of what a private, institutional
trust product for high-net-worth buyers wants to signal. Rebuilt the
palette from a different premise entirely:

**The logic**: the most expensive-feeling brands in the world — Chanel,
Hermès, Aesop, the Amex Centurion "Black Card" — use almost no color at
all. Restraint reads as expensive; a full chromatic accent system reads
as SaaS. So the interface is now ~95% black ink (`#0C0D10`) and warm bone
paper (`#FAF8F3`), with color spent on exactly two things: a single
signature accent, and the verdict system.

**The signature color is `#3B1F3D` — a deep imperial purple**, dark enough
to read as black until it catches light on a large surface (the score
numeral, the verification seal). The choice isn't decorative: Tyrian
purple dye was, for over a thousand years, the single most expensive
substance in the ancient world — worth more than gold, restricted by law
to royalty in Rome and Byzantium. "Born to the purple" is the actual
etymology. For a product whose entire pitch is *verified* wealth, that's
a real, explainable reason to use it — not a random pick — and it's not
occupied by any competitor in this category (everyone else is blue, green,
or gold).

**The verdict system got quieter, not just recolored**: "Trusted" no
longer gets a colored tag at all — it renders in plain ink, the same as
everything else. Color now only appears when something needs the reader's
attention: muted ochre for "Proceed with Care," the existing stamp-red for
"High Caution." Good news is silent; only flags are colored — the same
logic as proofreading marks, which is a more precise signal than "green
means good" ever was.

**Why this travels globally better, not just aesthetically**: black,
white, and grey carry the most consistent connotations of any palette
across cultures (formal, serious, timeless) — where green, gold, and red
each carry real regional swings (green reads finance in the US but has
different associations elsewhere; red is luck in China and danger in the
West; gold trips into "tacky" fast outside a jewelry context). Purple, at
the near-black depth used here, doesn't carry the same baggage and has a
positive, wealth-coded association in most of the markets on the country
list (India, UAE, UK, Singapore all have some version of the
royalty/rarity association).

Every CSS variable name stayed identical through this change — only the
hex values moved — so this was a single, low-risk token swap rather than
a rewrite. Re-verified: all text/background pairs exceed WCAG AA contrast
(full numbers in the commit), and the full JS syntax/ID/function integrity
check still passes clean.

## Third pass — visual redesign + audit fixes

**Redesign** (you gave full creative freedom on color/type/feel): replaced
the gold/burgundy "luxury fintech" palette — a look-alike for Amex
Platinum/crypto-app cliché — with a distinct "verified public record"
identity: crisp paper background, deep prussian ink for structure, and a
verified-seal green as the sole trust accent (stamp-red stays reserved for
the wordmark + genuine risk, per the original brief's own rule). Typography
moved from Inter/Source Serif 4 (the most common startup pairing there is)
to Fraunces (certificate-grade display serif) + IBM Plex Sans/Mono. Added
a circular verification-seal signature mark to the report letterhead —
the one deliberately distinctive element, kept restrained everywhere else.

**Audit fixes** (from your team's UX/security review):
- **Free vs. paid split, implemented for real.** Free view: score,
  verdict, and one full section. Everything past that is blurred with an
  honest one-line teaser and an unlock CTA. Paying re-renders the full
  report. Flagged clearly in-code: in this client-only demo the "locked"
  text still ships in the page source — the real backend must withhold
  those fields until payment clears, or paying buys nothing a browser's
  view-source didn't already give away.
- **Found a real broken button while fixing accessibility**: "My Reports"
  called a modal that didn't exist anywhere in the file. Built it for
  real instead of just deleting the link — unlocked reports now persist
  to localStorage, survive a refresh, and show up there.
- **Accessibility**: onclick-only `<a>`/`<div>`/`<span>` elements are now
  keyboard-operable (role="button" + Enter/Space), modals get real focus
  management (focus moves in on open, returns to the trigger on close),
  Escape and click-outside now close modals (neither existed before —
  only the × button did), added a skip-to-content link, and darkened
  `--stone-light` from a 3.2:1 to a 5.0:1 contrast ratio (was failing
  WCAG AA).
- **Cookie/data notice** added — worded honestly for what the app
  actually does (localStorage only, no third-party trackers), not
  boilerplate for data collection that isn't happening.
- **PWA basics**: `manifest.json`, a minimal offline-shell service worker,
  and an icon set (cropped from your uploaded logo mark — see note below).

**Pushed back on, with reasons**: fake social-proof counters and
urgency/scarcity timers (actively undermines a trust product), a
gauge/radar score visualization (your own design direction already
correctly rejected this — "a gauge implies a spectrum, a number implies a
measurement"), gamified confetti, an age-gate (not a legally age-restricted
product), and a consent checkbox before search (search is anonymous — no
personal data collected at that step; consent is correctly gated later, at
OTP/payment, where data actually is collected).

**Icon note**: `icons/` was generated by cropping the shield mark out of
your uploaded logo reference PNG, since it has no transparent-background
version. It's a usable stopgap for the manifest/favicon, but a real
transparent-background export from whoever designed the mark will look
noticeably cleaner — worth getting before launch.

## Why a live, unlimited public search engine isn't a one-shot build

You're right that this should feel like CIBIL — but CIBIL works because
banks *feed* it verified data continuously; it doesn't scrape the internet
live on every query. ShelterKart's equivalent is the Tier-1 registry
connectors (MahaRERA, Dubai Pulse, Companies House, URA/ACRA, etc.) — this
is the one part of the whole system that is genuine, ongoing data
engineering (and in some states, a data partnership), not something that
can be "finished" in a document. Everything *around* it — scoring logic,
caching, auth, fraud prevention, monetization — is done and ready. The
honest scope of "build once" is: build the machine once, then feed it
country by country as each connector goes live — which is exactly the
phased rollout your own Developer Brief already lays out (Mumbai + Dubai
first, then Pune/Bengaluru/Abu Dhabi, then UK/Singapore).

## The AI-last-layer cost architecture (already built into server.js)

This is the part that keeps your AI bill from scaling with traffic:

1. **Tier 0 — cache.** Every report is stored. A repeat search is a free
   database read, `fromCache: true`, no AI call.
2. **Tier 1 — free re-check.** Once a cached report passes 7 days
   (`RECHECK_DAYS`), the system re-pulls *only* the free, structured
   registry fields (`fetchStructuredLegal`) — no LLM — and compares them
   to what's cached (`hasSourceChanged`). If nothing material changed
   (registration status, litigation count), the cache timestamp just
   refreshes. Zero AI cost.
3. **Tier 2 — AI, only when something actually changed.** The full
   pipeline — which is where an LLM call happens, strictly to summarize
   *retrieved* documents in plain language, never to invent facts — only
   runs when Tier 1 detects a real change, or on a genuinely new search.

This means AI spend scales with *real-world change events*, not with
search volume — a developer with a clean, static record costs you nothing
in AI calls after the first report, no matter how many people search them.

## Security & anti-abuse model

| Threat | Mitigation |
|---|---|
| Competitor/bot scraping the API directly | CORS locked to `ALLOWED_ORIGINS` — only your frontend's real domain can call it from a browser |
| OTP-bombing a phone number (cost abuse) | Per-phone limit (5/hour) **and** per-IP limit (5/15min) **and** CAPTCHA gate once `TURNSTILE_SECRET` is set |
| Fake/spam checkout records | Rate-limited, amount-sanity-checked, still recorded as `pending_payment` (never charges without a real provider webhook) |
| Dispute-queue flooding | Rate-limited (10/hour/IP) |
| SQL injection | Every query is parameterized (`$1, $2...`) — no string-built SQL anywhere |
| Search-endpoint DoS via huge input | 100-character cap on query length |
| Stack traces leaking to users | Generic error handler returns a flat 500 message; details only hit your server logs |
| Report-generation abuse (fake reports) | `/api/report/:type/:id` only ever reads from the DB or the real pipeline — there is no path that lets a client-supplied score get written |

None of this replaces a security review before real money moves through
it, but it closes every abuse vector you specifically flagged.

## Running the backend

```bash
cd backend
npm install
cp .env.example .env        # fill in DATABASE_URL, ALLOWED_ORIGINS at minimum
psql "$DATABASE_URL" -f schema.sql
npm run dev
```

Then in `shelterkart-frontend.html`, change:

```js
const API_BASE = "";
```

to your deployed API URL. Every OTP, dispute, and checkout call already
targets `${API_BASE}/api/...`. `/api/report/:type/:id` correctly returns
501 until the Tier-1 pipeline is connected — it will never pretend to have
data it doesn't.

## What your developer still needs to plug in (genuinely external, by design)

- **SMS provider account** (MSG91 for India, Twilio elsewhere) — real
  OTP delivery.
- **Cloudflare Turnstile site key** — free, ~10 minutes to set up, gates
  bot abuse on OTP/checkout.
- **Payment provider** (Razorpay for India, Stripe elsewhere) — checkout
  is fully wired up to the point of creating the order; the provider SDK
  call itself is the one stub.
- **Bank account / payout details** — provider-side setting, not code.
- **Tier-1 registry connectors** — the actual data engineering: pulling
  and parsing MahaRERA/Dubai Pulse/Companies House/URA filings (with OCR
  for scanned PDFs), one country at a time, per the Developer Brief's own
  rollout sequence.
- **An LLM API key** (Claude or GPT) — only for the plain-language
  synthesis step, strictly grounded to retrieved documents (Tier 2 above).
