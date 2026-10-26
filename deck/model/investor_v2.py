"""ShelterKart investor model, version 2 (October 2026). Reads market.json (22 markets) and markets_added.json (4 more with an
official or derived count of new homes) and writes investor_v2.json. The earlier model files are untouched.

What changed since version 1, and why each change is here:
  * Markets: 26 are sized (22 + Canada, Malaysia, the US independent segment, Germany); 10 more are live in the product but not
    sized until an official count of new homes sold is confirmed.
  * AI cost: the product is now a deep multi-engine investigation, not a one-dollar research. Cost per paid report is a RANGE
    built from components, and is UNMEASURED until the first live run.
  * Operating model: no engineers are hired; AI agents build and run the product; named outside professionals (lawyers,
    a chartered accountant) are retained as services. The founder draws a modest stipend (version 1 had none).
  * Valuation: the same three 2026 benchmarks, the same scorecard method, re-scored on the new facts, and the same blend.
Every assumption is named and flagged. Run this file to reproduce every number in the deck."""
import json, os
HERE = os.path.dirname(os.path.abspath(__file__))
M1 = json.load(open(os.path.join(HERE, 'market.json'))); ADD = json.load(open(os.path.join(HERE, 'markets_added.json')))
INR = M1['INR']; cr = lambda usd: usd * INR / 1e7
FACTS = json.load(open(os.path.join(HERE, 'facts.json')))   # counts from the code and a real test run (tools/count_checks.py)
ONLINE_DEFAULT, PRICE_DEFAULT, REPORTS = 0.83, ADD['price'], ADD['reports']

# ---------- 1. markets: 22 + 14 sized ----------
rows = [dict(r, units_low=r['units'], units_high=r['units'], confidence='official or derived') for r in M1['rows']]
for a in ADD['rows']:
    rows.append(dict(code=a['code'], name=a['name'], units=a['units'], units_low=a['units_low'], units_high=a['units_high'], confidence=a['confidence'],
                     basis=a['basis'], price_usd=PRICE_DEFAULT, tam=a['tam'], sam=a['sam'], online=ONLINE_DEFAULT))
rows.sort(key=lambda r: -r['units'])
T = dict(units=sum(r['units'] for r in rows), tam=sum(r['tam'] for r in rows), sam=sum(r['sam'] for r in rows),
         sam_reports=sum(r['units'] * REPORTS * r['online'] for r in rows))
# the range: each market's low and high count, with the same price, reports per purchase and online share
for k in ('tam', 'sam'):
    T[k + '_low'] = sum(r[k] * r['units_low'] / r['units'] for r in rows); T[k + '_high'] = sum(r[k] * r['units_high'] / r['units'] for r in rows)
T['units_low'] = sum(r['units_low'] for r in rows); T['units_high'] = sum(r['units_high'] for r in rows)
ESTIMATES = [r['name'] for r in rows if r['confidence'] == 'estimate']
WAVG = T['sam'] / T['sam_reports']
PENDING = ADD['pending']
MARKETS_IN_PRODUCT = 36
old = M1['T']

# ---------- 2. assumptions (all flagged in the deck) ----------
SEARCH_TO_PAID = 0.08      # searches that become a paid report. UNVALIDATED until launch (target from the earlier dashboard: 2% of visitors)
FRESH_SHARE = 0.30         # searches that need a fresh investigation; the rest are served from a stored report. UNMEASURED
TAX = 0.15                 # illustrative sales tax inside the price outside India (India GST is 18%)
GATEWAY, REFUNDS = 0.02, 0.03
price_net = WAVG / (1 + TAX)

# AI cost per paid report, from components (US$). UNMEASURED: the first live run exists to measure these.
#   sweep      the free preview: two engines read pages (done once per project per 30 days)
#   completion the paid investigation: lead rounds, reviewer, question writer (done for the first buyer; others get the stored report)
AI = {'Low (cheaper models)': dict(sweep=0.40, completion=3.0, fresh_completion=0.6),
      'Base': dict(sweep=1.00, completion=6.0, fresh_completion=0.6),
      'High (strongest models throughout)': dict(sweep=2.00, completion=14.0, fresh_completion=0.6)}
for k, v in AI.items():
    v['per_paid'] = (1 / SEARCH_TO_PAID) * FRESH_SHARE * v['sweep'] + v['fresh_completion'] * v['completion']
AI_BASE = AI['Base']['per_paid']

