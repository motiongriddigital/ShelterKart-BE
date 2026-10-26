#!/usr/bin/env python3
"""ShelterKart Home Buying Guide: builds the web version (one self-contained HTML file) and the A4 PDF from the same source.

    python3 guide/build_guide.py            builds a DRAFT (cover and footer say "Draft for review")
    python3 guide/build_guide.py --final    builds the publishable version (no draft markers)

Source text: guide/content/part1.md ... part5.md (the founder page, then Chapters 1 to 12, then the appendices).
Output:      guide/dist/ShelterKart-Home-Buying-Guide.html and .pdf

The text is never rewritten here. This file only decides how it looks: the voices, the formula boxes, the ShelterKart
boxes, the question cards. The PDF's contents page numbers are read back from a first render, so they are always true."""
import asyncio, base64, datetime, os, re, subprocess, sys
import markdown
from bs4 import BeautifulSoup

HERE = os.path.dirname(os.path.abspath(__file__))
BRAND = os.path.join(HERE, '..', 'brand', 'dist')   # the brand system: logos, icon and tokens come only from here
DIST = os.path.join(HERE, 'dist'); os.makedirs(DIST, exist_ok=True)
DRAFT = '--final' not in sys.argv
TODAY = datetime.date.today()
EDITION = f'Edition 1 · {TODAY.day} {TODAY.strftime("%B %Y")}'
NAME = 'ShelterKart-Home-Buying-Guide'
SITE = (os.environ.get('PUBLIC_BASE_URL') or os.environ.get('SITE_URL') or 'https://shelterkart.com').rstrip('/')
SHARE_TEXT = 'Before you visit a property, ask these 25 questions. Free, from ShelterKart:'
from urllib.parse import quote
SHARE_HREF = 'https://wa.me/?text=' + quote(SHARE_TEXT + ' ' + SITE + '/guide')
def share_meta():
    return (f'<meta name="description" content="What to check, what to ask, and what a good answer sounds like. Free, for any country.">'
            f'<meta property="og:type" content="website"><meta property="og:title" content="The ShelterKart Home Buying Guide">'
            f'<meta property="og:description" content="{SHARE_TEXT}"><meta property="og:image" content="{SITE}/guide/card.png">'
            f'<meta property="og:image:width" content="1588"><meta property="og:image:height" content="2246">'
            f'<meta name="twitter:card" content="summary_large_image">')

b64 = lambda p: base64.b64encode(open(p, 'rb').read()).decode()
LOGO_DARK = 'data:image/svg+xml;base64,' + b64(os.path.join(BRAND, 'lockup-dark.svg'))
LOGO_LIGHT = 'data:image/svg+xml;base64,' + b64(os.path.join(BRAND, 'lockup-light.svg'))
MARK = 'data:image/svg+xml;base64,' + b64(os.path.join(BRAND, 'icon.svg'))
MARK_DARK = 'data:image/svg+xml;base64,' + b64(os.path.join(BRAND, 'icon-on-navy.svg'))
TOKENS_CSS = open(os.path.join(BRAND, 'tokens.inline.css'), encoding='utf-8').read()
FONT = 'data:font/woff2;base64,' + b64(os.path.join(HERE, 'fonts', 'fraunces-latin-600-normal.woff2'))

