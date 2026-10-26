"""SOM (awareness-driven), cash plan and valuation. Reads market.json written by market_model.py. Every assumption is named."""
import json, math, os
HERE = os.path.dirname(os.path.abspath(__file__))
D = json.load(open(os.path.join(HERE, 'market.json'))); T, INR = D['T'], D['INR']
SAM_OPPS, WAVG = T['sam_reports'], D['wavg']            # online-reachable report opportunities; weighted avg price paid (USD)

# ---------- assumptions (all flagged in the deck) ----------
SEARCH_TO_PAID = 0.08      # target: dashboard's 2% visitor->paid, with about a quarter of visitors searching; UNVALIDATED until launch
NEW_RESEARCH_SHARE = 0.30  # share of searches that need fresh research (70% reuse of stored reports); UNMEASURED
AI_PER_RESEARCH = 1.00     # USD per new research (Anthropic published prices); UNMEASURED
TAX = 0.15                 # illustrative sales tax inside the price (CA to confirm); India GST is 18%
FEES, REFUNDS = 0.03, 0.03 # gateway (blended), refunds
price_net = WAVG / (1 + TAX)
ai_per_paid = (1 / SEARCH_TO_PAID) * NEW_RESEARCH_SHARE * AI_PER_RESEARCH
contrib = price_net * (1 - FEES - REFUNDS) - ai_per_paid - 0.04
print(f"avg price paid ${WAVG:.2f} (net of tax ${price_net:.2f}); AI per paid report ${ai_per_paid:.2f} (Rs {ai_per_paid*INR:.0f}); contribution before marketing ${contrib:.2f} ({contrib/price_net*100:.0f}% of net revenue)")

# ---------- SOM: awareness x conversion ----------
SC = [('Lean', 0.02), ('Base', 0.05), ('Scale', 0.12), ('Breakout', 0.25)]   # share of SAM report opportunities researched on ShelterKart (Year 5)
print(f"\nSAM report opportunities per year: {SAM_OPPS:,.0f}")
print(f"{'awareness':12}{'searches':>11}{'paid reports':>14}{'per month':>10}{'revenue $M':>11}{'Rs crore':>9}{'% of SAM':>9}")
som = {}
for name, a in SC:
    searches = SAM_OPPS * a; paid = searches * SEARCH_TO_PAID; rev = paid * price_net
    som[name] = dict(awareness=a, searches=searches, paid=paid, revenue=rev)
    print(f"{name+' '+format(a,'.0%'):12}{searches:>11,.0f}{paid:>14,.0f}{paid/12:>10,.0f}{rev/1e6:>11.2f}{rev*INR/1e7:>9.1f}{rev/T['sam']*100:>8.2f}%")

# ---------- 24-month cash plan, India-first (Rs lakh) ----------
def cash_plan(target_pm, cac, months=24, launch=3, ramp=15):
    price_in = 2500 * D['depth_mix']; net_in = price_in / 1.18
    per_report = net_in * (1 - FEES + 0.01 - REFUNDS) - ai_per_paid * INR - 3     # India gateway ~2%
    fixed = 6.17 * 1e5 + 1.0 * 1e5                                                  # team+ops, plus Rs 1 L/month of brand content
    cum, low, cashflow, reports_total = 0, 0, [], 0
    for t in range(1, months + 1):
        r = 0 if t <= launch else min(target_pm, target_pm * (t - launch) / ramp)
        flow = r * (per_report - cac) - fixed; cum += flow; low = min(low, cum); reports_total += r; cashflow.append(cum)
    return dict(peak_need=-low / 1e7, reports=reports_total, end_cum=cum / 1e7, per_report_after_cac=per_report - cac)
print("\n24-month cash plan, India-first (peak cash need in Rs crore):")
plans = {}
for label, target, cac in [('Prove it', 300, 1200), ('Launch', 1000, 800), ('Scale', 3000, 600)]:
    p = cash_plan(target, cac); plans[label] = p
    print(f"  {label:9} {target:>5}/month by month 18, CAC Rs {cac:>5,}: per report after CAC Rs {p['per_report_after_cac']:>5,.0f} | reports in 24 months {p['reports']:>7,.0f} | peak cash need Rs {p['peak_need']:.2f} Cr | cash at month 24 Rs {p['end_cum']:+.2f} Cr")