# unit economics at real price-book prices (gold-standard depth), per paid report
PER_USD = {'GBP': 0.86253 / 1.1401, 'AED': 3.6725}
PRICES = [('India, typical home (₹1.0 crore)', 2100 / INR, 1.18, 'Price book: ₹2,100 at gold depth for a ₹1.0 crore home; ANAROCK: ₹1.23 crore is the average ticket, Mumbai ₹1.47 crore'),
          ('Hubtown Celeste, Mumbai', 4300 / INR, 1.18, 'Price book: ₹4,300 (listings ₹1.99 to 5.96 crore)'),
          ('London new build', 42 / PER_USD['GBP'], 1 + TAX, 'Price book: £42'),
          ('Dubai off-plan', 170 / PER_USD['AED'], 1 + TAX, 'Price book: AED 170')]
ue = []
for name, gross, tax, src in PRICES:
    net = gross / tax; after = net * (1 - GATEWAY - REFUNDS)
    ue.append(dict(name=name, gross_usd=gross, net_usd=net, source=src,
                   margins={k: dict(contribution=after - v['per_paid'], pct=(after - v['per_paid']) / net) for k, v in AI.items()}))

# ---------- 3. SOM: awareness x conversion (unchanged method) ----------
SC = [('Lean', 0.02), ('Base', 0.05), ('Scale', 0.12), ('Breakout', 0.25)]
som = {}
for name, a in SC:
    searches = T['sam_reports'] * a; paid = searches * SEARCH_TO_PAID; rev = paid * price_net
    som[name] = dict(awareness=a, searches=searches, paid=paid, revenue=rev, cr=cr(rev), per_month=paid / 12, share_of_sam=rev / T['sam'])

# ---------- 4. operating model and cash: no engineers ----------
# Rs lakh per month, steady state
FIXED = [('Founder stipend', 1.00, 'A modest stipend; version 1 had none'),
         ('AI agent stack (building, operating, support)', 0.60, 'Agentic coding and operations subscriptions; usage-based'),
         ('Cloud, database, PDF and monitoring', 0.45, 'Servers, PostgreSQL, storage, headless-Chrome PDFs'),
         ('Retained lawyers and expert reviewers', 1.00, 'Pre-publication review of adverse findings; part-time, on retainer, not employees'),
         ('Chartered accountant, GST, secretarial', 0.25, ''),
         ('Insurance (professional indemnity, media liability)', 0.25, 'Assumption pending a broker quote'),
         ('Data and registers', 0.40, 'Paid company-data access where free registers end'),
         ('Messaging', 0.10, 'WhatsApp and e-mail delivery'),
         ('Brand content, organic', 1.00, 'Reels, search articles and community; tagged to paid reports')]
ONE_OFF = [('Security test and load tests', 8, 'External penetration test; an AI-run site still needs an outside one'),
           ('Legal set-up', 10, 'Methodology and terms review, DPDP, trademarks, conversion to a private limited company'),
           ('Design polish', 4, 'One-time')]
FIXED_PM = sum(f[1] for f in FIXED); ONE_OFF_TOTAL = sum(o[1] for o in ONE_OFF)
def cash_plan(target_pm, cac, ai_pp, months=24, launch=3, ramp=15):
    net_in = 2100 / 1.18                                              # India typical, gold depth
    per_report = net_in * (1 - GATEWAY - REFUNDS) - ai_pp * INR - 3   # after gateway, refunds, AI, messaging
    cum, low, flow_list, total = -ONE_OFF_TOTAL * 1e5, -ONE_OFF_TOTAL * 1e5, [], 0
    for t in range(1, months + 1):
        r = 0 if t <= launch else min(target_pm, target_pm * (t - launch) / ramp)
        cum += r * (per_report - cac) - FIXED_PM * 1e5; low = min(low, cum); total += r; flow_list.append(cum)
    return dict(peak_need=-low / 1e7, reports=total, end_cum=cum / 1e7, per_report_after_cac=per_report - cac, per_report=per_report)
plans = {}
for label, target, cac in [('Prove it', 300, 1200), ('Launch', 1000, 800), ('Scale', 3000, 600)]:
    plans[label] = dict(target=target, cac=cac, **{k: cash_plan(target, cac, v['per_paid'])
                        for k, v in AI.items()})
# the plan the round funds: 'Launch', at the Base AI cost

