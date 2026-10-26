"""ShelterKart: global TAM / SAM / SOM and valuation model. Every input is sourced or flagged; run this file to reproduce every number."""
import json, math, os
HERE = os.path.dirname(os.path.abspath(__file__))

# ---------- exchange rates: ECB reference, 26 June 2026 (per 1 EUR); AED pegged; TWD is not an ECB rate -> indicative ----------
EUR = dict(USD=1.1401, INR=107.6305, GBP=0.86253, SGD=1.4755, AUD=1.6518, CHF=0.9218, NOK=11.3035, CZK=24.266,
           PLN=4.2868, DKK=7.4746, SEK=11.0775, HKD=8.9408, NZD=2.0181, EUR=1.0)
PER_USD = {k: v / EUR['USD'] for k, v in EUR.items()}; PER_USD['AED'] = 3.6725; PER_USD['TWD'] = 31.0   # TWD indicative
usd = lambda amt, cur: amt / PER_USD[cur]

# ---------- annual new-home purchases (units), with derivation ----------
POP = dict(FR=68.4e6, PL=36.6e6, CH=9.0e6, BE=11.8e6, DK=6.0e6, FI=5.6e6, NO=5.6e6, SE=10.6e6, CZ=10.9e6, EE=1.37e6, LV=1.87e6, LT=2.87e6)  # approx. 2025 populations
AVG_RATE = 3.1   # completions per 1,000 inhabitants, Euroconstruct 19-country average, 2025
M = {  # code: (name, units, basis)
 'in': ('India', 395625, 'Anarock 2025: homes sold, top 7 cities'),
 'ae': ('Dubai (UAE)', 134623, 'DLD 2025: off-plan transactions'),
 'uk': ('United Kingdom', 202800 + 18869 + 5159, 'England EPCs 2025 + Scotland + Wales (NI excluded)'),
 'au': ('Australia', 176000, 'ABS 2025: four quarters of ~44,000 completions'),
 'fr': ('France', round(3.7 * POP['FR'] / 1000), 'Euroconstruct 2025: 3.7 per 1,000 inhabitants'),
 'pl': ('Poland', round(5.0 * POP['PL'] / 1000), 'Euroconstruct 2025: above 5 per 1,000 (taken as 5.0)'),
 'es': ('Spain', 100000, 'ifo/Euroconstruct 2025: above 100,000'),
 'tw': ('Taiwan', 138792, 'MOI 2025: residential usage licences'),
 'ie': ('Ireland', 38000, 'EY-Euroconstruct 2025'),
 'ch': ('Switzerland', round(5.0 * POP['CH'] / 1000), 'Euroconstruct 2025: above 5 per 1,000 (taken as 5.0)'),
 'nz': ('New Zealand', 36619, 'Stats NZ 2025: new homes consented'),
 'hk': ('Hong Kong', 20000, 'first-hand sales 2025 (about 20,000)'),
 'sg': ('Singapore', 10815, 'URA 2025: developer sales, ex-EC'),
 'be': ('Belgium', round(AVG_RATE * POP['BE'] / 1000), 'Euroconstruct average rate (3.1 per 1,000)'),
 'dk': ('Denmark', round(AVG_RATE * POP['DK'] / 1000), 'Euroconstruct average rate'),
 'fi': ('Finland', round(AVG_RATE * POP['FI'] / 1000), 'Euroconstruct average rate'),
 'no': ('Norway', round(AVG_RATE * POP['NO'] / 1000), 'Euroconstruct average rate'),
 'se': ('Sweden', round(AVG_RATE * POP['SE'] / 1000), 'Euroconstruct average rate'),
 'cz': ('Czech Republic', round(AVG_RATE * POP['CZ'] / 1000), 'Euroconstruct average rate'),
 'ee': ('Estonia', round(AVG_RATE * POP['EE'] / 1000), 'Euroconstruct average rate'),
 'lv': ('Latvia', round(AVG_RATE * POP['LV'] / 1000), 'Euroconstruct average rate'),
 'lt': ('Lithuania', round(AVG_RATE * POP['LT'] / 1000), 'Euroconstruct average rate'),
}
# ---------- price per report, re-based on the property-value price book (October 2026) ----------
# India: the reference report (Rs 2,500 for the typical purchase) at the five samples' depth mix -- the engine's own price.
# Every other market: a SCENARIO price per report, because a sourced typical new-home price exists only for India and
# Dubai. Base $40 sits between real engine outputs (a Dubai flat about $38, a London new build about $55).
INDIA_REFERENCE = (2500, 'INR')
SCENARIOS = {'floor': 22.3, 'low': 30.0, 'base': 40.0, 'high': 52.0}   # USD per report outside India
SCENARIO = 'base'
DEPTH_MIX = 0.4 * 1.0 + 0.4 * 0.8 + 0.2 * 0.6     # the five real samples: 2 Gold, 2 Heavy, 1 Thin
REPORTS_PER_PURCHASE = 2                            # assumption: a buyer researches two projects per purchase
ONLINE = {m: 0.83 for m in M}; ONLINE['in'] = 0.57  # HSBC 9-country study: 83% research online; Google/Zinnov India tier-1: 57% (older)