# ---------------------------------------------------------------- the words
INBRIEF = {
 1: ['Decide what the purchase is for before you see a brochure.', 'The price is where the cost begins, not where it ends.', 'Write your must-haves and deal-breakers first.'],
 2: ['The brand is not the entity that signs.', 'Know who signs, who owns the land and who stands behind the promise.', 'Ask for names, numbers and a track record, in writing.'],
 3: ['Permission for one phase is not permission for the next.', 'Check that the area sold fits the area approved.', 'Verify every approval on the regulator\'s own page.'],
 4: ['If a promise is not in the agreement, treat it as not made.', 'Compare what a delay costs you with what the contract pays.', 'Read it as if the relationship has already gone wrong.'],
 5: ['Compare payment plans by what they cost today.', 'Compare homes by price per unit of carpet area.', 'Pay only what the agreement states, into the account it names.'],
 6: ['Treat the promised date as the earliest, not the likeliest.', 'Correct it by the seller\'s own record.', 'Do not let what you pay run ahead of what is built.'],
 7: ['Measure by carpet area, not by the largest number.', 'Check structure, waterproofing and services on evidence.', 'Stand in a finished unit, and bring someone independent.'],
 8: ['Run your household\'s ages forward to the day you move in.', 'Value what exists today, not what is planned.', 'Price the running cost of every amenity.'],
 9: ['Stress-test the loan at two points higher.', 'Price tax across buying, holding and selling.', 'Treat a currency move as part of the price.'],
 10: ['Hire your own local lawyer.', 'Limit any power of attorney.', 'Pay only to an account you have verified yourself.'],
 11: ['Document first, argue second.', 'Climb the ladder one rung at a time.', 'Estimate what a dispute is worth before you start one.'],
 12: ['The keys are not the title.', 'Reconcile the area and the money.', 'Snag every room, and keep the list.'],
}
VOICES = {'The friend': 'friend', 'The mathematician': 'maths', 'The engineer': 'engineer', 'The lawyer': 'lawyer',
          'The philosopher': 'philosopher', 'The consultant': 'consultant', 'The emotional beat': 'emotion'}

def read_sections():
    text = ''.join(open(os.path.join(HERE, 'content', f'part{i}.md'), encoding='utf-8').read() + '\n' for i in range(1, 6))
    secs, cur = [], None
    for line in text.split('\n'):
        if line.startswith('## '): cur = {'title': line[3:].strip(), 'lines': []}; secs.append(cur)
        elif cur is not None: cur['lines'].append(line)
    for s in secs: s['md'] = '\n'.join(s['lines']).strip()
    return secs

def md_html(md):
    return markdown.Markdown(extensions=['tables', 'sane_lists', 'smarty']).convert(md)

def tag(soup, name, cls=None, **attrs):
    t = soup.new_tag(name, **attrs)
    if cls: t['class'] = cls
    return t

# ---------------------------------------------------------------- transforming one section's HTML
def enhance(html, kind):
    soup = BeautifulSoup(f'<div id="root">{html}</div>', 'lxml'); root = soup.find(id='root')
    # 1. group the voices
    children = [c for c in root.children if getattr(c, 'name', None)]
    for c in children: c.extract()
    out, cur = [], None
    for el in children:
        first = el.find('strong', recursive=False) if el.name == 'p' else None
        label = first.get_text().rstrip('.') if first and el.contents and el.contents[0] is first else None
        if label in VOICES:
            first.extract()
            if el.contents and isinstance(el.contents[0], str): el.contents[0].replace_with(el.contents[0].lstrip())
            cur = tag(soup, 'div', ['voice', 'v-' + VOICES[label]])
            lab = tag(soup, 'span', 'voice-label'); lab.string = label
            body = tag(soup, 'div', 'voice-body'); body.append(el)
            cur.append(lab); cur.append(body); out.append(cur)
        elif el.name == 'h3':
            cur = None; out.append(el)
        elif cur is not None:
            cur.find('div', class_='voice-body').append(el)
        else:
            out.append(el)
    for o in out: root.append(o)
    # 2. formula boxes, worked examples, calculations
    for bq in root.find_all('blockquote'):
        bq.name = 'div'; bq['class'] = ['formula']
    for p in root.find_all('p'):
        t = p.get_text().strip()
        if re.match(r'^(Suppose|For example)\b', t) and p.find_parent(class_='voice'): p['class'] = p.get('class', []) + ['example']
        elif re.match(r'^[\d\s.,+×÷=−\-³^()%a-z]*=[^a-zA-Z]{6,}$', t) and re.match(r'^\d', t): p['class'] = p.get('class', []) + ['calc']
    for tb in root.find_all('table'):
        w = tag(soup, 'div', 'table-wrap'); tb.wrap(w)
    # 3. the ShelterKart box and the question cards
    kids = [c for c in root.children if getattr(c, 'name', None)]
    i = 0
    while i < len(kids):
        el = kids[i]
        if el.name == 'h3' and el.get_text().startswith('What ShelterKart checks'):
            box = tag(soup, 'aside', 'checks'); el.insert_before(box); j = i
            members = [el]; k = i + 1
            while k < len(kids) and kids[k].name != 'h3': members.append(kids[k]); k += 1
            for m in members: box.append(m)
            mk = tag(soup, 'img', 'checks-mark', src=MARK, alt=''); box.insert(0, mk)
            i = k; continue
        if el.name == 'h3' and el.get_text().startswith('Questions'):
            sec = tag(soup, 'section', 'questions'); el.insert_before(sec)
            members = [el]; k = i + 1
            while k < len(kids) and kids[k].name != 'h3': members.append(kids[k]); k += 1
            for m in members: sec.append(m)
            i = k; continue
        i += 1
    if kind == 'appendix-a':
        kids = [c for c in root.children if getattr(c, 'name', None)]
        grid = tag(soup, 'div', 'themes'); intro = []
        k = 0
        while k < len(kids):
            if kids[k].name == 'p' and kids[k].find('strong', recursive=False) and kids[k].get_text().strip() == kids[k].find('strong').get_text().strip():
                th = tag(soup, 'div', 'theme'); kids[k].insert_before(th); th.append(kids[k]); k += 1
                if k < len(kids) and kids[k].name == 'ol': th.append(kids[k]); k += 1
                grid.append(th)
            else: k += 1
        root.append(grid)
    if kind == 'appendix-b':
        for ul in root.find_all('ul'): ul['class'] = ['glossary']
    out_html = ''.join(str(c) for c in root.children)
    # exponents written as ^t or ^n in the formulas become superscripts
    out_html = re.sub(r'\^(\w+)', r'<sup>\1</sup>', out_html)
    return out_html

