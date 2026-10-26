# ShelterKart — investor demo script (about 5 minutes)

## Before the meeting

- **Keep `shelterkart-frontend.html`, `admin.html` and the `sample-reports` folder in one folder.** The PDF links depend on it.
- **Open both files in browser tabs before you walk in.** The demo needs no internet. The headline font is built in, so it looks right on weak Wi-Fi.
- **Browser zoom at 100%.** Do one full dry run tonight.
- **When the site loads, tap OK on the small storage notice** at the bottom, so it doesn't cover the report.
- **Don't open the footer pages.** They show a red "Draft" banner until your business details are filled in.

## The walkthrough

**1. The problem (30 seconds, before touching anything).**
"Buyers commit lakhs, often crores, to a home that doesn't exist yet, based on brochures and listing sites. Those sources disagree, and nobody tells the buyer which one to believe."

**2. Search (30 seconds).** On the site tab, scroll to the search box and tap **Hubtown Celeste · Mumbai**.
"Three searches run side by side: the official record and the developer's own website, the developer's track record, and what buyers say. Then every claim is graded by its sources."

**3. The free preview (45 seconds).**
- Point to **80/100 on the rating scale**: "Strong public record, medium confidence."
- Point to **"What buyers say: Not assessed"**: "We found no independent buyer reviews, so that part is left out, not scored low. What we can't find is never held against a developer."
- Scroll to the lock: "This is what's free. The full report is ₹2,100, one price, set by this property's value and the depth of its evidence, and the same for every buyer in the world. My country only decides the currency: watch." Change the country under the button to **United Kingdom**: the button reads £17. Change it back to **India**.
- If asked how it scales: "A ₹1 crore home's report costs about ₹2,100; a ₹20 crore home's about ₹11,000."

**4. Unlock and pay (30 seconds).** Tap **Unlock the full report**. Point at the checkout: "The property stays in its own currency. The fee, the GST and the total are separate lines that add up, and the price is locked for 30 minutes." Tap **Pay ₹2,100**.
(Optional: before paying, set **Billing country** to United Kingdom and tap Pay: "If the billing country differs, the buyer sees the new total next to the old one and confirms again. Nobody is ever charged a total that wasn't on screen." Set it back to India.)
"In the demo no money is taken. In the live product this is Razorpay."

**5. The full report: the value moment (90 seconds).**
- **Where sources disagree:** "Seven listing sites give possession dates from March 2027 to July 2029. None comes from Hubtown or MahaRERA, so we don't count it against Hubtown. But the buyer now knows to ask for the date on the registration."
- **Developer track record:** "Hubtown handed over a tower of its 25 South project, from its own earnings commentary, corroborated by a portal."
- **Questions to ask:** each comes with what a good answer and a red flag look like.
- **Your protections as a buyer:** "Never pay more than 10% before a registered agreement, under RERA Section 13. If possession is late, interest every month. At an illustrative 10% a year, that's about ₹83,000 a month on ₹1 crore. And about ₹10 lakh to budget beyond an ₹88 lakh Mumbai price, which a home loan won't cover. Any one of these is worth many times the report's price."

**6. The method (30 seconds).** Tap **How this score is worked out**.
"Code works out the score, not AI. It's published and versioned. A single review or a developer's own marketing never moves it."

**7. Another market (20 seconds).** Scroll back up to the search box and tap **Creek Bay Tower B · Dubai Creek Harbour**.
"For a buyer in India this is ₹3,600; a buyer in Dubai pays AED 140, the same report in dirhams, from its listed prices and a Heavy report. Emaar averages 1.5 out of 5 across 117 Trustpilot reviews. We show the buyer that, along with Trustpilot's own warning that the reviews may not be representative. One platform doesn't move the score."

**Optional, if asked "do you ever give a low score?" (40 seconds).** Scroll up and tap **Casagrand Casamia · Chennai**, then unlock.
"55, weak public record, and low confidence. Two independent publications report that Tamil Nadu's regulator penalised this same company for misrepresentation on earlier projects, including one cancelled registration. The report also says the developer denied the charges, that we couldn't find whether the cancellation was overturned on appeal, and that its own site still lists that project. A buyer petition and a recent delay order are shown, but not scored, because each has only one source. That's the fairness rule working in both directions."

**Optional, the language moment (30 seconds).** Choose **हिन्दी** in the language picker above the search, then open Hubtown Celeste (Casagrand Casamia is in Hindi too).
"Half of the market can't use an English-only report. The same report, in Hindi, with the same score, price and registration number. Only words are translated: code checks every number and name survives, and anything doubtful stays in English. It says plainly that it's an AI translation and the English governs." Then switch to **العربية** and open Creek Bay: "and Arabic, right to left." Switch back to English before step 8.

**8. The owner's view (45 seconds).** Switch to the admin tab and tap **Open the demo dashboard**.
- **Say first:** "This traffic is simulated. It shows what the dashboard measures, not traction."
- **Reports:** tap **Open full report** to show the complete PDF.
- **Success metrics:** "Six numbers against targets. Here, searches answered is just below target, and the dashboard says so."

