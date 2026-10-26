# Beyond the 22 markets: three more markets with OFFICIAL new-home counts (October 2026 research).
# Not part of the TAM in this deck; shown on the scale slide, and every one still has to pass the six market gates.
import json, os
HERE = os.path.dirname(os.path.abspath(__file__))
M = json.load(open(os.path.join(HERE, 'market.json')))
PRICE = M['scenarios']['base']['price']          # the same base-case price per report outside India ($40)
OPEN = 0.83                                      # buyers who research online: HSBC nine-country study, as for every other market
REPORTS = 2
rows = [
  dict(code='us', name='United States', units=679000, basis='New single-family houses sold in 2025: 679,000 (US Census Bureau and HUD, release of 20 February 2026). Median price $414,400 in December 2025. Excludes new condominiums, so a floor.'),
  dict(code='ca', name='Canada', units=round(259028 * 0.5), basis='Housing starts 2025: 259,028 (CMHC, 16 January 2026). Rental was just over half of urban starts, so for-sale is taken as half: an estimate.'),
  dict(code='de', name='Germany', units=89500, basis='Dwellings completed 2025: 206,600 (Destatis); 89,500 were built by companies, which is the developer-built part a due-diligence report serves.'),
]
tam = sam = units = 0
for r in rows:
    r['tam'] = r['units'] * REPORTS * PRICE; r['sam'] = r['tam'] * OPEN; tam += r['tam']; sam += r['sam']; units += r['units']
out = dict(rows=rows, units=units, tam=tam, sam=sam, price=PRICE, online=OPEN, reports=REPORTS,
           tam_growth=tam / M['T']['tam'], sam_growth=sam / M['T']['sam'], units_growth=units / M['T']['units'])
json.dump(out, open(os.path.join(HERE, 'expansion.json'), 'w'), indent=1)
INR = M['INR']; cr = lambda u: u * INR / 1e7
print(f"expansion: {units:,} homes a year (+{out['units_growth']:.1%}); TAM ${tam/1e6:.1f} M (Rs {cr(tam):,.0f} Cr, +{out['tam_growth']:.1%}); SAM ${sam/1e6:.1f} M (+{out['sam_growth']:.1%})")
for r in rows: print(f"  {r['name']:14} {r['units']:>8,} homes  TAM ${r['tam']/1e6:5.1f} M")
