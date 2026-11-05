#!/usr/bin/env python3
"""Browser check of the live search screen (SEARCH_V2=on), against the real page with the server's answers faked from the real matcher.

Run: node -e "<see test>" to refresh /tmp/search_answers.json, then python3 tools/search_ui_check.py  (needs playwright; not part of npm test)
"""
import json, sys, pathlib, http.server, threading, socketserver, functools
from playwright.sync_api import sync_playwright
ROOT = pathlib.Path(__file__).resolve().parent.parent
ANS = json.loads(pathlib.Path('/tmp/search_answers.json').read_text())
fails = 0
def ok(label, cond):
    global fails
    print(('  ok   ' if cond else '  FAIL ') + label); fails += 0 if cond else 1
html = (ROOT / 'shelterkart-frontend.html').read_text(encoding='utf-8'); assert 'const API_BASE = "";' in html
site = pathlib.Path('/tmp/su_site'); site.mkdir(exist_ok=True); (site / 'index.html').write_text(html.replace('const API_BASE = "";', 'const API_BASE = location.origin;'), encoding='utf-8')
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a, **k): pass
srv = socketserver.TCPServer(('127.0.0.1', 0), functools.partial(Q, directory=str(site))); port = srv.server_address[1]; threading.Thread(target=srv.serve_forever, daemon=True).start()

def page(p, mode='on', candidates_fail=False):
    b = p.chromium.launch(); pg = b.new_page(viewport={'width': 390, 'height': 844}); state = {'research': [], 'cand': []}
    def handle(r):
        u = r.request.url
        if '/api/search/config' in u: return r.fulfill(status=200, content_type='application/json', body=json.dumps({'mode': mode}))
        if '/api/search/candidates' in u:
            body = json.loads(r.request.post_data or '{}'); state['cand'].append(body)
            if candidates_fail: return r.fulfill(status=500, content_type='application/json', body='{"ok":false}')
            key = '__remember' if body.get('remember') else body.get('query')
            return r.fulfill(status=200, content_type='application/json', body=json.dumps(ANS.get(key, {'ok': True, 'confidence': 'none', 'candidates': [], 'notFound': {'closest': [], 'ask': [], 'researchAnyway': True}})))
        if u.rstrip('/').endswith('/api/research') or u.rstrip('/').endswith('/api/investigate'): state['research'].append(json.loads(r.request.post_data or '{}')); return r.fulfill(status=503, content_type='application/json', body='{"ok":false,"error":"test"}')
        if '/api/' in u: return r.fulfill(status=404, content_type='application/json', body='{}')
        return r.continue_()
    pg.route('**/*', handle); pg.goto(f'http://127.0.0.1:{port}/index.html'); pg.wait_for_timeout(1200)
    pg.evaluate("document.getElementById('countrySelect').value = 'in'")
    pg.evaluate("document.querySelectorAll('.consent-banner').forEach(b => b.classList.remove('visible'))")
    return b, pg, state
def search(pg, q): pg.fill('#searchInput', q); pg.click('#searchBtn'); pg.wait_for_timeout(700)
def texts(pg, sel): return pg.eval_on_selector_all(sel, 'els => els.map(e => e.textContent.trim())')