rows, T = [], dict(units=0, tam=0.0, sam=0.0, reports=0.0, sam_reports=0.0)
for c, (name, units, basis) in sorted(M.items(), key=lambda kv: -kv[1][1]):
    price = usd(*INDIA_REFERENCE) * DEPTH_MIX if c == 'in' else SCENARIOS[SCENARIO]   # average price per report, USD
    tam = units * REPORTS_PER_PURCHASE * price
    sam = tam * ONLINE[c]
    rows.append(dict(code=c, name=name, units=units, basis=basis, price_usd=price, tam=tam, sam=sam, online=ONLINE[c]))
    T['units'] += units; T['tam'] += tam; T['sam'] += sam; T['reports'] += units * REPORTS_PER_PURCHASE; T['sam_reports'] += units * REPORTS_PER_PURCHASE * ONLINE[c]
INR = PER_USD['INR']
print(f"{'market':16}{'purchases':>10}{'avg price':>10}{'TAM $M':>9}{'SAM $M':>9}   basis")
for r in rows: print(f"{r['name']:16}{r['units']:>10,}{r['price_usd']:>9.1f}${r['tam']/1e6:>8.2f}{r['sam']/1e6:>9.2f}   {r['basis']}")
print(f"{'TOTAL':16}{T['units']:>10,}{'':>10}${T['tam']/1e6:>8.1f}{T['sam']/1e6:>9.1f}")
print(f"\nTAM  ${T['tam']/1e6:.1f} M a year  = Rs {T['tam']*INR/1e7:,.0f} crore   ({T['units']:,} purchases x {REPORTS_PER_PURCHASE} reports)")
print(f"SAM  ${T['sam']/1e6:.1f} M a year  = Rs {T['sam']*INR/1e7:,.0f} crore   ({T['sam']/T['tam']*100:.0f}% of TAM reachable online)")
wavg = T['sam'] / T['sam_reports']; print(f"weighted average price paid per report: ${wavg:.1f} (Rs {wavg*INR:,.0f}); SAM report opportunities: {T['sam_reports']:,.0f}")
share_in = [r for r in rows if r['code']=='in'][0]; print(f"India = {share_in['sam']/T['sam']*100:.0f}% of SAM revenue, {share_in['units']*REPORTS_PER_PURCHASE*0.57/T['sam_reports']*100:.0f}% of SAM report opportunities")
india_usd = usd(*INDIA_REFERENCE) * DEPTH_MIX
scen = {}
for k, v in SCENARIOS.items():
    tam = sum(r['units'] * REPORTS_PER_PURCHASE * (india_usd if r['code'] == 'in' else v) for r in rows)
    sam = sum(r['units'] * REPORTS_PER_PURCHASE * (india_usd if r['code'] == 'in' else v) * r['online'] for r in rows)
    scen[k] = dict(price=v, tam=tam, sam=sam); print(f"scenario {k:6} ${v:>5.1f} outside India: TAM ${tam/1e6:6.1f} M, SAM ${sam/1e6:6.1f} M")
json.dump(dict(rows=rows, T=T, wavg=wavg, INR=INR, depth_mix=DEPTH_MIX, scenarios=scen, india_usd=india_usd), open(os.path.join(HERE, 'market.json'), 'w'), default=float, indent=1)
