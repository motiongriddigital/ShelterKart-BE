#!/usr/bin/env python3
"""Browser check of the visit-source consent switch, against the real page with the server's answers faked.

Run: python3 tools/source_consent_check.py        (needs playwright and chromium; not part of `npm test`)

For a visitor who must be asked (the EEA, UK, Switzerland, or a country the edge could not tell): the choice banner appears, nothing is
kept in sessionStorage and no source is sent with a checkout until "Allow"; "No thanks" keeps it that way and removes anything held.
For a visitor who need not be asked: no choice banner, the source is kept and sent. The choice is remembered across a reload.
"""
import json, sys, pathlib, http.server, threading, socketserver, functools
from playwright.sync_api import sync_playwright
ROOT = pathlib.Path(__file__).resolve().parent.parent
fails = 0
def ok(label, cond):
    global fails
    print(('  ok   ' if cond else '  FAIL ') + label); fails += 0 if cond else 1

# serve the page with API_BASE pointing at the same origin, so the page's own start-up code runs
html = (ROOT / 'shelterkart-frontend.html').read_text(encoding='utf-8')
assert 'const API_BASE = "";' in html
site = pathlib.Path('/tmp/sc_site'); site.mkdir(exist_ok=True)
(site / 'index.html').write_text(html.replace('const API_BASE = "";', 'const API_BASE = location.origin;'), encoding='utf-8')
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a, **k): pass
h = functools.partial(Quiet, directory=str(site))
srv = socketserver.TCPServer(('127.0.0.1', 0), h); port = srv.server_address[1]; threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f'http://127.0.0.1:{port}/index.html?utm_source=instagram&utm_medium=social&utm_campaign=in-t07'

def visit(p, mode, storage=None):
    b = p.chromium.launch(); ctx = b.new_context(viewport={'width': 390, 'height': 844}); pg = ctx.new_page(); sent = []
    pg.route('**/api/source-consent', lambda r: r.fulfill(status=200, content_type='application/json', body=json.dumps({'mode': mode})))
    def other(r):
        u = r.request.url
        if '/api/research/checkout' in u: sent.append(json.loads(r.request.post_data or '{}')); r.fulfill(status=400, content_type='application/json', body='{"ok":false}')
        elif '/api/' in u: r.fulfill(status=404, content_type='application/json', body='{}')
        else: r.continue_()
    pg.route('**/api/**', lambda r: r.fallback()); pg.route(lambda u: '/api/' in u and 'source-consent' not in u, other)
    if storage:
        pg.add_init_script('(' + json.dumps(storage) + ' && Object.entries(' + json.dumps(storage) + ').forEach(([k,v])=>localStorage.setItem(k,v)))')
    pg.goto(URL); pg.wait_for_timeout(1800)
    return b, pg, sent

def src_state(pg): return pg.evaluate("({ session: sessionStorage.getItem('sk_src'), allowed: skSourceAllowed(), send: skSourceForSend() })")
def visible(pg, id_): return pg.evaluate(f"document.getElementById('{id_}').classList.contains('visible')")

with sync_playwright() as p:
    print('a visitor who must be asked (required)')
    b, pg, _ = visit(p, 'required')
    ok('the choice banner shows, and the ordinary notice waits', visible(pg, 'sourceChoice') and not visible(pg, 'consentBanner'))
    st = src_state(pg); ok('before a choice: nothing is stored on the device and nothing would be sent', st['session'] is None and st['allowed'] is False and st['send'] is None)
    ok('the source is still known in memory for this page load, ready if they agree', pg.evaluate("skSource().utm.campaign") == 'in-t07')
    pg.click('#sourceChoice button:not(.alt)'); pg.wait_for_timeout(500)
    st = src_state(pg); ok('after Allow: it is stored for the visit and would be sent', st['session'] is not None and st['allowed'] is True and st['send']['utm']['campaign'] == 'in-t07')
    ok('the choice banner closes and the ordinary notice follows', not visible(pg, 'sourceChoice')); pg.wait_for_timeout(900); ok('the ordinary notice then shows', visible(pg, 'consentBanner'))
    ok('the choice is remembered', pg.evaluate("localStorage.getItem('sk_src_choice')") == 'granted'); b.close()

    b, pg, _ = visit(p, 'required')
    pg.click('#sourceChoice button.alt'); pg.wait_for_timeout(500)
    st = src_state(pg); ok('after No thanks: nothing is stored, and nothing would be sent', st['session'] is None and st['allowed'] is False and st['send'] is None and pg.evaluate("localStorage.getItem('sk_src_choice')") == 'declined'); b.close()

    b, pg, _ = visit(p, 'required', storage={'sk_src_choice': 'granted'})
    ok('a returning visitor who agreed is not asked again, and the source is kept', not visible(pg, 'sourceChoice') and src_state(pg)['session'] is not None); b.close()
    b, pg, _ = visit(p, 'required', storage={'sk_src_choice': 'declined'})
    ok('a returning visitor who declined is not asked again, and nothing is kept', not visible(pg, 'sourceChoice') and src_state(pg)['session'] is None); b.close()

    print('a visitor who need not be asked (notice)')
    b, pg, _ = visit(p, 'notice')
    ok('no choice banner: just the ordinary notice', not visible(pg, 'sourceChoice') and visible(pg, 'consentBanner'))
    st = src_state(pg); ok('the source is kept and would be sent', st['session'] is not None and st['allowed'] is True and st['send']['utm']['source'] == 'instagram'); b.close()

    print('the safe defaults')
    b, pg, _ = visit(p, 'nonsense'); ok('an unreadable answer from the server is treated as "ask"', visible(pg, 'sourceChoice') and src_state(pg)['session'] is None); b.close()
    b = p.chromium.launch(); pg = b.new_page(viewport={'width': 390, 'height': 844}); pg.route('**/api/**', lambda r: r.abort()); pg.goto(URL); pg.wait_for_timeout(1800)
    ok('if the server cannot be reached, it asks rather than assumes', visible(pg, 'sourceChoice') and src_state(pg)['session'] is None); b.close()

    print('readability')
    b, pg, _ = visit(p, 'required')
    r = pg.evaluate("""(() => { const bn = document.getElementById('sourceChoice'); const bs = [...bn.querySelectorAll('button')].map(x => x.getBoundingClientRect()); const r = bn.getBoundingClientRect();
      return { fits: r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight, tall: bs.every(x => x.height >= 44), font: parseFloat(getComputedStyle(bn.querySelector('p')).fontSize), noScroll: document.documentElement.scrollWidth <= innerWidth } })()""")
    ok('the banner fits a 390 px phone, its buttons are at least 44 px tall, and the page does not scroll sideways', r['fits'] and r['tall'] and r['noScroll']); ok('its text is at least 13 px', r['font'] >= 13)
    pg.screenshot(path='/tmp/dk/consent_phone.png'); b.close()
print(f'\n{"all passing" if not fails else str(fails) + " FAILED"}'); sys.exit(1 if fails else 0)
