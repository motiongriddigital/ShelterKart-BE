#!/usr/bin/env python3
"""Moves the website (shelterkart-frontend.html) onto the brand system, and keeps it there.
    python3 brand/apply_frontend.py          apply (idempotent: safe to run again after any brand change)
What it does:
  1. embeds brand/dist/tokens.inline.css (the variables and both font families) between BRAND_TOKENS markers
  2. removes the Google Fonts links: the fonts now come with the page
  3. points the site's own colour variables at the brand tokens (the mapping below is the decision record)
  4. moves any other colour (in styles, inline drawings and scripts) to its nearest brand colour; the country flags are left alone
  5. sets every font to the two brand families; the monospace face becomes the text face with tabular figures
  6. replaces the old shield logo and the two-colour wordmark with the brand icon and a one-colour wordmark"""
import json, os, re

HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
PAGE = os.path.join(ROOT, 'shelterkart-frontend.html')
T = json.load(open(os.path.join(HERE, 'tokens.json'), encoding='utf-8'))
C = {k: v['hex'].upper() for k, v in T['colors'].items()}
kebab = lambda s: ''.join('-' + c.lower() if c.isupper() else c for c in s)
VAR = lambda k: f'var(--sk-{kebab(k)})'

# 3. the site's colour variables -> brand tokens. Old gradients of navy and gold collapse to one navy and one gold.
SITE_VARS = {
 '--accent': 'goldDark', '--accent-deep': 'ink', '--accent-glow': 'gold', '--caution': 'reported',
 '--ev-confirmed': 'verified', '--ev-confirmed-bar': 'verified', '--ev-confirmed-bg': 'verifiedBg',
 '--ev-developer': 'inference', '--ev-developer-bar': 'inference', '--ev-developer-bg': 'inferenceBg',
 '--ev-disputed': 'disputed', '--ev-disputed-bar': 'disputed', '--ev-disputed-bg': 'disputedBg',
 '--ev-reported': 'reported', '--ev-reported-bar': 'gold', '--ev-reported-bg': 'reportedBg',
 '--ev-single': 'notOnRecord', '--ev-single-bar': 'notOnRecord', '--ev-single-bg': 'notOnRecordBg',
 '--gold': 'gold', '--gold-100': 'cream', '--gold-200': 'cream', '--gold-300': 'gold', '--gold-400': 'gold', '--gold-500': 'gold',
 '--gold-600': 'goldDark', '--gold-bright': 'cream', '--gold-deep': 'goldDark', '--gold-line': 'rule', '--gold-wash': 'tint',
 '--ink-1': 'ink', '--ink-2': 'inkSoft', '--ink-3': 'slate',
 '--navy-400': 'navy', '--navy-500': 'navy', '--navy-600': 'navy', '--navy-700': 'navy', '--navy-800': 'navy', '--navy-900': 'navy',
 '--ok': 'verified', '--on-navy-1': 'cream', '--paper-0': 'paper', '--paper-1': 'paper', '--paper-2': 'rule', '--paper-3': 'slate', '--rule-soft': 'rule',
}

def rgb(h): h = h.lstrip('#'); h = ''.join(c * 2 for c in h) if len(h) == 3 else h; return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))
PAL = {k: rgb(v) for k, v in C.items()}
def nearest(c):
    # perceptual-ish distance (weighted RGB); white and black stay as they are
    if c in ((255, 255, 255), (0, 0, 0)): return None
    w = lambda a, b: 2 * (a[0] - b[0]) ** 2 + 4 * (a[1] - b[1]) ** 2 + 3 * (a[2] - b[2]) ** 2
    return min(PAL, key=lambda k: w(PAL[k], c))