# the 24-month cash table for the plan the round funds: Launch (1,000 paid reports a month by month 18), Base AI cost. Rs lakh.
def cash_table(target_pm, cac, ai_pp, months=24, launch=3, ramp=15):
    net_in = 2100 / 1.18; reports = sum(0 if t <= launch else min(target_pm, target_pm * (t - launch) / ramp) for t in range(1, months + 1))
    revenue = reports * net_in / 1e5; fees = revenue * (GATEWAY + REFUNDS)
    lines = [(f[0], round(f[1] * months, 1), f[2]) for f in FIXED] + [(o[0], o[1], o[2]) for o in ONE_OFF] + \
            [('Paid acquisition', round(reports * cac / 1e5, 1), f'Rs {cac} per paid report, assumed; the rest is organic and viral'),
             ('AI usage: previews and investigations', round(reports * ai_pp * INR / 1e5, 1), f'${ai_pp:.2f} per paid report at the Base cost, UNMEASURED'),
             ('Messaging and delivery per report', round(reports * 3 / 1e5, 1), 'About Rs 3 per report')]
    spend = sum(l[1] for l in lines)
    return dict(lines=lines, spend=spend, revenue=revenue, fees=fees, net_revenue=revenue - fees, reports=reports, need=spend - (revenue - fees))
CT = {k: cash_table(1000, 800, v['per_paid']) for k, v in AI.items()}
BUDGET, SUBTOTAL = CT['Base']['lines'], CT['Base']['spend']
RAISE_TOTAL = 2.0   # Rs crore, both tranches

# ---------- 5. valuation lenses (same method as version 1, re-scored on the new facts) ----------
usd_cr = lambda usd: usd * INR / 1e7
BENCH = [('Cashfree: Indian pre-seed, $50-250K raised at a $1-3 M valuation', usd_cr(1e6), usd_cr(3e6)),
         ('Treelife 2026: pre-seed pre-money Rs 3-10 Cr, plus the 30-42% premium AI companies command (Zeni)', 3 * 1.30, 10 * 1.42),
         ('Practitioner guidance (Sane): target pre-seed valuation Rs 10-15 Cr at 8-12% dilution', 10, 15)]
bench_mid = sum((lo + hi) / 2 for _, lo, hi in BENCH) / 3
FACTORS_V1 = [('Team / execution', .30, 0.85), ('Size of opportunity', .25, 1.05), ('Product / technology', .15, 1.35), ('Competitive environment', .10, 1.05),
              ('Marketing, sales, awareness', .10, 0.75), ('Need for further funding', .05, 0.9), ('Other: moat, independence, fairness engine', .05, 1.25)]
FACTORS = [('Team / execution', .30, 0.80, 'One founder, no employees: shipping speed proven, but any single failure has no backup. Lowered from 0.85'),
           ('Size of opportunity', .25, 1.15, f'{len(rows)} markets sized, all 36 in the product, TAM up {T["tam"] / old["tam"] - 1:.0%} on the first model. Raised from 1.05'),
           ('Product / technology', .15, 1.40, f'Built end to end, 3 reference reports pass their tests, {FACTS["checks"]} automated checks; not yet run live. Raised from 1.35'),
           ('Competitive environment', .10, 0.95, 'Free general AI now produces similar-looking reports. Lowered from 1.05'),
           ('Marketing, sales, awareness', .10, 0.75, 'No users, no revenue, unchanged'),
           ('Need for further funding', .05, 1.00, 'No payroll: the same money lasts about twice as long. Raised from 0.90'),
           ('Other: moat, independence, fairness engine', .05, 1.25, 'Buyer-paid independence, no-verdict rule, review hold, source lineage. Unchanged')]
mult = sum(w * f for _, w, f, _ in FACTORS); mult_v1 = sum(w * f for _, w, f in FACTORS_V1); score = bench_mid * mult
BERKUS = (6, 10)                      # unchanged: a built product, no revenue
ENG_PM, PM_COST, OTHER = 32, (2.5, 4.0), (10, 20)
cost = ((ENG_PM * PM_COST[0] + OTHER[0]) / 100, (ENG_PM * PM_COST[1] + OTHER[1]) / 100)   # what a conventional team would cost to rebuild: a floor, not weighted
EXIT_MULT, EXIT_MULT_HI = 3.9, 6.8    # proptech EV/Sales (DealMatrix); Zillow 2.5x; Finro median 6.8x
RETENTION = 0.8 * 0.8 * 0.85; TARGET = 10
vc = {}
for name, uplift in [('report revenue only', 0.0), ('with recurring and B2B revenue doubling it (not built)', 1.0)]:
    vc[name] = [(sc, som[sc]['revenue'] * (1 + uplift) * EXIT_MULT, usd_cr(som[sc]['revenue'] * (1 + uplift) * EXIT_MULT * RETENTION / TARGET)) for sc in ('Base', 'Scale', 'Breakout')]
vc_scale_up = vc['with recurring and B2B revenue doubling it (not built)'][1][2]
W = dict(bench=.40, score=.30, berkus=.15, vc=.15)
blend = W['bench'] * bench_mid + W['score'] * score + W['berkus'] * sum(BERKUS) / 2 + W['vc'] * vc_scale_up
blend_v1 = json.load(open(os.path.join(HERE, 'som.json')))['blend']

