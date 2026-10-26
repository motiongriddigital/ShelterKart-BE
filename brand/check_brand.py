#!/usr/bin/env python3
"""ShelterKart brand consistency check. Every surface must use only the colours, fonts and marks defined in brand/tokens.json.
For each surface it lists: colours outside the palette, font families outside the two brand families, and any trace of the
old logo (the shield files, the shield drawing, the two-colour wordmark).
    python3 brand/check_brand.py            report every surface
    python3 brand/check_brand.py --strict   exit 1 if any MIGRATED surface has a problem (the build gate)
A surface counts as migrated once it is listed in MIGRATED below; the others are reported, so progress is visible."""
import json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
T = json.load(open(os.path.join(HERE, 'tokens.json'), encoding='utf-8'))
PALETTE = {v['hex'].upper() for v in T['colors'].values()} | {'#B9C4D4'}   # B9C4D4: the tagline tint on navy, from the builder
def rgb(h): h = h.lstrip('#'); h = ''.join(c * 2 for c in h) if len(h) == 3 else h; return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))
PALETTE_RGB = {rgb(h) for h in PALETTE} | {(0, 0, 0), (255, 255, 255)}
BRAND_FONTS = {'fraunces', 'instrument sans'}
ALLOWED_FIRST = BRAND_FONTS | {'inherit', 'var(--sk-font-text)', 'var(--sk-font-display)'}
OLD_LOGO = [r'shelterkart-lockup(-on-dark)?\.svg', r'shelterkart-mark\.svg', r'M20 2L36 9V21', r'accent-part', r'M100 8 L182 36', r'Built on Evidence']   # the old shield, its large seal version, the two-colour wordmark, the old tagline

SURFACES = {   # name -> files whose styling belongs to that surface
  'website':        ['shelterkart-frontend.html'],
  'report (web and PDF)': ['backend/engine/dossierHtml.js', 'backend/engine/reportPages.js'],
  'guide':          ['guide/guide.css', 'guide/build_guide.py'],
  'sales-office card': ['guide/build_card.py'],
  'investor deck':  ['deck/build_deck_v2.py'],
  'static pages':   [f for f in sorted(os.listdir(ROOT)) if f.endswith('.html') and f not in ('shelterkart-frontend.html',)],
}
MIGRATED = {s for s in ('guide', 'sales-office card', 'website') }

def strip_embedded(text):
    # embedded data (the guide, the sample reports, dictionaries, fonts) is generated content, not this surface's styling
    text = re.sub(r'<script type="application/json"[^>]*>.*?</script>', '', text, flags=re.S)
    text = re.sub(r'data:[a-z/+.-]+;base64,[A-Za-z0-9+/=]+', 'data:', text)
    # the country flags keep their official colours: they are not brand colours
    text = re.sub(r'const FLAG_SVG = \{.*?\n\};', '', text, flags=re.S)
    return text

def check(paths):
    colours, fonts, logo = {}, {}, {}
    for p in paths:
        full = os.path.join(ROOT, p)
        if not os.path.exists(full): continue
        t = strip_embedded(open(full, encoding='utf-8', errors='ignore').read())
        for h in re.findall(r'#[0-9A-Fa-f]{6}\b|#[0-9A-Fa-f]{3}\b(?![0-9A-Fa-f])', t):
            if rgb(h) not in PALETTE_RGB: colours[h.upper()] = colours.get(h.upper(), 0) + 1
        for m in re.finditer(r'rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)', t):
            c = tuple(int(x) for x in m.groups())
            if c not in PALETTE_RGB: colours['rgb' + str(c)] = colours.get('rgb' + str(c), 0) + 1
        for m in re.finditer(r'font-family\s*:\s*([^;}{"\n]+)', t):
            first = m.group(1).split(',')[0].strip().strip('\'"').lower()
            if first and first not in ALLOWED_FIRST and not first.startswith('var(--sk-'): fonts[first] = fonts.get(first, 0) + 1
        for pat in OLD_LOGO:
            n = len(re.findall(pat, t))
            if n: logo[pat] = logo.get(pat, 0) + n
    return colours, fonts, logo

problems = 0
print(f"{'surface':22} {'status':9} {'off-palette':>12} {'other fonts':>12} {'old logo':>9}")
for name, paths in SURFACES.items():
    c, f, l = check(paths)
    bad = bool(c or f or l); state = 'migrated' if name in MIGRATED else 'pending'
    if bad and name in MIGRATED: problems += 1
    print(f"{name:22} {state:9} {sum(c.values()):>12} {sum(f.values()):>12} {sum(l.values()):>9}" + (
        f"   e.g. {', '.join(list(c)[:3] + list(f)[:2] + list(l)[:1])}" if bad else ''))
print(f"\n{problems} migrated surface(s) with problems" if problems else '\nevery migrated surface is consistent with the brand system')
sys.exit(1 if ('--strict' in sys.argv and problems) else 0)