def founder_html(md):
    paras = [p.strip() for p in md.split('\n\n') if p.strip()]
    out = []
    for p in paras:
        h = md_html(p)
        if p == 'Preeyancc': out.append('<div class="sign"><span class="signname">Preeyancc</span><span class="signrole">Founder, ShelterKart</span></div>')
        elif re.match(r"^(Look past the brochure|Deals are made by people|Patience is a financial skill|I don't oversell)", p): out.append(h.replace('<p>', '<p class="principle">', 1))
        elif p.startswith('We will never tell you'): out.append(h.replace('<p>', '<p class="closing">', 1))
        else: out.append(h)
    return '\n'.join(out)

# ---------------------------------------------------------------- the document
def footer_rule(id_, label):
    """A named page for one chapter or appendix, so the printed footer carries its title as well as the page number."""
    esc = label.replace('\\', '\\\\').replace('"', '\\"')
    st = "font:7.5pt 'Instrument Sans',Arial,sans-serif;color:#52657F;vertical-align:top;padding-top:7mm"
    return (f'@page {id_}{{@bottom-left{{content:"__BASE__ · {esc}";{st}}}@bottom-right{{content:counter(page);{st}}}}}'
            f'#{id_}{{page:{id_}}}')

def build(pages):
    secs = read_sections()
    parts, toc = [], []
    page_css = []
    chap = 0
    for s in secs:
        t = s['title']
        if t.startswith('Why I started'):
            parts.append(f'<section class="page founder" id="founder"><img class="mark" src="{MARK}" alt=""><p class="kicker">A word from the founder</p><h2>{t}</h2>{founder_html(s["md"])}</section>')
            toc.append(('founder', '', t, 'A word from the founder'))
        elif t.startswith('How to use'):
            h = enhance(md_html(s['md']), 'howto')
            parts.append(f'<section class="page howto" id="howto"><p class="kicker">Before you start</p><h2>{t}</h2>{h}</section>')
            toc.append(('howto', '', t, ''))
        elif t.startswith('Chapter'):
            m = re.match(r'Chapter (\d+): (.*)', t); chap = int(m.group(1)); full = m.group(2)
            main, _, sub = full.partition(': ')
            brief = ''.join(f'<li>{x}</li>' for x in INBRIEF[chap])
            h = enhance(md_html(s['md']), 'chapter')
            parts.append(f'<section class="page chapter" id="ch{chap}"><header class="opener"><div class="num">{chap:02d}</div><div class="ttl"><p class="kicker">Chapter {chap}</p><h2>{main}</h2>' + (f'<p class="sub">{sub[0].upper() + sub[1:]}</p>' if sub else '') + f'</div></header><div class="brief"><p class="brief-label">In brief</p><ul>{brief}</ul></div>{h}</section>')
            toc.append((f'ch{chap}', f'{chap}', main, sub[0].upper() + sub[1:] if sub else ''))
            page_css.append(footer_rule(f'ch{chap}', f'Chapter {chap}: {main}'))
        elif t.startswith('Appendix'):
            m = re.match(r'Appendix ([A-C]): (.*)', t); letter, title = m.group(1), m.group(2)
            kind = 'appendix-' + letter.lower()
            h = enhance(md_html(s['md']), kind)
            if letter == 'A': h += '<p class="cardlink"><a href="/guide/card.pdf" download>Download this card as a one-page PDF</a></p>'
            parts.append(f'<section class="page appendix {kind}" id="app{letter.lower()}"><header class="opener small"><div class="num">{letter}</div><div class="ttl"><p class="kicker">Appendix {letter}</p><h2>{title}</h2></div></header>{h}</section>')
            toc.append((f'app{letter.lower()}', letter, title, ''))
            page_css.append(footer_rule(f'app{letter.lower()}', f'Appendix {letter}: {title}'))
    def pg(i): return pages.get(i, '·')
    rows = ''
    divider_done = set()
    for id_, n, title, sub in toc:
        if id_.startswith('ch') and 'ch' not in divider_done: rows += '<li class="toc-head">The guide</li>'; divider_done.add('ch')
        if id_.startswith('app') and 'app' not in divider_done: rows += '<li class="toc-head">Appendices</li>'; divider_done.add('app')
        if id_ in ('founder', 'howto') and 'front' not in divider_done: rows += '<li class="toc-head">Front matter</li>'; divider_done.add('front')
        rows += f'<li><a href="#{id_}"><span class="tn">{n}</span><span class="tt">{title}</span><span class="tl"></span><span class="tp">{pg(id_)}</span></a></li>'
    toc_html = f'<section class="page toc" id="contents"><p class="kicker">Contents</p><h2>What is in this guide</h2><ol class="toc-list">{rows}</ol></section>'
    draft_tag = '<p class="draft">Draft for review. Not for publication.</p>' if DRAFT else ''
    cover = f'''<section class="cover" id="top"><img class="lockup" src="{LOGO_DARK}" alt="ShelterKart"><div class="crule"></div>
<h1>The ShelterKart&nbsp;<br>Home Buying Guide</h1><p class="csub">What to check, what to ask, and what a good answer sounds like.</p>
<p class="ctag">The questions to ask before you pay.</p><p class="cmeta">{EDITION} &nbsp;·&nbsp; A free guide &nbsp;·&nbsp; Written for any country</p>{draft_tag}</section>'''
    back = f'''<section class="back"><img class="mark" src="{MARK_DARK}" alt=""><p class="bk-title">ShelterKart</p>
<p class="bk-text">This guide is general information for buyers in any market. It is not legal, tax, financial or investment advice, and it does not tell you whether to buy. Laws, rates and registers differ by country and change over time. Take advice from a licensed professional in the market where you are buying.</p>
<p class="bk-text">{EDITION}. The live version at shelterkart.com is the current one.</p></section>'''
    nav = f'<header class="topbar"><a class="brand" href="#top"><img src="{MARK_DARK}" alt=""><span>Home Buying Guide</span></a><nav><a href="#contents">Contents</a><a class="share" href="{SHARE_HREF}" target="_blank" rel="noopener" data-share>Share</a><a class="dl" href="{NAME}.pdf" download>Download PDF</a></nav></header>'
    css = open(os.path.join(HERE, 'guide.css'), encoding='utf-8').read().replace('__TOKENS__', TOKENS_CSS).replace('__MARK__', MARK_DARK)
    footer_label = 'ShelterKart Home Buying Guide' + (' · Draft' if DRAFT else '')
    css = css.replace('__FOOTER__', footer_label) + ''.join(r.replace('__BASE__', footer_label) for r in page_css)
    return (f'<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
            f'<title>ShelterKart Home Buying Guide</title>{share_meta()}<script>if(self!==top)document.documentElement.classList.add("embedded")</script><style>{css}</style></head><body>{nav}{cover}{"".join(parts[:2])}{toc_html}{"".join(parts[2:])}{back}</body></html>'), [t[0] for t in toc]