# ---------- 6. the ask ----------
ASK, FLOOR, STRETCH = 15, 10, 20          # post-money, Rs crore: the same range as version 1; see the deck for why it is held, not raised
T1_AMOUNT = 1.0                           # Rs crore, tranche 1
def needs(post):
    ev = post * 1e7 / INR * TARGET / RETENTION; rev = ev / EXIT_MULT
    return dict(post=post, exit=ev, revenue=rev, revenue_cr=usd_cr(rev), reports=rev / price_net, sam_share=rev / T['sam'])
need = {str(k): needs(k) for k in (FLOOR, ASK, STRETCH)}
paths = [(f'Base: 5% awareness, {len(rows)} markets', som['Base']['revenue']), ('Scale: 12% awareness', som['Scale']['revenue']), ('Breakout: 25% awareness', som['Breakout']['revenue']),
         ('Breakout, and recurring plus B2B revenue doubling it (not built)', som['Breakout']['revenue'] * 2)]
returns = []
for name, rev in paths:
    rc = usd_cr(rev); lo, hi = rc * EXIT_MULT, rc * EXIT_MULT_HI
    returns.append(dict(name=name, revenue_cr=rc, exit_lo=lo, exit_hi=hi, ret_lo=lo * RETENTION / ASK, ret_hi=hi * RETENTION / ASK,
                        ret_lo_floor=lo * RETENTION / FLOOR, ret_hi_floor=hi * RETENTION / FLOOR))
# tranche 2: priced on proof, not on story
net_pm = 2100 / 1.18
arr = 1000 * 12 * net_pm / 1e7
t2 = dict(milestone_reports=1000, arr=arr, low_post=round(arr * 10 + 1.0), high_post=30, amount=1.0)

# runway of tranche 1 at base case with the first revenue from month 4 (the 'Launch' plan)
def runway(amount_cr, ai_pp):
    cash = amount_cr * 1e7 - ONE_OFF_TOTAL * 1e5
    net_in = 2100 / 1.18; per_report = net_in * (1 - GATEWAY - REFUNDS) - ai_pp * INR - 3
    for t in range(1, 61):
        r = 0 if t <= 3 else min(1000, 1000 * (t - 3) / 15)
        cash += r * (per_report - 800) - FIXED_PM * 1e5
        if cash < 0: return t
    return 60
rw = {k: runway(T1_AMOUNT, v['per_paid']) for k, v in AI.items()}
rw_no_rev = None
cash = T1_AMOUNT * 1e7 - ONE_OFF_TOTAL * 1e5; m = 0
while cash > 0 and m < 60: cash -= (FIXED_PM + 2.5) * 1e5; m += 1   # fixed costs plus Rs 2.5 L a month of paid marketing, no revenue
rw_no_rev = m

out = dict(rows=rows, T=T, wavg=WAVG, INR=INR, pending=PENDING, markets_in_product=MARKETS_IN_PRODUCT, old_T=old,
           assumptions=dict(search_to_paid=SEARCH_TO_PAID, fresh_share=FRESH_SHARE, tax=TAX, gateway=GATEWAY, refunds=REFUNDS, price_net=price_net),
           ai=AI, ai_base=AI_BASE, unit_economics=ue, som=som, plans=plans, fixed=FIXED, fixed_pm=FIXED_PM, one_off=ONE_OFF, one_off_total=ONE_OFF_TOTAL, budget=BUDGET,
           budget_total=SUBTOTAL, bench=BENCH, bench_mid=bench_mid, factors=FACTORS, factors_v1=FACTORS_V1, mult=mult, mult_v1=mult_v1, score=score, berkus=BERKUS,
           cost=cost, eng_pm=ENG_PM, vc=vc, blend=blend, blend_v1=blend_v1, weights=W, ask=ASK, floor=FLOOR, stretch=STRETCH, t1=T1_AMOUNT, need=need, returns=returns,
           t2=t2, runway=rw, runway_no_revenue=rw_no_rev, cash_table=CT, raise_total=RAISE_TOTAL, exit_mult=[EXIT_MULT, EXIT_MULT_HI], retention=RETENTION, target=TARGET)
json.dump(out, open(os.path.join(HERE, 'investor_v2.json'), 'w'), default=float, indent=1)