# ---------- valuation lenses (rebuilt 9 October 2026 on 2026 benchmarks) ----------
print("\nValuation lenses (post-money, Rs crore; $1 = Rs %.1f):" % INR)
usd_cr = lambda usd: usd * INR / 1e7
# 1. Stage benchmarks: three independent sources, each a range in Rs crore. Their midpoints are averaged.
BENCH = [('Cashfree: Indian pre-seed, $50-250K raised at a $1-3 M valuation', usd_cr(1e6), usd_cr(3e6)),
         ('Treelife 2026: pre-seed pre-money Rs 3-10 Cr, plus the 30-42% premium AI companies command (Zeni)', 3 * 1.30, 10 * 1.42),
         ('Practitioner guidance (Sane): target pre-seed valuation Rs 10-15 Cr at 8-12% dilution', 10, 15)]
bench_mids = [(lo + hi) / 2 for _, lo, hi in BENCH]; base_mid = sum(bench_mids) / len(bench_mids)
bench = (min(lo for _, lo, _ in BENCH), max(hi for _, _, hi in BENCH))
berkus = (6, 10)
# 2. Scorecard: the benchmark midpoint x weighted factors
factors = [('Team / execution', .30, 0.85), ('Size of opportunity (22 markets, SAM above)', .25, 1.05), ('Product / technology (built, tested)', .15, 1.35),
           ('Competitive environment (comparables exist: Truth Estate, Oliva, CRISIL)', .10, 1.05), ('Marketing, sales, awareness (none yet)', .10, 0.75),
           ('Need for further funding', .05, 0.9), ('Other: moat, independence, fairness engine', .05, 1.25)]
mult = sum(w * f for _, w, f in factors); score = base_mid * mult
# 3. Cost approach: what it would cost a competent team to rebuild what exists (a floor, not weighted)
ENG_PM = 20; PM_COST = (2.5, 4.0)       # person-months, and Rs lakh per person-month, fully loaded (estimates, see the investor brief)
OTHER = (10, 20)                         # Rs lakh: legal and tax drafts, register work, translation checks, sample research
cost = ((ENG_PM * PM_COST[0] + OTHER[0]) / 100, (ENG_PM * PM_COST[1] + OTHER[1]) / 100)
for src, lo, hi in BENCH: print(f"  1. Benchmark, {src[:60]}: Rs {lo:.1f}-{hi:.1f} Cr")
print(f"     average of the three midpoints: Rs {base_mid:.1f} Cr")
print(f"  2. Scorecard: midpoint x {mult:.4f}                       Rs {score:.1f} Cr")
print(f"  3. Berkus method, built product (Indian angels):   Rs {berkus[0]}-{berkus[1]} Cr")
print(f"  5. Cost approach (rebuild cost, a floor):          Rs {cost[0]:.1f}-{cost[1]:.1f} Cr")
EXIT_MULT = 3.9            # DealMatrix proptech EV/Sales benchmark; Zillow 2.5x; Finro median 6.8x
EXIT_MULT_HI = 6.8
RETENTION = 0.8 * 0.8 * 0.85; TARGET = 10
vc = {}
for name, uplift in [('report revenue only', 0.0), ('with recurring + B2B revenue doubling it (not built)', 1.0)]:
    row = []
    for sc in ('Base', 'Scale', 'Breakout'):
        ev = som[sc]['revenue'] * (1 + uplift) * EXIT_MULT; post = ev * RETENTION / TARGET
        row.append((sc, ev, usd_cr(post)))
    vc[name] = row
    print(f"  4. VC method ({name}): " + '; '.join(f"{sc}: exit ${ev/1e6:.1f} M -> Rs {v:.1f} Cr" for sc, ev, v in row))
