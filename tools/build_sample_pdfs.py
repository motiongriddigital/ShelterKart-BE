import json, subprocess, os
from datetime import datetime

import os, re
_SITE = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'shelterkart-frontend.html'), encoding='utf-8').read()
_CSS = re.search(r'<style>(.*)</style>', _SITE, re.S).group(1)
ROOT_CSS = re.search(r':root\s*\{(.*?)\n\s*\}', _CSS, re.S).group(0)
_a = _CSS.index('LIVE RESEARCH BRIEF'); LB_CSS = _CSS[_a:_CSS.index('/* Preview mode', _a)]

LABEL = {'confirmed':'Confirmed at source','reported':'Reported by several sites','single':'Single source',
         'developer':"Developer's own claim",'disputed':'Sources disagree'}
CLASS = {'confirmed':'m-confirmed','reported':'m-reported','single':'m-single','developer':'m-developer','disputed':'m-disputed'}

def esc(s):
    return (str(s).replace('&','&amp;').replace('<','&lt;').replace('>','&gt;').replace('"','&quot;'))

def link(url, text):
    return f'<a href="{esc(url)}">{esc(text)}</a>'

BANDS = [(0, 40, 'Serious concerns', 'disputed'), (40, 60, 'Weak', 'single'), (60, 80, 'Mixed', 'reported'), (80, 101, 'Strong', 'confirmed')]
def scale_html(v):
    """The same rating scale as the website: bands at their real widths, the report's band at full strength, a marker at the score."""
    segs = labs = ''
    for lo, hi, label, tone in BANDS:
        width = min(hi, 100) - lo; on = lo <= v < hi
        segs += f'<td style="width:{width}%;background:var(--ev-{tone}-bar);opacity:{1 if on else 0.25}"></td>'
        labs += f'<td style="width:{width}%;font-size:10px;color:{"var(--ink-1)" if on else "var(--ink-3)"};font-weight:{600 if on else 400}">{label}</td>'
    return (f'<div class="sk-scale"><table class="sk-scale-t"><tr>{segs}</tr></table>'
            f'<div class="sk-needle" style="left:{v}%"></div><table class="sk-scale-l"><tr>{labs}</tr></table></div>')