async def render_pdf(html_path, pdf_path):
    from playwright.async_api import async_playwright
    async with async_playwright() as p:
        b = await p.chromium.launch(); pg = await b.new_page()
        await pg.goto('file://' + html_path); await pg.wait_for_timeout(600)
        await pg.evaluate('document.fonts.ready')
        await pg.pdf(path=pdf_path, prefer_css_page_size=True, print_background=True, outline=True, tagged=True)
        await b.close()

def set_properties(pdf):
    """Document properties for the PDF reader's title bar and for search."""
    from pypdf import PdfReader, PdfWriter
    r = PdfReader(pdf); w = PdfWriter(clone_from=r)
    w.add_metadata({'/Title': 'The ShelterKart Home Buying Guide', '/Author': 'ShelterKart', '/Subject': 'What to check, what to ask, and what a good answer sounds like when you buy a property, in any country.',
                    '/Keywords': 'home buying guide, property purchase, due diligence, questions to ask, buyer checklist', '/Creator': 'ShelterKart guide builder'})
    w.page_mode = '/UseOutlines'
    with open(pdf, 'wb') as f: w.write(f)

def page_map(pdf, ids):
    """Where each section opens, read back from the PDF itself. The kickers are set in capitals, so the extracted text is too."""
    n = int(re.search(r'Pages:\s+(\d+)', subprocess.run(['pdfinfo', pdf], capture_output=True, text=True).stdout).group(1))
    texts = [subprocess.run(['pdftotext', '-f', str(i), '-l', str(i), pdf, '-'], capture_output=True, text=True).stdout for i in range(1, n + 1)]
    texts = [re.sub(r'\s+', '', t) for t in texts]          # letter-spaced labels extract with gaps: compare without whitespace
    out = {}
    for id_ in ids:
        for i, t in enumerate(texts):
            if id_ == 'founder' and 'AWORDFROMTHEFOUNDER' in t: out[id_] = i + 1; break
            if id_ == 'howto' and 'BEFOREYOUSTART' in t: out[id_] = i + 1; break
            if id_.startswith('ch') and re.search(rf'CHAPTER{id_[2:]}(?!\d)', t) and 'INBRIEF' in t: out[id_] = i + 1; break
            if id_.startswith('app') and f'APPENDIX{id_[3:].upper()}' in t: out[id_] = i + 1; break
    missing = [i for i in ids if i not in out]
    assert not missing, f'could not find the page of: {missing}'
    return out, n

def main():
    html_path, pdf_path = os.path.join(DIST, NAME + '.html'), os.path.join(DIST, NAME + '.pdf')
    html, ids = build({})
    open(html_path, 'w', encoding='utf-8').write(html)
    asyncio.run(render_pdf(html_path, pdf_path))
    pages, n = page_map(pdf_path, ids)
    html, _ = build(pages)
    open(html_path, 'w', encoding='utf-8').write(html)
    asyncio.run(render_pdf(html_path, pdf_path))
    set_properties(pdf_path)
    pages2, n2 = page_map(pdf_path, ids)
    assert pages == pages2, f'contents page numbers moved between passes: {pages} vs {pages2}'
    # the server serves these two files at /guide and /guide/pdf
    import shutil
    live = os.path.join(HERE, '..', 'backend', 'data', 'guide'); os.makedirs(live, exist_ok=True)
    for f in (NAME + '.html', NAME + '.pdf'): shutil.copy2(os.path.join(DIST, f), os.path.join(live, f))
    print(f'{n2} pages; contents verified: ' + ', '.join(f'{k}:{v}' for k, v in pages2.items()))

if __name__ == '__main__':
    main()