## Questions you may get, and honest answers

**Traction?** "Pre-launch. The dashboard you saw runs on simulated traffic. Launch is India first, through Instagram reels and WhatsApp sharing, where awareness is cheapest, and every campaign is measured down to paid reports."

**Isn't scoring named developers a legal risk?** "The method is published and versioned. Negative findings count only when two independent sources agree or an official record confirms them. Developers can reply for free, and replies are published alongside the finding. There's a corrections process, and a lawyer is reviewing the method and Terms before launch."

**Do you only give good scores?** "No. The five samples range from 80 down to 55. Casamia is low because of corroborated regulator penalties, and the report shows the developer's side too."

**How do you price?** "One price per report, set by code from the property's value and the depth of the evidence, the same in dollars for every buyer. The buyer's country decides only the currency, tax and payment method, so there's no reason to fake a country. Prices come from a published price book of round numbers per currency, which doesn't move with daily exchange rates. ₹2,500 for a typical purchase; never less than ₹1,450 or more than ₹15,000. It never depends on the score."

**Why would buyers pay?** "Because the protections and the disagreements alone are worth many times the price. The free preview shows enough to earn the click."

**What's the moat?**
- **The evidence engine:** every claim is graded by its sources, and unsupported claims are removed.
- **Ten live official-register connectors.**
- **Fairness rules enforced by tests.**
- **A cited dataset of buyer protections by market.**
- **Trust:** paid only by buyers, never by developers.

**Unit economics?** "In India about 66% of an average report's price is contribution, after GST, payment fees, refunds and AI, and the AI cost counts every free preview. What we have not measured is the cost to win a buyer. Break-even is about 1,000 paid reports a month at ₹600 a buyer, about 1,300 at ₹800, and over 5,000 at ₹1,200. The raise pays to find that number, and the second tranche is released only once it's proven."

**What about languages?** "Eight languages: English, Hindi, Arabic, French, Polish, Traditional Chinese, Spanish and German. That covers the main language of buyers in 90% of our TAM; Czech, Dutch and the Nordic languages are next. Half of the TAM is in markets where a buyer wants the report in their own language, so language is what makes 'online in 22 markets' true. Translation never changes a fact, and we measure conversion per language before adding the next."

**How big is the market?** "About ₹1,328 crore a year across 22 markets: 1.9 million new homes bought a year, two reports researched per purchase, at about $40 a report outside India and the engine's own price in India. About ₹1,059 crore of that is reachable online, and we're online in all 22 from day one. What we can win depends on how many buyers know us: ₹3.7 crore a year at 5% awareness, ₹8.8 crore at 12%. Reports alone are a modest market, and we say so. The United States, Canada and Germany would add about 51% more, from official counts. Subscriptions and lender checks are not built, and they are in no number."

**Why this valuation?** "We ask ₹15 crore post-money, the top of the 2026 pre-seed band: pre-money runs ₹3–10 crore, ₹3.9–14 crore with the premium AI companies command, and practitioners target ₹10–15 crore. Weighted across the methods the fair value is about ₹11 crore, so we expect to land between ₹11 and ₹15 crore, with a floor of ₹10 crore. We would move to ₹20 crore only on proof: the score validated, a Merchant of Record cleared, and the first real buyers. The VC maths does not close on reports alone, and we would rather you hear that from us. The first ₹1 crore is priced on what's built; the next ₹1.5 crore on proof."

**What does an investor have to believe?** "That reports in 22 markets are the foundation, and that more markets and revenue that repeats follow. At ₹15 crore, reports alone return about 0.5 to 4.5 times; with three more markets and recurring revenue, 8 to 14 times. The moats, and the scale path, are the investment."

**Isn't the market bigger than that?** "The ₹1,328 crore already adds up all 22 countries; India is only an eighth of it. It moves with two assumptions: the price per report and how many reports a buyer researches. We use $40 and two, the conservative middle. The most generous combination is about three times larger, and we don't use it because nothing measured supports it yet. The closed beta measures both."

**Why not ₹30 crore?** "Because ₹30 crore needs about ₹141 crore of yearly revenue, which is 13% of today's market, and we haven't earned any yet. ₹30 crore is what we think the next round is worth once we have 1,500 paid reports a month across two markets, a validated score and a live Merchant of Record. That is inside the 2026 seed range, and it is the price of the second tranche."

**Data access risks?** "Maharashtra's regulator blocks automated access, and Dubai's open-data access is still pending. Reports say this openly, and we corroborate across independent sources meanwhile. Both applications are part of the launch plan."

**How many markets?** "Research works in 22 markets. Ten have live official-register checks."

**How is this different from property portals?** "Portals earn from the people who list on them. ShelterKart is paid only by buyers, and the price never depends on what a report finds."

## Don't say

- **Don't present simulated numbers as traction.**
- **Don't say a regulator confirmed anything for Hubtown.** Its registration is corroborated by several independent sites, not confirmed at MahaRERA.
- **Don't promise "you'll save ₹X".** The savings depend on each buyer's situation.
