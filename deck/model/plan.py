# Country-by-country plan, TAM sensitivity and the arithmetic behind a ₹30 crore valuation (October 2026).
import json, os
HERE = os.path.dirname(os.path.abspath(__file__))
M = json.load(open(os.path.join(HERE, 'market.json'))); S = json.load(open(os.path.join(HERE, 'som.json'))); X = json.load(open(os.path.join(HERE, 'expansion.json')))
INR = M['INR']; rows = M['rows']; cr = lambda u: u * INR / 1e7
INDIA_PRICE = [r for r in rows if r['code'] == 'in'][0]['price_usd']
TAX = 1.15; CONV = 0.08                          # the model's illustrative 15% sales tax and 8% search-to-paid rate

# ---- 1. TAM sensitivity: price per report outside India x reports researched per purchase
PRICES = [22.3, 30.0, 40.0, 52.0, 65.0]; REPORTS = [1, 2, 3, 4]
def tam(price, reports):
    return sum(r['units'] * reports * (INDIA_PRICE if r['code'] == 'in' else price) for r in rows)
def sam(price, reports):
    return sum(r['units'] * reports * (INDIA_PRICE if r['code'] == 'in' else price) * r['online'] for r in rows)
grid = [[dict(price=p, reports=n, tam_cr=cr(tam(p, n)), sam_cr=cr(sam(p, n))) for n in REPORTS] for p in PRICES]

# ---- 2. country by country: waves are a PLAN (founder-led order, subject to the six gates), not a forecast
WAVE = {'in': 1, 'ae': 2, 'uk': 2, 'sg': 2, 'fr': 3, 'au': 3, 'ie': 3, 'es': 3, 'pl': 3, 'tw': 3, 'hk': 3, 'nz': 3, 'ch': 3,
        'be': 4, 'cz': 4, 'se': 4, 'dk': 4, 'fi': 4, 'no': 4, 'lt': 4, 'lv': 4, 'ee': 4}
LANG = {'in': 'English, Hindi', 'ae': 'English, Arabic', 'uk': 'English', 'sg': 'English', 'fr': 'French', 'au': 'English', 'ie': 'English', 'es': 'Spanish', 'pl': 'Polish',
        'tw': 'Traditional Chinese', 'hk': 'English, Traditional Chinese', 'nz': 'English', 'ch': 'German, French (Italian to add)', 'be': 'French (Dutch to add)',
        'cz': 'Czech to add', 'se': 'Swedish to add', 'dk': 'Danish to add', 'fi': 'Finnish to add', 'no': 'Norwegian to add', 'lt': 'Lithuanian to add', 'lv': 'Latvian to add', 'ee': 'Estonian to add'}
REGISTER = {'in': 'India: insolvency register', 'uk': 'Companies House', 'fr': 'Recherche d\'entreprises', 'no': 'Brønnøysund', 'sg': 'ACRA', 'fi': 'PRH', 'cz': 'ARES', 'au': 'ABN Lookup', 'ie': 'CRO', 'tw': 'MOEA'}
codes = {r['code'] for r in rows}
missing = sorted(codes - set(WAVE)); extra = sorted(set(WAVE) - codes)
assert not missing and not extra, (missing, extra)
def som_cr(r, aw):
    paid = r['units'] * 2 * r['online'] * aw * CONV
    return cr(paid * r['price_usd'] / TAX), paid
plan = []
for r in sorted(rows, key=lambda r: (WAVE[r['code']], -r['tam'])):
    s5, p5 = som_cr(r, 0.05); s12, p12 = som_cr(r, 0.12)
    plan.append(dict(code=r['code'], name=r['name'], wave=WAVE[r['code']], units=r['units'], price=r['price_usd'], tam_cr=cr(r['tam']), sam_cr=cr(r['sam']),
                     language=LANG[r['code']], register=REGISTER.get(r['code']), som5=s5, som12=s12, paid5=p5, paid12=p12))