def render(b):
    out = []
    out.append(f'<div class="lb-brand"><span class="lb-brand-dot"></span><span class="lb-brand-name">ShelterKart research brief</span><span class="lb-brand-ref">{esc(b["ref"])}</span></div>')
    out.append(f'<h2>{esc(b["project"]["name"])}</h2>')
    where = ' &middot; '.join(x for x in [b['project'].get('location',''), ('Developer: '+b['project']['developer']) if b['project'].get('developer') else ''] if x)
    if where: out.append(f'<p class="lb-meta">{where}</p>')
    if b['project'].get('ids'):
        out.append(f'<p class="lb-meta">Registration: {esc(", ".join(b["project"]["ids"]))} (as reported &mdash; see marks below)</p>')
    checked = datetime.fromisoformat(b['checkedAt']).strftime('%-d %B %Y')
    out.append(f'<p class="lb-small">{esc(b["marketLabel"])} &middot; {esc(b["depth"])} &middot; checked {checked}.</p>')
    if b.get('registry'):
        out.append(f'<p class="lb-small">Official register match: {link(b["registry"]["url"], b["registry"]["name"] + " (" + b["registry"]["id"] + ")")}</p>')
    sc = b.get('score')
    if sc and sc.get('value') is not None:
        tone = lambda v: 'confirmed' if v >= 80 else 'reported' if v >= 60 else 'single' if v >= 40 else 'disputed'
        rows = ''
        for c in sc['components']:
            reasons = ''.join(f'<li>{esc(r)}</li>' for r in c.get('reasons', []))
            assessed = c["value"] is not None       # a part with no corroborated evidence is "not assessed", never a number
            bar = (f'<div class="sk-track"><div style="width:{c["value"]}%;background:var(--ev-{tone(c["value"])}-bar)"></div></div>' if assessed
                   else '<span class="sk-na">Not assessed</span>')
            rows += (f'<tr><td class="sk-l">{esc(c["label"])} &middot; {c["weight"]}%</td>'
                     f'<td class="sk-b">{bar}</td>'
                     f'<td class="sk-p">{c["value"] if assessed else "&mdash;"}</td></tr>'
                     + (f'<tr><td colspan="3" class="sk-r"><ul>{reasons}</ul></td></tr>' if reasons else ''))
        out.append(f'<div class="sk-score"><table class="sk-head"><tr><td class="sk-dial" style="border-color:var(--ev-{tone(sc["value"])}-bar)">'
                   f'<span class="sk-v">{sc["value"]}</span><span class="sk-of">/100</span></td>'
                   f'<td><div class="sk-k">ShelterKart Score</div><div class="sk-band">{esc(sc["band"])}</div>'
                   f'<div class="sk-c">{esc(sc["confidence"])} confidence. {esc(sc.get("confidenceReason", ""))}</div></td></tr></table>'
                   + scale_html(sc['value']) +
                   f'<table class="sk-parts">{rows}</table>'
                   f'<p class="sk-m">Worked out by code from corroborated evidence only (methodology {esc(sc["methodology"])}). '
                   f'The developer\u2019s own claims and single-source findings never move it. It describes the public record, not whether to buy.</p></div>')
    elif sc:
        out.append(f'<p class="lb-small">{esc(sc.get("withheldReason") or "No score.")}</p>')
    for n in b.get('notes', []):
        out.append(f'<p class="lb-note">{esc(n)}</p>')

    counts = b['counts']; total = sum(counts.values())
    if total:
        bar = '<div class="lb-bar">' + ''.join(
            f'<i style="width:{100*n/total:.2f}%;background:var(--ev-{k}-bar)"></i>' for k,n in counts.items() if n) + '</div>'
        legend = '<ul class="lb-legend">' + ''.join(
            f'<li><span class="lb-sw" style="background:var(--ev-{k}-bar)"></span><b>{n}</b> {LABEL[k].lower()}</li>' for k,n in counts.items() if n) + '</ul>'
        out.append(bar + legend)
    if b.get('removed'):
        out.append(f'<p class="lb-small">{b["removed"]} claim(s) removed because the page cited never came back in the search.</p>')

    out.append('<h3>What the record shows</h3>')
    if b['findings']:
        items = ''
        for f in b['findings']:
            chip = f'{f["sites"]} sites' if f['mark']=='reported' else LABEL[f['mark']]
            src = ' '.join(link(s['url'], s['site']) for s in f['sources'])
            note = f'<p class="lb-note">{esc(f["note"])}</p>' if f.get('note') else ''
            items += f'<li><span class="lb-chip {CLASS[f["mark"]]}">{esc(chip)}</span><p>{esc(f["claim"])}</p><p class="lb-src">Found on: {src}</p>{note}</li>'
        out.append(f'<ul class="lb-items">{items}</ul>')

    if b.get('conflicts'):
        out.append('<h3>Where sources disagree</h3>')
        items = ''
        for c in b['conflicts']:
            vs = ''.join(f'<li>{esc(v["value"])} &mdash; {link(v["url"], v["site"])}</li>' for v in c['versions'])
            items += f'<li><span class="lb-chip m-disputed">Sources disagree</span><p>{esc(c["topic"])}</p><ul class="lb-ver">{vs}</ul></li>'
        out.append(f'<ul class="lb-items">{items}</ul>')

    if b.get('reading'):
        out.append('<h3>Reading between the lines</h3>')
        items = ''.join(f'<li><p>{esc(r["observation"])}</p><p class="lb-ask">{esc(r["question"])}</p></li>' for r in b['reading'])
        out.append(f'<ul class="lb-items">{items}</ul>')

    if b.get('gaps'):
        out.append("<h3>What couldn't be found</h3>")
        items = ''.join(f'<li><p>{esc(g["topic"])}</p><p class="lb-src">{esc(g["why"])}</p></li>' for g in b['gaps'])
        out.append(f'<ul class="lb-items">{items}</ul>')

    if b.get('questions'):
        out.append('<h3>What to ask, and who</h3>')
        order = ['Before booking','Before signing','Before each payment','Before possession']
        groups = {}
        for q in b['questions']: groups.setdefault(q['when'], []).append(q)
        for k in order:
            if k not in groups: continue
            out.append(f'<h4>{k}</h4>')
            items = ''
            for q in groups[k]:
                items += (f'<li><p class="lb-src">{esc(q["who"])}</p><p class="lb-q">&ldquo;{esc(q["question"])}&rdquo;</p>'
                          f'<p class="lb-good">Good answer: {esc(q["good"])}</p><p class="lb-bad">Red flag: {esc(q["red_flag"])}</p></li>')
            out.append(f'<ul class="lb-items">{items}</ul>')

    pr = b.get('protections')
    if pr and pr.get('items'):
        kind = {'right': ('Your right', 'var(--ev-confirmed-bar)'), 'cost': ('Budget for', '#B6832B'), 'action': ('If it goes wrong', '#163C64')}
        out.append('<h3>Your protections as a buyer</h3>')
        out.append(f'<p class="lb-small">For {esc(pr["label"])}. Verified {esc(pr["verified"])}. {esc(pr["disclaimer"])}</p>')
        rows = ''
        for it in pr['items']:
            k, col = kind.get(it['kind'], ('', '#52657F'))
            srcs = ' &middot; '.join(link(x['url'], x['label']) for x in it['sources'])
            rows += (f'<li><span class="lb-chip" style="background:#fff;border:1px solid {col};color:{col}">{esc(k)}</span>'
                     f'<p><strong>{esc(it["title"])}</strong></p><p>{esc(it["detail"])}</p>'
                     f'<p class="lb-src"><em>{esc(it["law"])}</em> &middot; Sources: {srcs}</p></li>')
        out.append(f'<ul class="lb-items">{rows}</ul>')
    out.append('<h3>Check your own documents</h3>')
    out.append('<p class="lb-small">Included with the full report online: upload your allotment letter, agreement or '
               'registration certificate, and ShelterKart compares its registration number, seller, possession date and '
               'payment bank with the findings above, marking each as matching, partly matching or not matching. '
               'Your personal details are never read, and the file is never stored.</p>')
    out.append('<h3>Every page checked</h3>')
    n_cited = sum(1 for p in b['pages'] if p['cited'])
    out.append(f'<p class="lb-small">{b["searches"]} searches, {len(b["pages"])} pages checked, {n_cited} cited above. '
               'Pages marked “checked, not cited” were read but did not support any finding.</p>')
    pages = ''.join(
        f'<li class="{"cited" if p["cited"] else "uncited"}">{link(p["url"], p["title"])} ({esc(p["site"])})'
        + ('' if p["cited"] else ' <span class="lb-uncited">&mdash; checked, not cited</span>') + '</li>'
        for p in b['pages'])
    out.append(f'<ol class="lb-pages">{pages}</ol>')

    out.append('<div class="lb-foot">')
    out.append(f'<p>{esc(b["disclaimer"])}</p>')
    out.append(f'<p>Responsible: {esc(b["responsible"]["name"])}, {esc(b["responsible"]["title"])}. Corrections: {esc(b["responsible"]["contact"])}</p>')
    out.append('</div>')
    return '\n'.join(out)