def apply(s):
    # 1. tokens and fonts
    tokens = open(os.path.join(HERE, 'dist', 'tokens.inline.css'), encoding='utf-8').read()
    block = '/*BRAND_TOKENS_START*/\n' + tokens + '/*BRAND_TOKENS_END*/\n'
    if '/*BRAND_TOKENS_START*/' in s: s = re.sub(r'/\*BRAND_TOKENS_START\*/.*?/\*BRAND_TOKENS_END\*/\n', lambda m: block, s, flags=re.S)
    else: s = s.replace('<style>', '<style>\n' + block, 1)
    # 2. no external fonts
    s = re.sub(r'\s*<link rel="preconnect" href="https://fonts\.(googleapis|gstatic)\.com"[^>]*>', '', s)
    s = re.sub(r'\s*<link href="https://fonts\.googleapis\.com/css2[^>]*>', '', s)
    # protect what must not change: generated data, embedded images, the country flags, the token block itself
    keep = []
    def hold(m): keep.append(m.group(0)); return f'\x00{len(keep) - 1}\x00'
    s = re.sub(r'/\*BRAND_TOKENS_START\*/.*?/\*BRAND_TOKENS_END\*/\n', hold, s, flags=re.S)
    s = re.sub(r'<script type="application/json"[^>]*>.*?</script>', hold, s, flags=re.S)
    s = re.sub(r'data:[a-z/+.-]+;base64,[A-Za-z0-9+/=]+', hold, s)
    s = re.sub(r'const FLAG_SVG = \{.*?\n\};', hold, s, flags=re.S)
    # 3. the site's variables
    for name, tok in SITE_VARS.items():
        s = re.sub(rf'({re.escape(name)})\s*:\s*#[0-9A-Fa-f]{{3,6}}\b', rf'\1:{VAR(tok)}', s)
    # 4. every other colour: in style blocks a brand variable; elsewhere (drawing attributes, scripts) the brand hex
    style_spans = [(m.start(), m.end()) for m in re.finditer(r'<style[^>]*>.*?</style>', s, flags=re.S)]
    in_style = lambda p: any(a <= p <= b for a, b in style_spans)
    out, last = [], 0
    for m in re.finditer(r'#[0-9A-Fa-f]{6}\b|#[0-9A-Fa-f]{3}\b(?![0-9A-Fa-f])', s):
        c = rgb(m.group(0)); k = nearest(c)
        if k is None or PAL[k] == c and not in_style(m.start()): continue
        rep = VAR(k) if in_style(m.start()) else C[k]
        out.append(s[last:m.start()]); out.append(rep); last = m.end()
    out.append(s[last:]); s = ''.join(out)
    def rgba(m):
        c = tuple(int(x) for x in m.group(2, 3, 4)); k = nearest(c)
        # semi-transparent colours are decoration (glows, washes): they never borrow a status colour
        k = {'inference': 'navy', 'disputed': 'goldDark'}.get(k, k)
        if k is None or PAL[k] == c: return m.group(0)
        r, g, b = PAL[k]; return f'{m.group(1)}({r},{g},{b}'
    s = re.sub(r'(rgba?)\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)', rgba, s)
    # 5. fonts
    s = re.sub(r"font-family\s*:\s*'IBM Plex Mono'[^;}\"]*", 'font-family:var(--sk-font-text);font-variant-numeric:tabular-nums', s)
    s = re.sub(r"font-family\s*:\s*'IBM Plex Sans'[^;}\"]*", 'font-family:var(--sk-font-text)', s)
    s = re.sub(r"font-family\s*:\s*'Fraunces'[^;}\"]*", 'font-family:var(--sk-font-display)', s)
    s = re.sub(r"font-family\s*:\s*Georgia,'Times New Roman',serif", 'font-family:var(--sk-font-display)', s)
    s = re.sub(r"'Fraunces'\s*,\s*Georgia\s*,\s*serif|'Fraunces'\s*,\s*serif", 'var(--sk-font-display)', s)
    s = re.sub(r"'IBM Plex Sans'\s*,\s*sans-serif", 'var(--sk-font-text)', s)
    s = re.sub(r"'IBM Plex Mono'\s*,\s*monospace", 'var(--sk-font-text)', s)
    # 6. the logo
    icon = open(os.path.join(HERE, 'dist', 'icon-on-navy.svg'), encoding='utf-8').read()
    icon = icon.replace('<svg ', '<svg class="brand-mark" aria-hidden="true" ', 1).replace(' role="img" aria-label="ShelterKart"', '')
    s = re.sub(r'<svg class="brand-mark" viewBox="0 0 40 44" fill="none" aria-hidden="true">.*?</svg>', lambda m: icon, s, flags=re.S)
    s = s.replace('Shelter<span class="accent-part">Kart</span>', 'ShelterKart')
    s = re.sub(r'\n[^\n]*\.accent-part\{[^}]*\}', '', s)
    s = re.sub(r'\n[^\n]*\.brand-mark path\[stroke="var\(--navy-900\)"\]\{[^}]*\}', '', s)
    # the seal's centrepiece: the old shield-and-bars becomes the brand icon (the labels around it are not changed)
    big = open(os.path.join(HERE, 'dist', 'icon-on-navy.svg'), encoding='utf-8').read()
    big = big.replace('<svg ', '<svg class="evstd-icon" aria-hidden="true" ', 1).replace(' role="img" aria-label="ShelterKart"', '').replace('width="64" height="64"', 'width="120" height="120"', 1)
    s = re.sub(r'<div class="evstd-shield"><svg viewBox="0 0 200 232".*?</svg>', lambda m: '<div class="evstd-shield">' + big, s, flags=re.S)
    # the tagline: the brand line, kept in English everywhere until a native speaker has checked each translation
    s = s.replace('<span class="brand-sub" data-i18n>Built on Evidence</span>', '<span class="brand-sub">' + T['tagline'] + '</span>')
    # the English tagline stays left to right inside right-to-left pages, so its full stop stays at the end
    s = s.replace('<span class="brand-sub">' + T['tagline'] + '</span>', '<span class="brand-sub" dir="ltr" lang="en">' + T['tagline'] + '</span>')
    # structured data for search engines: the tagline, and every market the site covers (from its own market order)
    s = re.sub(r'"slogan": "[^"]*"', '"slogan": "' + T['tagline'] + '"', s)
    mo = re.search(r"const MARKET_ORDER = (\[[^\]]*\]);", s)
    if mo:
        codes = [c.upper().replace('UK', 'GB') for c in json.loads(mo.group(1).replace("'", '"'))]
        s = re.sub(r'"areaServed": \[[^\]]*\]', '"areaServed": ' + json.dumps(codes), s)
    # the wordmark is set in the display face, as everywhere else
    s = s.replace(".brand-name{ font-family:var(--sk-font-text); font-size:16px; letter-spacing:0.02em; font-weight:500; }",
                  ".brand-name{ font-family:var(--sk-font-display); font-size:18px; letter-spacing:-0.01em; font-weight:600; }")
    # brand rules that must win over the older per-screen rules: one block, at the end of the main stylesheet
    rules = ('/*BRAND_RULES_START*/\n'
             '  .brand-sub{ font-family:var(--sk-font-display); font-weight:600; text-transform:none; letter-spacing:0;'
             ' font-size:clamp(14px,1.6vw,17px); line-height:1.35; color:var(--sk-cream); opacity:.88; margin-top:8px; }\n'
             '  /* small text on navy is never fainter than 4.5:1 */\n'
             '  .mh-strap, .hero .mh-strap{ color:rgba(245,230,194,.72); }\n'
             '  .market-caption-label, .hero .market-caption-label{ color:var(--sk-gold); }\n'
             '  .hero-foot-note, .hero .hero-foot-note{ color:rgba(245,230,194,.72); }\n'
             '  /* the hero icon arrives once: the page outline traces itself in, then the fold and the lines appear. Nothing loops. */\n'
             '  .evstd-icon{ animation:skIconRise .9s cubic-bezier(.2,.7,.2,1) .35s backwards; }\n'
             '  .evstd-icon path:nth-of-type(1){ stroke-dasharray:170; stroke-dashoffset:170; animation:skTrace 1.4s ease-out .5s forwards; }\n'
             '  .evstd-icon path:nth-of-type(2){ animation:skFade .5s ease-out 1.6s backwards; }\n'
             '  .evstd-icon path:nth-of-type(3){ animation:skFade .5s ease-out 1.9s backwards; }\n'
             '  @keyframes skIconRise{ from{ opacity:0; transform:translateY(10px); } to{ opacity:1; transform:none; } }\n'
             '  @keyframes skTrace{ to{ stroke-dashoffset:0; } }\n'
             '  @keyframes skFade{ from{ opacity:0; } to{ opacity:1; } }\n'
             '  /* layout quality: every control a finger or a pointer must hit is at least 44 px tall and wide */\n'
             '  #langSelect{ min-height:44px; }\n'
             '  .demo-chip{ min-height:44px; display:inline-flex; align-items:center; }\n'
             '  .modal-close{ min-width:44px; min-height:44px; }\n'
             '  select.lb-country, #langSelect, select{ min-height:44px; }\n'
             '  select.lb-country{ width:100%; }\n'
             '  /* voice search: a microphone in the search box; what it hears is shown back for confirmation before it is searched */\n'
             '  .mic-btn{ flex:none; width:48px; min-height:44px; border:0; background:transparent; color:var(--sk-navy); cursor:pointer; display:flex; align-items:center; justify-content:center; padding:0; }\n'
             '  .mic-btn[hidden]{ display:none !important; }\n'
             '  .mic-btn svg{ width:22px; height:22px; }\n'
             '  .mic-btn[aria-pressed="true"]{ color:var(--sk-gold); }\n'
             '  .mic-btn:focus-visible{ outline:2px solid var(--sk-gold); outline-offset:2px; }\n'
             '  .voice-confirm{ position:absolute; left:0; right:0; top:100%; z-index:30; margin-top:4px; padding:14px 16px; background:var(--sk-white); border:1px solid var(--sk-rule); box-shadow:0 8px 24px rgba(6,20,40,.12); text-align:left; }\n'
             '  .voice-confirm[hidden]{ display:none !important; }\n'
             '  .voice-confirm p{ margin:0; }\n'
             '  .voice-q{ font-family:var(--sk-font-display); font-weight:600; font-size:17px; color:var(--sk-ink); }\n'
             '  .voice-actions{ display:flex; gap:10px; margin:10px 0 8px; }\n'
             '  .voice-yes{ min-height:44px; padding:0 16px; border:0; border-radius:6px; background:var(--sk-gold); color:var(--sk-navy); font-weight:700; cursor:pointer; }\n'
             '  .voice-edit{ min-height:44px; padding:0 16px; border:1px solid var(--sk-navy); border-radius:6px; background:transparent; color:var(--sk-navy); font-weight:600; cursor:pointer; }\n'
             '  .voice-note{ font-size:13px; color:var(--sk-slate); }\n'
             '  /* the search dropdown: every line readable on the paper colour; list items are full-width, tall enough to tap */\n'
             '  .suggest{ background:var(--sk-white); border:1px solid var(--sk-rule); box-shadow:0 8px 24px rgba(6,20,40,.12); max-height:62vh; overflow-y:auto; }\n'
             '  /* results open in the page flow, between the field and the Search button, so the button is never covered */\n'
             '  /* readability: the dropdown and the voice panel always set their own ink on white. They never inherit the light text of the navy search card. */\n'
             '  .suggest, .voice-confirm{ color:var(--sk-ink); background:var(--sk-white); }\n'
             '  .suggest *, .voice-confirm *{ color:inherit; }\n'
             '  .voice-confirm .voice-q, .voice-confirm p{ color:var(--sk-ink); }\n'
             '  .voice-confirm .voice-note, .suggest .suggest-hint, .suggest .suggest-empty-hint{ color:var(--sk-slate); }\n'
             '  .voice-confirm .voice-yes, .suggest .suggest-didyoumean{ color:var(--sk-navy); background:var(--sk-gold); }\n'
             '  .suggest .suggest-didyoumean{ background:var(--sk-navy); color:var(--sk-cream); }\n'
             '  .voice-confirm .voice-edit{ color:var(--sk-navy); background:var(--sk-white); border:1px solid var(--sk-navy); }\n'
             '  .suggest .suggest-item{ color:var(--sk-ink); }\n'
             '  .suggest .suggest-item .stype, .suggest .suggest-group{ color:var(--sk-gold-dark); }\n'
             '  .suggest{ position:static; margin:10px 0 0; }\n'
             '  .voice-confirm{ position:static; margin:10px 0 0; }\n'
             '  .suggest-hint, .suggest-empty-hint{ margin:0; padding:10px 16px; font-size:13px; color:var(--sk-slate); line-height:1.5; }\n'
             '  .suggest-empty p{ color:var(--sk-ink); }\n'
             '  .suggest-group{ padding:10px 16px 4px; font-size:12px; letter-spacing:.08em; text-transform:uppercase; color:var(--sk-gold-dark); font-weight:700; background:var(--sk-paper); }\n'
             '  .suggest button.suggest-item{ display:flex; align-items:center; justify-content:space-between; gap:8px; width:100%; min-height:44px; padding:12px 16px; border:0; border-bottom:1px solid var(--sk-rule); background:transparent; color:var(--sk-ink); font:inherit; font-size:15px; text-align:left; cursor:pointer; }\n'
             '  .suggest button.suggest-item:hover, .suggest button.suggest-item:focus-visible{ background:var(--sk-tint); outline:none; }\n'
             '  .suggest .suggest-item .stype{ font-size:11px; letter-spacing:.08em; text-transform:uppercase; color:var(--sk-gold-dark); font-weight:700; white-space:nowrap; }\n'
             '  .suggest-name{ min-width:0; }\n'
             '  .suggest-record-title{ margin:0; padding:14px 16px 4px; font-family:var(--sk-font-display); font-weight:600; font-size:19px; color:var(--sk-ink); }\n'
             '  .suggest-line{ margin:0; padding:4px 16px; font-size:14px; color:var(--sk-ink-soft); }\n'
             '  .suggest-line strong{ color:var(--sk-ink); }\n'
             '  .suggest .suggest-didyoumean{ display:block; width:calc(100% - 32px); margin:10px 16px; min-height:44px; padding:10px 14px; border:0; border-radius:6px; background:var(--sk-navy); color:var(--sk-cream); font-size:14px; font-weight:600; text-align:left; cursor:pointer; }\n'
             '  .suggest .suggest-didyoumean strong{ color:var(--sk-gold); }\n'
             '  /* the share button sits level with its neighbours and is not underlined like a text link */\n'
             '  .guide-card .guide-cta, .guide-card a.guide-cta{ text-decoration:none; display:inline-flex; align-items:center; justify-content:center; min-height:44px; }\n'
             '  @media (prefers-reduced-motion:reduce){ .evstd-icon path:nth-of-type(1){ stroke-dasharray:none; stroke-dashoffset:0; } }\n'
             '/*BRAND_RULES_END*/\n')
    # remove any earlier copy wherever it is, then place the block just before the main stylesheet closes
    s = re.sub(r'/\*BRAND_RULES_START\*/.*?/\*BRAND_RULES_END\*/\n', '', s, flags=re.S)
    i = s.find('</style>'); assert i > 0, 'the main stylesheet was not found'
    s = s[:i] + rules + s[i:]
    # restore what was held
    s = re.sub(r'\x00(\d+)\x00', lambda m: keep[int(m.group(1))], s)
    return s

if __name__ == '__main__':
    before = open(PAGE, encoding='utf-8').read()
    after = apply(before)
    open(PAGE, 'w', encoding='utf-8').write(after)
    print('website moved onto the brand system:', round(len(after) / 1024), 'KB (was', round(len(before) / 1024), 'KB)')