with sync_playwright() as p:
    print('a confident match')
    b, pg, st = page(p); search(pg, 'vasant hieghts')
    ok('the box asks "Is this the project you mean?"', 'Is this the project you mean?' in pg.inner_text('#suggest'))
    items = texts(pg, '#suggest .suggest-live'); ok('the project shows with its area and city, the developer, the registration number and why it matched',
      items and 'Vasant Heights' in items[0] and 'Worli' in items[0] and 'Vasant Builders' in items[0] and 'P519' in items[0] and 'Best match' in items[0])
    pg.click('#suggest .suggest-live'); pg.wait_for_timeout(500)
    ok('choosing it starts research on that project, by its real name and area', st['research'] and st['research'][0].get('query') == 'Vasant Heights' and st['research'][0].get('location') == 'Worli'); b.close()

    print('two projects share a name')
    b, pg, st = page(p); search(pg, 'Shreeji Greens')
    ok('the box asks the buyer to choose, and both cities are offered', 'Which of these do you mean? Choose one.' in pg.inner_text('#suggest') and len(texts(pg, '#suggest .suggest-live')) == 2)
    ok('the two are told apart by city', any('Mumbai' in t for t in texts(pg, '#suggest .suggest-live')) and any('Pune' in t for t in texts(pg, '#suggest .suggest-live')))
    ok('neither is called the best match, because neither leads', not any('Best match' in t for t in texts(pg, '#suggest .suggest-live')))
    pg.click('#suggest .suggest-didyoumean'); pg.wait_for_timeout(300); ok('"None of these" opens "tell us what you remember"', pg.is_visible('#suggest .suggest-form')); b.close()

    print('nothing found')
    b, pg, st = page(p); search(pg, 'Godrej Platinum')
    t = pg.inner_text('#suggest'); ok('it says so plainly, and asks what the buyer remembers', 'We could not find' in t and pg.is_visible('#suggest .suggest-form'))
    pg.fill('#suggest .suggest-form input[name=developer]', 'Arihant'); pg.fill('#suggest .suggest-form input[name=locality]', 'Juhu'); pg.click('#suggest .suggest-form button[type=submit]'); pg.wait_for_timeout(600)
    ok('"tell us what you remember" searches again with those details and finds the project', st['cand'][-1].get('remember', {}).get('developer') == 'Arihant' and 'Skyline Towers' in pg.inner_text('#suggest'))
    b.close(); b, pg, st = page(p); search(pg, 'Godrej Platinum'); pg.click('#suggest .suggest-anyway'); pg.wait_for_timeout(500)
    ok('"Research it anyway" starts research on what the buyer typed', st['research'] and st['research'][0].get('query') == 'Godrej Platinum'); b.close()

    print('never a dead end, and nothing changes until switched on')
    b, pg, st = page(p, candidates_fail=True); search(pg, 'vasant hieghts'); ok('if the candidate search fails, the page researches what was typed, as before', st['research'] and st['research'][0].get('query') == 'vasant hieghts'); b.close()
    b, pg, st = page(p, mode='shadow'); search(pg, 'vasant hieghts'); ok('in shadow mode the page searches exactly as before: no candidate call, straight to research', not st['cand'] and st['research'] and st['research'][0].get('query') == 'vasant hieghts'); b.close()

    print('readability')
    b, pg, st = page(p); search(pg, 'Godrej Platinum')
    r = pg.evaluate("""(() => { const box = document.getElementById('suggest'); const els = [...box.querySelectorAll('button,input')].filter(e => e.offsetParent);
      const small = [...box.querySelectorAll('*')].filter(e => [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()) && parseFloat(getComputedStyle(e).fontSize) < 14).length;
      const shortOnes = els.filter(e => e.getBoundingClientRect().height < 44).map(e => e.tagName + '.' + e.className + ' ' + Math.round(e.getBoundingClientRect().height));
      const smallOnes = [...box.querySelectorAll('*')].filter(e => [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()) && parseFloat(getComputedStyle(e).fontSize) < 14).map(e => e.tagName + '.' + e.className + ' ' + getComputedStyle(e).fontSize);
      return { tall: els.every(e => e.getBoundingClientRect().height >= 44), small, wide: document.documentElement.scrollWidth <= innerWidth, shortOnes, smallOnes, sw: document.documentElement.scrollWidth } })()""")
    print('     detail:', r['shortOnes'][:4], r['smallOnes'][:4], 'width', r['sw'])
    ok('every control is at least 44 px tall, no text is under 14 px, and the page does not scroll sideways on a 390 px phone', r['tall'] and r['small'] == 0 and r['wide'])
    pg.screenshot(path='/tmp/dk/search_notfound.png', full_page=False); b.close()
    b, pg, st = page(p); search(pg, 'Shreeji Greens'); pg.screenshot(path='/tmp/dk/search_choose.png', full_page=False); b.close()
print(f'\n{"all passing" if not fails else str(fails) + " FAILED"}'); sys.exit(1 if fails else 0)
