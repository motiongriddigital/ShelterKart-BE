# ShelterKart — success metrics

What "working" means, how each is measured, and the target to start from. Targets are starting points: revisit them after the first three months of real traffic.

**On the dashboard** means `admin.html` shows it live, in **Success metrics** or elsewhere. **Monthly** means a manual check, listed with how to do it.

## North star

**Paid reports per week.** It's the one number that moves only when buyers find the product, trust it, and pay for it. The dashboard's Paid reports figure, on the 7-day view. There's no target until launch: set it from the first four weeks, then aim for steady week-on-week growth.

## 1. Buyer value: is it worth far more than it costs?

| Metric | How | Target |
|---|---|---|
| Disagreements surfaced per paid report | Monthly: average number of "where sources disagree" items in paid reports | ≥ 1. Each one is a question the buyer would otherwise not have asked |
| Reports with a key-fact disagreement (possession, registration, price) | Monthly: share of paid reports | Tracked, no target. This is the "saved a buyer from a surprise" count, and the best marketing material |
| Buyer protections delivered | Every paid report in a covered market carries them (India, Dubai, UK, Singapore; tested) | 100% in covered markets |
| PDFs saved per paid report | **On the dashboard** | ≥ 60%. Buyers keep what they value |
| Documents checked per paid report | Dashboard: Document checks ÷ Paid reports | ≥ 20% |

**The ROI case to tell buyers.** It rests on the report's own content, never on a promise:
- **Never pay more than 10% before a registered agreement.** On an ₹88 lakh flat, that caps the money exposed before legal protection at ₹8.8 lakh.
- **Delay interest.** At an illustrative 10% a year, it's about ₹83,000 a month per crore.
- **About ₹10 lakh to budget beyond an ₹88 lakh Mumbai price**: ₹5.28 lakh stamp duty (6%), ₹30,000 registration (the cap) and ₹4.4 lakh GST (5%, under construction).

Each of these alone is worth hundreds of times ₹1,499. Don't put a single "you will save ₹X" number in marketing: the savings depend on the buyer's case.

## 2. Quality: is it right?

| Metric | How | Target |
|---|---|---|
| Open disputes per 100 paid reports | **On the dashboard** | ≤ 2 |
| Disputes resolved within 7 days | Monthly: admin disputes, submitted vs resolved | ≥ 90% |
| Accuracy audit | Monthly: pick 10 paid reports at random and check every confirmed or reported finding against its cited page | ≥ 98% of findings say what their source says |
| Score reproducibility | Every score is recomputed from its report by a test (methodology SK-2) | 100% (tested) |
| Protections verified within 6 months | A test fails after 183 days | Always (tested) |

## 3. Fairness: is it fair to developers?

| Metric | How | Target |
|---|---|---|
| Developer replies reviewed within 7 days | Admin: developer replies | ≥ 90% |
| Findings corrected after a valid developer reply | Monthly | Every valid one, within 7 days |
| Scores moved by single-source or developer-only claims | Rule enforced in code and tested | Zero |

## 4. Business: does it pay?

| Metric | How | Target |
|---|---|---|
| Visitor → paid report | **On the dashboard** | ≥ 2% |
| Unlock click → paid | **On the dashboard** | ≥ 50% |
| Revenue per currency | **On the dashboard**, never summed across currencies | Grows month on month |
| AI cost per PAID report | Monthly: Anthropic invoice ÷ paid reports. It must include every free preview, because each unreused search runs a fresh research | Under 20% of the average price (the plan assumes about 8%) |
| Searches per paid report, and reuse rate | Monthly: searches ÷ paid reports; share of searches served from a stored report | About 12 and about 70% (plan assumptions; replace with measurements) |
| Cost to win a buyer (CAC) | Monthly: marketing spend ÷ paid reports, by market | ₹800 or less in India; tranche 2 is released only when this holds at 1,000 paid reports a month |
| Refund rate | Monthly: Razorpay refunds ÷ payments | ≤ 3% |
| Instagram campaigns | **On the dashboard**: Campaigns (use `utm_campaign` on every link) | Compare reels by paid reports, not views |

## 5. Reliability

| Metric | How | Target |
|---|---|---|
| Searches answered | **On the dashboard** | ≥ 97% |
| Official registers healthy | **On the dashboard**: Official registers | No register "down" for more than 48 hours |
| Payment completion | Razorpay dashboard: captured ÷ attempted | ≥ 85% |

## What to watch weekly

Paid reports, Visitor → paid, Unlock → paid, searches answered, and open disputes. If Unlock → paid falls, look at checkout and price. If Visitor → paid falls while Unlock → paid holds, look at the free preview: it isn't showing enough to earn the click.

## Language

| Metric | How it is measured | Target |
|---|---|---|
| Search-to-checkout by reading language | Admin dashboard, Languages panel (`analytics_events.lang`) | No language more than 20% below English; a language well above English earns priority for the next wave |
| Translation fallbacks | Share of report sentences shown in English because a check failed (`i18n.fallback ÷ i18n.total`, logged per report) | Under 5% per language; above it, review the glossary for that language |
| Translation cost | Anthropic invoice for translation calls ÷ reports opened in that language | Under 10% of AI research cost; sentence caching should push it lower over time |
