#!/usr/bin/env python3
"""The sales-office card: Appendix A of the guide on one page, as a PDF (for printing) and a PNG (for sharing).
Reads its questions from guide/content/part5.md, so the card and the guide cannot disagree.
    python3 guide/build_card.py
Output: guide/dist/ShelterKart-Sales-Office-Card.pdf and .png, and copies in backend/data/guide/ (served by the server)."""
import asyncio, base64, os, re, shutil, subprocess
from playwright.async_api import async_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
DIST = os.path.join(HERE, 'dist'); os.makedirs(DIST, exist_ok=True)
LIVE = os.path.join(HERE, '..', 'backend', 'data', 'guide'); os.makedirs(LIVE, exist_ok=True)
NAME = 'ShelterKart-Sales-Office-Card'
FONT = 'data:font/woff2;base64,' + base64.b64encode(open(os.path.join(HERE, 'fonts', 'fraunces-latin-600-normal.woff2'), 'rb').read()).decode()
BRAND = os.path.join(HERE, '..', 'brand', 'dist')
MARK = 'data:image/svg+xml;base64,' + base64.b64encode(open(os.path.join(BRAND, 'icon.svg'), 'rb').read()).decode()
TOKENS_CSS = open(os.path.join(BRAND, 'tokens.inline.css'), encoding='utf-8').read()

def appendix_a():
    text = open(os.path.join(HERE, 'content', 'part5.md'), encoding='utf-8').read()
    body = text.split('## Appendix A: The sales-office card', 1)[1].split('## Appendix B', 1)[0]
    themes, cur = [], None
    for line in body.split('\n'):
        line = line.strip()
        m = re.match(r'^\*\*(.+?)\*\*$', line)
        if m: cur = {'title': m.group(1), 'items': []}; themes.append(cur); continue
        m = re.match(r'^\d+\.\s+(.*)$', line)
        if m and cur is not None: cur['items'].append(m.group(1))
    total = sum(len(t['items']) for t in themes)
    assert total == 25, f'the card expects 25 questions, found {total}'
    return themes

def html(themes):
    cols = [[], []]
    # two columns, filled in order so both stay balanced
    total = sum(len(t['items']) for t in themes); half = total / 2; left = 0
    for t in themes:
        # put the theme in the left column while that keeps the columns closest to equal
        if abs((left + len(t['items'])) - half) <= abs(left - half) and not (left >= half): cols[0].append(t); left += len(t['items'])
        else: cols[1].append(t)
    def block(t):
        start = sum(len(x['items']) for x in themes[:themes.index(t)])
        items = ''.join(f'<li><span class="n">{start + i + 1}</span>{q}</li>' for i, q in enumerate(t['items']))
        return f'<div class="theme"><p class="th">{t["title"]}</p><ol>{items}</ol></div>'
    return f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><style>
{TOKENS_CSS}
@page{{size:A4;margin:0}}
*{{box-sizing:border-box}}
html,body{{margin:0;background:var(--sk-paper);color:var(--sk-ink-soft);font-family:var(--sk-font-text);font-variant-numeric:tabular-nums}}
.card{{width:210mm;height:297mm;padding:13mm 14mm 11mm;position:relative;overflow:hidden;background:#FAF8F5}}
.top{{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:.5mm solid #D3A245;padding-bottom:4mm}}
.brand{{display:flex;align-items:center;gap:2.6mm;font-family:var(--sk-font-display);font-weight:600;font-size:15pt;color:#061428}}
.brand img{{width:9mm;height:auto}}
.kick{{font-size:7.2pt;letter-spacing:.14em;text-transform:uppercase;color:#8A6321;font-weight:700;text-align:right;line-height:1.5}}
h1{{font-family:var(--sk-font-display);font-weight:600;font-size:21pt;color:#0A1C33;margin:4.5mm 0 1.5mm;line-height:1.1}}
.sub{{font-size:9pt;color:#52657F;margin:0 0 4mm;line-height:1.45}}
.cols{{display:grid;grid-template-columns:1fr 1fr;column-gap:8mm}}
.theme{{margin:0 0 4.6mm;break-inside:avoid}}
.th{{font-family:var(--sk-font-display);font-weight:600;font-size:12pt;color:#8A6321;margin:0 0 1.6mm}}
ol{{list-style:none;margin:0;padding:0}}
li{{display:flex;gap:2.2mm;font-size:9.4pt;line-height:1.4;margin:0 0 1.5mm;color:#0A1C33}}
.n{{flex:none;width:4.6mm;font-family:var(--sk-font-display);font-weight:600;color:#D3A245;font-size:9.4pt;text-align:right}}
.foot{{position:absolute;left:14mm;right:14mm;bottom:9mm;border-top:.3mm solid #E4DDD1;padding-top:3mm;display:flex;justify-content:space-between;font-size:7.4pt;color:#52657F}}
.foot b{{color:#0A1C33}}
</style></head><body><div class="card">
<div class="top"><div class="brand"><img src="{MARK}" alt="">ShelterKart</div><div class="kick">Free · Any country<br>Appendix A of the guide</div></div>
<h1>The sales-office card</h1>
<p class="sub">Ask each question in writing and note the date. A good answer comes with a document. A weak answer is a promise.</p>
<div class="cols"><div>{''.join(block(t) for t in cols[0])}</div><div>{''.join(block(t) for t in cols[1])}</div></div>
<div class="foot"><span><b>Research, not advice.</b> General information for buyers in any market. It does not tell you whether to buy.</span><span><b>shelterkart.com/guide</b></span></div>
</div></body></html>'''

async def render(themes):
    src = os.path.join(DIST, NAME + '.html'); open(src, 'w', encoding='utf-8').write(html(themes))
    async with async_playwright() as p:
        b = await p.chromium.launch(); pg = await b.new_page(viewport={'width': 794, 'height': 1123}, device_scale_factor=2)
        await pg.goto('file://' + src); await pg.evaluate('document.fonts.ready'); await pg.wait_for_timeout(300)
        height = await pg.evaluate("document.querySelector('.card').scrollHeight")
        fits = await pg.evaluate("(() => { const c = document.querySelector('.cols').getBoundingClientRect(), f = document.querySelector('.foot').getBoundingClientRect(); return c.bottom <= f.top - 4; })()")
        assert fits, 'the questions do not fit above the footer on one page'
        await pg.pdf(path=os.path.join(DIST, NAME + '.pdf'), prefer_css_page_size=True, print_background=True)
        await pg.locator('.card').screenshot(path=os.path.join(DIST, NAME + '.png'))
        await b.close()

themes = appendix_a()
asyncio.run(render(themes))
pages = int(re.search(r'Pages:\s+(\d+)', subprocess.run(['pdfinfo', os.path.join(DIST, NAME + '.pdf')], capture_output=True, text=True).stdout).group(1))
assert pages == 1, f'the card must be one page, got {pages}'
for f in (NAME + '.pdf', NAME + '.png'): shutil.copy2(os.path.join(DIST, f), os.path.join(LIVE, f))
print('card: one page; 25 questions; copied to backend/data/guide')