ASK, STRETCH, FLOOR = 15, 20, 10
def needs(post):
    ev = post * 1e7 / INR * TARGET / RETENTION; return dict(exit=ev, revenue=ev / EXIT_MULT, reports=ev / EXIT_MULT / price_net, sam_share=ev / EXIT_MULT / T['sam'])
need = {str(k): needs(k) for k in (FLOOR, ASK, STRETCH)}; need_exit = need[str(STRETCH)]['exit']
for k, v in need.items():
    print(f"  For Rs {k} Cr post at a {TARGET}x target and {RETENTION:.0%} retention: exit ${v['exit']/1e6:.0f} M = revenue ${v['revenue']/1e6:.1f} M (Rs {usd_cr(v['revenue']):.0f} Cr) at {EXIT_MULT}x = {v['reports']/1e3:,.0f}k paid reports a year, {v['sam_share']*100:.1f}% of today's SAM")
# 5. Blended view
w = dict(bench=.40, score=.30, berkus=.15, vc=.15)
vc_scale_up = vc['with recurring + B2B revenue doubling it (not built)'][1][2]
blend = w['bench'] * base_mid + w['score'] * score + w['berkus'] * sum(berkus) / 2 + w['vc'] * vc_scale_up
print(f"\n  Weighted fair value (40% benchmark, 30% scorecard, 15% Berkus, 15% VC method with expansion): Rs {blend:.1f} Cr")
print(f"  Ask Rs {ASK} Cr; stretch Rs {STRETCH} Cr on proof; floor Rs {FLOOR} Cr. Tranche 1 stake at the ask: {1/ASK*100:.1f}%")
# 6. What an investor underwrites: outcome -> revenue -> exit -> money multiple at the ask
EXP = json.load(open(os.path.join(HERE, 'expansion.json'))); g = EXP['sam_growth']
paths = [('Base: 5% awareness, 22 markets', som['Base']['revenue']), ('Scale: 12% awareness', som['Scale']['revenue']), ('Breakout: 25% awareness', som['Breakout']['revenue']),
         ('Breakout, plus the US, Canada and Germany', som['Breakout']['revenue'] * (1 + g)),
         ('...and recurring + B2B revenue doubling it (not built)', som['Breakout']['revenue'] * (1 + g) * 2)]
returns = []
for name, rev in paths:
    rc = usd_cr(rev); lo, hi = rc * EXIT_MULT, rc * EXIT_MULT_HI
    returns.append(dict(name=name, revenue_cr=rc, exit_lo=lo, exit_hi=hi, ret_lo=lo * RETENTION / ASK, ret_hi=hi * RETENTION / ASK))
    print(f"  {name:58} revenue Rs {rc:6.1f} Cr -> exit Rs {lo:6.0f}-{hi:6.0f} Cr -> {lo*RETENTION/ASK:4.1f}x-{hi*RETENTION/ASK:4.1f}x for an investor at Rs {ASK} Cr post")
# 7. Tranche 2 at the milestone
arr = 1000 * 12 * (2500 * D['depth_mix'] / 1.18) / 1e7
print(f"  Tranche-2 milestone: 1,000 paid reports a month = net run-rate Rs {arr:.2f} Cr; at 10x -> Rs {arr*10:.1f} Cr pre-money (private SaaS median 4.5x, seed range Rs 25-70 Cr pre-money)")
json.dump(dict(som=som, plans=plans, score=score, mult=mult, factors=factors, blend=blend, contrib=contrib, ai_per_paid=ai_per_paid, price_net=price_net,
               vc=vc, need_exit=need_exit, need=need, arr=arr, bench_sources=BENCH, bench=bench, bench_mid=base_mid, berkus=berkus, cost=cost,
               ask=ASK, stretch=STRETCH, floor=FLOOR, returns=returns, exit_mult=[EXIT_MULT, EXIT_MULT_HI], retention=RETENTION),
          open(os.path.join(HERE, 'som.json'), 'w'), default=float, indent=1)
