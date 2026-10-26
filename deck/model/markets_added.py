# Markets ADDED to the product in October 2026, after the feasibility study (each passed its gates; the US as a
# Florida and New York pilot). Unlike expansion.py (markets still outside the product), these COUNT in the TAM.
# Same assumptions as every other market outside India: base price per report, two reports per buyer, online share.
import json, os
HERE = os.path.dirname(os.path.abspath(__file__))
M = json.load(open(os.path.join(HERE, 'market.json')))
PRICE = M['scenarios']['base']['price']; OPEN = 0.83; REPORTS = 2
rows = [
  dict(code='ca', name='Canada', units=round(259028 * 0.5),
       basis='Housing starts 2025: 259,028 (CMHC, 16 January 2026); rental was just over half of urban starts, so for-sale is taken as half. An estimate. Ontario first (HCRA), then British Columbia.'),
  dict(code='my', name='Malaysia', units=round(2 * 120307 * (1 - 0.794)),
       basis='First half of 2025: 120,307 residential transactions (NAPIC, reported by The Edge, 4 September 2025), 79.4% of them secondary (NAPIC 1H 2025 report), so about 24,800 new homes in six months, doubled for a year. A derived estimate.'),
  dict(code='us', name='United States', units=383124,
       basis='New single-family houses sold in 2025: 679,000 (US Census Bureau), less the ten largest listed builders\u2019 closings (43.6% of sales): the independent-builder segment, where a due-diligence report adds most. Pilot in Florida and New York.'),
  dict(code='de', name='Germany', units=89500,
       basis='Dwellings completed 2025: 206,600 (Destatis); 89,500 were built by companies, the developer-built part a due-diligence report serves.'),
]
# The ten markets that were live in the product but unsized are now sized from 2025 counts found in October 2026.
# confidence: 'official' = an official count used as it stands; 'derived' = an official statistic with an assumption or a partial scope;
# 'estimate' = no recent official count, so the size is bracketed and must be shown as an estimate.
# units_low / units_high bracket the size; the base case is units.
EXTRA = [
  dict(code='br', name='Brazil', units=426260, units_low=229384, units_high=426260, confidence='derived',
       basis='CBIC: 426,260 new residential units sold in 2025. 196,876 of them were subsidised Minha Casa Minha Vida, whose buyers pay far less, so the low case counts only the other 229,384.'),
  dict(code='jp', name='Japan', units=208169, confidence='official',
       basis='MLIT, via Jiji: condominiums and houses for sale started in 2025 (740,667 starts in all). The 201,285 owner-built houses are not counted.'),
  dict(code='mx', name='Mexico', units=138645, units_low=107778, confidence='derived',
       basis='Registro Unico de Vivienda: 138,645 new homes registered in 2025, 77.7% (107,778) not social housing. Read from a published summary of the registry, so confirm against the RUV.'),
  dict(code='sa', name='Saudi Arabia', units=97000, units_high=108000, confidence='official',
       basis='Ministry of Municipalities and Housing: sales licences for more than 97,000 off-plan units in 2025, from more than 108,000 launched.'),
  dict(code='it', name='Italy', units=52082, confidence='derived',
       basis='ISTAT: dwellings permitted in new residential buildings, the four 2025 quarters summed (permits, not sales).'),
  dict(code='nl', name='Netherlands', units=47000, confidence='official',
       basis='CBS: about 47,000 of the 69,000 new homes completed in 2025 were owner-occupied or private rental.'),
  dict(code='th', name='Thailand', units=41490, confidence='derived',
       basis='AREA: 41,490 new units launched in Bangkok and its region in 2025. The national figure is larger and was not found.'),
  dict(code='za', name='South Africa', units=40000, units_low=31458, units_high=51990, confidence='estimate',
       basis='ESTIMATE. Stats SA reports the value of plans, not units. The builders\u2019 regulator (NHBRC) counted 31,458 to 51,990 private-sector home enrolments a year; the latest year found is 2016/17.'),
  dict(code='pt', name='Portugal', units=27301, confidence='official',
       basis='INE: 27,301 new dwellings for family housing completed in 2025 (30,425 dwellings of all kinds).'),
  dict(code='ph', name='Philippines', units=27000, units_low=10100, confidence='estimate',
       basis='ESTIMATE, Metro Manila condominiums only. Leechiu: 24,732 units sold in the first 11 months of 2025 (about 27,000 a year); Colliers: 10,100 net take-up. No national count was found, so the true size is larger.'),
]
for x in EXTRA: rows.append(x)
CONFIDENCE = {'ca': 'derived', 'my': 'derived', 'us': 'derived', 'de': 'official'}
for r in rows:
    r.setdefault('units_low', r['units']); r.setdefault('units_high', r['units']); r.setdefault('confidence', CONFIDENCE.get(r['code'], 'derived'))
PENDING = []      # every market in the product now has a size
tam = sam = units = 0
for r in rows:
    r['tam'] = r['units'] * REPORTS * PRICE; r['sam'] = r['tam'] * OPEN; tam += r['tam']; sam += r['sam']; units += r['units']
T = M['T']; INR = M['INR']; cr = lambda usd: usd * INR / 1e7
out = dict(rows=rows, units=units, tam=tam, sam=sam, price=PRICE, online=OPEN, reports=REPORTS,
           core=dict(markets=len(M['rows']), units=T['units'], tam=T['tam'], sam=T['sam']),
           total=dict(markets=len(M['rows']) + len(rows), units=T['units'] + units, tam=T['tam'] + tam, sam=T['sam'] + sam),
           tam_growth=tam / T['tam'], sam_growth=sam / T['sam'])
out['pending'] = PENDING
json.dump(out, open(os.path.join(HERE, 'markets_added.json'), 'w'), indent=1)
print(f"core {len(M['rows'])} markets: {T['units']:,} homes a year, TAM ${T['tam']/1e6:.1f} M (Rs {cr(T['tam']):,.0f} Cr), SAM ${T['sam']/1e6:.1f} M (Rs {cr(T['sam']):,.0f} Cr)")
for r in rows: print(f"  + {r['name']:14} {r['units']:>8,} homes  TAM ${r['tam']/1e6:5.1f} M (Rs {cr(r['tam']):,.0f} Cr)")
print(f"added: {units:,} homes, TAM +${tam/1e6:.1f} M (+{out['tam_growth']:.1%}), SAM +${sam/1e6:.1f} M (+{out['sam_growth']:.1%})")
print('confidence:', {c: [r['name'] for r in rows if r['confidence'] == c] for c in ('official', 'derived', 'estimate')})
print(f"NEW total, {out['total']['markets']} sized markets: {out['total']['units']:,} homes a year, TAM ${out['total']['tam']/1e6:.1f} M (Rs {cr(out['total']['tam']):,.0f} Cr), SAM ${out['total']['sam']/1e6:.1f} M (Rs {cr(out['total']['sam']):,.0f} Cr)")