PAGE_TMPL = '''<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
{root_css}
* {{ box-sizing:border-box; }}
/* IBM Plex Sans is not installed in this sandbox (no network to
   fetch it) -- DejaVu Sans is the real, honest fallback for body
   text. Fraunces IS the real installed font for headings, the same
   file used to build the brand lockups. */
body {{ margin:0; font-family:'DejaVu Sans', 'IBM Plex Sans', sans-serif; background:#FAF8F5; }}
.lb {{ max-width:100%; padding:36px 40px 30px; }}
{lb_css}
.lb h2 {{ font-family:'Fraunces', serif; font-weight:600; }}
.lb h3, .lb h4 {{ font-family:'Fraunces', serif; font-weight:600; }}
.lb .lb-brand-ref {{ font-family:'DejaVu Sans Mono', monospace; }}
.sk-score {{ border:1px solid var(--rule-soft); border-radius:10px; padding:12px 14px; margin:12px 0 8px; page-break-inside:avoid; }}
.sk-head {{ border-collapse:collapse; }} .sk-head td {{ vertical-align:middle; }}
.sk-dial {{ width:70px; text-align:left; padding:0 !important; border:none !important; }}   /* a large number, as on the website */
.sk-v {{ font-family:'Fraunces', serif; font-weight:600; font-size:34px; }} .sk-of {{ font-size:10px; color:var(--ink-3); }}
.sk-head td + td {{ padding-left:14px; }}
.sk-k {{ font-size:11px; color:var(--ink-3); }}   /* sentence case, as on the website */
.sk-band {{ font-family:'Fraunces', serif; font-weight:600; font-size:16px; }} .sk-c {{ font-size:11.5px; color:var(--ink-2); }}
.sk-parts {{ width:100%; border-collapse:collapse; margin-top:8px; }}
.sk-parts td {{ padding:3px 0; font-size:12px; }} .sk-l {{ width:44%; }} .sk-p {{ width:30px; text-align:right; }}
.sk-track {{ height:7px; background:var(--paper-2); border-radius:4px; overflow:hidden; margin:0 8px; }} .sk-track div {{ height:7px; }}
.sk-r ul {{ margin:0 0 4px 0; padding-left:16px; color:var(--ink-2); font-size:11px; }}
.sk-m {{ font-size:10.5px; color:var(--ink-3); margin:6px 0 0; }}
.sk-scale {{ position:relative; margin:10px 0 2px; }} .sk-scale-t {{ width:100%; border-collapse:collapse; height:8px; }} .sk-scale-t td {{ height:8px; padding:0; }}
.sk-needle {{ position:absolute; top:-4px; width:3px; height:16px; margin-left:-1px; background:var(--ink-1); }} .sk-scale-l {{ width:100%; border-collapse:collapse; margin-top:4px; }} .sk-scale-l td {{ padding:0; }}
.sk-na {{ font-size:11px; color:var(--ink-3); font-style:italic; margin-left:8px; }}
.lb ol.lb-pages li.uncited, .lb ol.lb-pages li.uncited a {{ color:var(--ink-3) !important; }}
.lb .lb-uncited {{ font-style:italic; }}
</style></head><body>
<section class="lb" id="liveBrief">{body}</section>
</body></html>'''

def to_pdf(brief, out_path):
    html = PAGE_TMPL.format(root_css=ROOT_CSS, lb_css=LB_CSS, body=render(brief))
    html_path = out_path.replace('.pdf', '.html')
    open(html_path, 'w').write(html)
    subprocess.run(['wkhtmltopdf', '--enable-local-file-access', '--encoding', 'utf-8', '--page-size', 'A4',
                     '--margin-top', '0', '--margin-bottom', '0', '--margin-left', '0', '--margin-right', '0',
                     html_path, out_path], check=True, capture_output=True)
    return out_path

if __name__ == '__main__':
    import sys
    brief = json.load(open(sys.argv[1]))
    to_pdf(brief, sys.argv[2])
    print('built', sys.argv[2])