# ---------- printout ----------
print(f"MARKETS: {len(rows)} sized of {MARKETS_IN_PRODUCT} in the product; estimates: {', '.join(ESTIMATES)}")
print(f"  RANGE: TAM Rs {cr(T['tam_low']):,.0f}-{cr(T['tam_high']):,.0f} Cr (base {cr(T['tam']):,.0f}); SAM Rs {cr(T['sam_low']):,.0f}-{cr(T['sam_high']):,.0f} Cr")
print(f"  units {T['units']:,} (was {old['units']:,}); TAM ${T['tam']/1e6:.1f} M = Rs {cr(T['tam']):,.0f} Cr (was Rs {cr(old['tam']):,.0f}); SAM ${T['sam']/1e6:.1f} M = Rs {cr(T['sam']):,.0f} Cr (was Rs {cr(old['sam']):,.0f}); SAM reports {T['sam_reports']:,.0f}")
print(f"  weighted price paid ${WAVG:.1f}; net of tax ${price_net:.1f}")
print("\nAI cost per paid report (US$, UNMEASURED): " + '; '.join(f"{k} ${v['per_paid']:.2f}" for k, v in AI.items()))
for u in ue:
    print(f"  {u['name']:36} gross ${u['gross_usd']:6.1f} net ${u['net_usd']:6.1f} | contribution before marketing: " + '; '.join(f"{k.split(' ')[0]} ${v['contribution']:.1f} ({v['pct']:.0%})" for k, v in u['margins'].items()))
print("\nSOM (year 5, share of SAM report opportunities researched on ShelterKart):")
for k, v in som.items(): print(f"  {k:9} {v['awareness']:.0%}  paid reports {v['paid']:>8,.0f} ({v['per_month']:>5,.0f}/month)  revenue ${v['revenue']/1e6:5.2f} M = Rs {v['cr']:5.1f} Cr  {v['share_of_sam']:.2%} of SAM")
print(f"\nFIXED burn Rs {FIXED_PM:.2f} L/month; one-offs Rs {ONE_OFF_TOTAL} L")
for k, c in CT.items(): print(f"  24-month cash table, Launch plan, {k.split(' ')[0]} AI cost: spend Rs {c['spend']:.0f} L; report revenue after fees Rs {c['net_revenue']:.0f} L; NET NEED Rs {c['need']/100:.2f} Cr; reports {c['reports']:,.0f}")
for k, v in plans.items():
    print(f"  plan {k:9} {v['target']:>5}/month, CAC Rs {v['cac']}: " + ' | '.join(f"{a.split(' ')[0]} AI: after CAC Rs {v[a]['per_report_after_cac']:>6,.0f}, peak need Rs {v[a]['peak_need']:.2f} Cr" for a in AI))
print(f"\nRUNWAY of Rs {T1_AMOUNT} Cr (tranche 1): {rw_no_rev} months with no revenue; with the Launch plan at Low/Base/High AI cost: " + ', '.join(f"{k.split(' ')[0]} {v} months" for k, v in rw.items()))
print(f"\nVALUATION (post-money, Rs crore)\n  benchmark midpoint {bench_mid:.1f}; scorecard x {mult:.4f} (v1 {mult_v1:.4f}) = {score:.1f}; Berkus {BERKUS}; rebuild-cost floor {cost[0]:.1f}-{cost[1]:.1f}")
for n, r in vc.items(): print('  VC method, ' + n + ': ' + '; '.join(f"{sc} Rs {v:.1f} Cr" for sc, ev, v in r))
print(f"  BLEND {blend:.1f} (version 1: {blend_v1:.1f})")
for k, v in need.items(): print(f"  For Rs {k} Cr post: needs revenue Rs {v['revenue_cr']:.0f} Cr a year = {v['reports']/1e3:.0f}k paid reports = {v['sam_share']:.1%} of SAM")
print(f"  Ask Rs {ASK} Cr post for Rs {T1_AMOUNT} Cr = {T1_AMOUNT/ASK:.1%}; floor {FLOOR}, stretch {STRETCH}. Ask is {ASK/blend-1:.0%} above the blend")
for r in returns: print(f"  {r['name']:66} rev Rs {r['revenue_cr']:5.1f} Cr -> exit Rs {r['exit_lo']:5.0f}-{r['exit_hi']:5.0f} Cr -> {r['ret_lo']:.1f}x-{r['ret_hi']:.1f}x at Rs {ASK} Cr (at Rs {FLOOR} Cr: {r['ret_lo_floor']:.1f}x-{r['ret_hi_floor']:.1f}x)")
print(f"  Tranche 2 milestone: {t2['milestone_reports']} paid reports/month = net run-rate Rs {arr:.2f} Cr; at 10x -> Rs {arr*10:.1f} Cr pre-money; priced between Rs {t2['low_post']} and {t2['high_post']} Cr post")