tot5 = sum(p['som5'] for p in plan); tot12 = sum(p['som12'] for p in plan)
assert abs(tot5 - cr(S['som']['Base']['revenue'])) < 0.01 and abs(tot12 - cr(S['som']['Scale']['revenue'])) < 0.01, (tot5, tot12)
waves = []
cum5 = cum12 = cum_tam = cum_sam = 0
for w in (1, 2, 3, 4):
    ps = [p for p in plan if p['wave'] == w]
    cum5 += sum(p['som5'] for p in ps); cum12 += sum(p['som12'] for p in ps); cum_tam += sum(p['tam_cr'] for p in ps); cum_sam += sum(p['sam_cr'] for p in ps)
    waves.append(dict(wave=w, markets=[p['name'] for p in ps], som5=sum(p['som5'] for p in ps), som12=sum(p['som12'] for p in ps), cum5=cum5, cum12=cum12, cum_tam=cum_tam, cum_sam=cum_sam))

# ---- 3. what a Rs 30 crore post-money needs, on the same maths as the other asks
RET = S['retention']; EXIT = S['exit_mult'][0]; TARGET = 10
def need(post_cr):
    ev = post_cr * 1e7 / INR * TARGET / RET; rev = ev / EXIT
    return dict(post=post_cr, exit_usd=ev, revenue_usd=rev, revenue_cr=cr(rev), reports=rev / S['price_net'], sam_share=rev / M['T']['sam'], sam_share_expanded=rev / (M['T']['sam'] + X['sam']))
needs = {str(k): need(k) for k in (15, 20, 30)}
arr1000 = S['arr']                              # net run-rate at 1,000 paid reports a month, Rs crore
t2 = dict(low_post=round(arr1000 * 10 + 1.5), high_post=30, arr1000=arr1000, arr1500=arr1000 * 1.5, mult_high=(30 - 1.5) / arr1000, mult_high_1500=(30 - 1.5) / (arr1000 * 1.5))
json.dump(dict(prices=PRICES, reports=REPORTS, grid=grid, plan=plan, waves=waves, tot5=tot5, tot12=tot12, needs=needs, t2=t2, conv=CONV), open(os.path.join(HERE, 'plan.json'), 'w'), indent=1, default=float)
print('TAM sensitivity (Rs crore; non-India price down, reports per purchase across):')
print('  price   ' + ''.join(f'{n} report{"s" if n > 1 else " "}   ' for n in REPORTS))
for row in grid: print(f"  ${row[0]['price']:>4.1f}  " + ''.join(f"{c['tam_cr']:>7,.0f}      " for c in row))
print(f"\n  base case (the deck): $40, 2 reports = Rs {cr(tam(40, 2)):,.0f} Cr; the most generous cell ($65, 4 reports) = Rs {cr(tam(65, 4)):,.0f} Cr = {cr(tam(65, 4))/cr(tam(40, 2)):.1f}x")
print('\nrollout waves (a plan, not a forecast), revenue at 5% and 12% awareness:')
for w in waves: print(f"  wave {w['wave']}: {len(w['markets']):>2} markets  +Rs {w['som5']:5.2f} Cr at 5% (cumulative {w['cum5']:5.2f})  |  +Rs {w['som12']:5.2f} Cr at 12% (cumulative {w['cum12']:5.2f})  | cumulative TAM Rs {w['cum_tam']:,.0f} Cr")
print('\nwhat each valuation needs (10x target, 54% retained, exit 3.9x revenue):')
for k, v in needs.items(): print(f"  Rs {k:>2} Cr post: revenue Rs {v['revenue_cr']:5.0f} Cr a year = {v['reports']/1e3:4.0f}k paid reports = {v['sam_share']*100:4.1f}% of today's SAM ({v['sam_share_expanded']*100:.1f}% with the US, Canada, Germany)")
print(f"\ntranche 2: Rs {t2['low_post']} Cr post on the volume proof alone; Rs 30 Cr post = {t2['mult_high']:.1f}x the run-rate at 1,000 paid reports a month, {t2['mult_high_1500']:.1f}x at 1,500")
