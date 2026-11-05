#!/usr/bin/env python3
"""Drives the real marketing-desk screen in a browser: a careful reader approves a week, a rubber-stamper is stopped, veto and pause work,
and every visible text in every state is checked for size, contrast and fit on a phone and on a desktop. Needs playwright and node."""
import json, os, subprocess, sys, time, re
from playwright.sync_api import sync_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); OUT = '/tmp/social_ui'; os.makedirs(OUT, exist_ok=True)
passed = failed = 0
def ok(name, cond, detail=''):
    global passed, failed
    if cond: passed += 1; print('  ok   ' + name)
    else: failed += 1; print('  FAIL ' + name + ('\n       ' + str(detail)[:600] if detail else ''))
def start():
    srv = subprocess.Popen(['node', 'test/social/devserver.js'], cwd=os.path.join(ROOT, 'backend'), stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env={**os.environ, 'PORT': '0'})
    for _ in range(80):
        line = srv.stdout.readline()
        if line.startswith('READY '): return srv, line.split()[1]
        time.sleep(0.1)
    srv.kill(); print('the demo server did not start'); sys.exit(1)

AUDIT = """() => {
  const lum = c => { const [r,g,b] = c.map(v => { v/=255; return v<=0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055,2.4); }); return 0.2126*r+0.7152*g+0.0722*b; };
  const parse = s => { const m = s.match(/rgba?\\(([^)]+)\\)/); if (!m) return null; const p = m[1].split(',').map(x => parseFloat(x)); return { r:p[0], g:p[1], b:p[2], a: p.length>3 ? p[3] : 1 }; };
  const bgsOf = el => { for (let e = el; e; e = e.parentElement) { const cs = getComputedStyle(e), img = cs.backgroundImage; if (img && img.indexOf('gradient') >= 0) { const stops = (img.match(/rgba?\\([^)]+\\)/g) || []).map(parse).filter(Boolean).map(c => [c.r,c.g,c.b]); if (stops.length) return stops; } const c = parse(cs.backgroundColor); if (c && c.a > 0.95) return [[c.r,c.g,c.b]]; } return [[255,255,255]]; };
  const small = [], low = [], tap = [], over = [];
  const vw = document.documentElement.clientWidth;
  if (document.documentElement.scrollWidth > vw + 1) over.push('page scrolls sideways: ' + document.documentElement.scrollWidth + ' > ' + vw);
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  while (walker.nextNode()) {
    const n = walker.currentNode, t = n.textContent.trim(); if (!t) continue; const el = n.parentElement; if (!el || seen.has(el)) continue; seen.add(el);
    const cs = getComputedStyle(el), r = el.getBoundingClientRect(); if (cs.visibility === 'hidden' || cs.display === 'none' || r.width === 0 || r.height === 0) continue; if (el.closest('[hidden]') || el.closest('.sr')) continue;
    const size = parseFloat(cs.fontSize); if (size < 14) small.push(t.slice(0,40) + ' (' + size + 'px)');
    const fg = parse(cs.color); if (fg) { let worst = 99; for (const bg of bgsOf(el)) { const a = fg.a, mix = [fg.r*a+bg[0]*(1-a), fg.g*a+bg[1]*(1-a), fg.b*a+bg[2]*(1-a)]; const L1 = lum(mix), L2 = lum(bg), ratio = (Math.max(L1,L2)+0.05)/(Math.min(L1,L2)+0.05); worst = Math.min(worst, ratio); } const large = size >= 24 || (size >= 18.66 && parseInt(cs.fontWeight) >= 700); if (worst < (large ? 3 : 4.5)) low.push(t.slice(0,40) + ' (' + worst.toFixed(2) + ':1)'); }
    if (r.right > vw + 1 && !el.closest('.toast')) over.push('text runs off the right edge: ' + t.slice(0,40));
  }
  document.querySelectorAll('button, select, input:not([type=checkbox]), summary').forEach(e => { const r = e.getBoundingClientRect(), cs = getComputedStyle(e); if (cs.display === 'none' || r.width === 0 || e.closest('[hidden]')) return; if (r.height < 43.5) tap.push((e.textContent || e.id || e.tagName).trim().slice(0,30) + ' (' + Math.round(r.height) + 'px high)'); });
  document.querySelectorAll('input[type=checkbox]').forEach(e => { const r = e.getBoundingClientRect(); if (r.width && (r.width < 22 || r.height < 22)) tap.push('checkbox ' + Math.round(r.width) + 'px'); });
  return { small, low, tap, over };
}"""
def audit(page, label):
    r = page.evaluate(AUDIT)
    ok(f'{label}: every visible text is at least 14px', not r['small'], r['small'][:5])
    ok(f'{label}: every text has enough contrast (4.5:1, 3:1 for large)', not r['low'], r['low'][:5])
    ok(f'{label}: every button, field and summary is at least 44px high; checkboxes at least 22px', not r['tap'], r['tap'][:5])
    ok(f'{label}: nothing runs off the edge or scrolls sideways', not r['over'], r['over'][:5])

servers = []
try:
    with sync_playwright() as p:
        b = p.chromium.launch()
        for vp_name, vp in [('phone', {'width': 390, 'height': 844}), ('desktop', {'width': 1280, 'height': 900})]:
            print(vp_name); srv, url = start(); servers.append(srv)
            ctx = b.new_context(viewport=vp, device_scale_factor=1); page = ctx.new_page(); errors = []; bad = []
            page.on('console', lambda m: errors.append(m.text) if m.type == 'error' and '403' not in m.text and '409' not in m.text else None); page.on('pageerror', lambda e: errors.append(str(e)))
            page.on('response', lambda r: bad.append(f'{r.status} {r.url}') if r.status >= 500 else None)
            page.goto(url); page.wait_for_selector('#kpis .kpi'); page.wait_for_timeout(300)
            ok('the desk loads, shows dry-run mode and its status', 'Dry run' in page.inner_text('#mode') and page.locator('#kpis .kpi').count() == 7, page.inner_text('#mode'))
            ok('a dry-run banner explains that nothing is posted', 'dry-run' in page.inner_text('#banners').lower())
            audit(page, f'{vp_name} start')
            page.screenshot(path=f'{OUT}/{vp_name}-1-start.png', full_page=False)
            ok('the facts section shows the test base and says every fact needs a check (auto-verify is off)', 'verified facts' in page.inner_text('#kSummary') and 'auto-verify is off' in page.inner_text('#kSummary'), page.inner_text('#kSummary'))
            page.select_option('#kMarket', 'IN'); page.select_option('#kTopic', 't02'); page.fill('#kUrl', 'https://rera.example.gov/register'); page.click('#kAdd')
            page.wait_for_function("document.getElementById('kMsg').textContent.indexOf('Drafted') === 0", timeout=15000)
            ok('adding an official address makes the keeper read it and draft a fact for checking', 'Drafted 1 fact' in page.inner_text('#kMsg'), page.inner_text('#kMsg'))
            draft = page.locator('#kDrafts details.post'); draft.first.locator('summary').click()
            ok('the draft shows the fact, the exact words on the page, and the source', 'The words on the page' in draft.first.inner_text() and 'promoter must register the project' in draft.first.inner_text() and draft.first.locator('a').count() == 1, draft.first.inner_text()[:200])
            audit(page, f'{vp_name} facts'); page.screenshot(path=f'{OUT}/{vp_name}-0-facts.png')
            before = int(re.match(r'(\d+) verified', page.inner_text('#kSummary')).group(1)); draft.first.get_by_role('button', name='Verify this fact').click()
            page.wait_for_function("(n) => parseInt(document.getElementById('kSummary').textContent) === n + 1", arg=before, timeout=10000)
            ok('verifying the draft makes it a verified fact and clears the waiting list', page.locator('#kDrafts details.post').count() == 0 and 'Nothing is waiting' in page.inner_text('#kDrafts'))
            page.click('#plan'); page.wait_for_function("document.getElementById('job').textContent.startsWith('Planned')", timeout=60000)
            ok('planning a week drafts all 252 posts', 'Planned: 252 posts' in page.inner_text('#job'), page.inner_text('#job'))
            page.click('#build'); page.wait_for_selector('#pack .approve', timeout=30000); page.wait_for_timeout(200)
            ok('the pack opens with its summary and the sample to read', page.locator('#pack .kpi').count() == 5 and 'Read these first' in page.inner_text('#pack'))
            ok('Approve is disabled until the sample has been read', page.is_disabled('#approveBtn'))
            audit(page, f'{vp_name} pack')
            cards = page.locator('#pack details.post[data-id]'); n = cards.count(); ok('the sample covers every language and platform (more than 20 posts to read)', n > 20, n)
            # a careful reader: opens each sample post, reads it, leaves out the one that contains a mistake
            left_out = 0
            for i in range(n):
                c = cards.nth(i); c.locator('summary').click(); text = c.inner_text()
                if 'This developer is a scam' in text: c.get_by_label('Leave this post out of the approval').check(); left_out += 1
                else: c.get_by_label('I have read this post').check()
                if i == 1: page.screenshot(path=f'{OUT}/{vp_name}-2-post-open.png')
            ok('the reader found the post with the mistake and left it out', left_out == 1, left_out)
            page.wait_for_timeout(150); ok('with every sample post read or left out, Approve is enabled', not page.is_disabled('#approveBtn'), page.inner_text('#readCount'))
            ok('the count says how many posts will be approved (252 after leaving the bad one out)', page.inner_text('#approveN').strip() == '252', page.inner_text('#approveN'))
            audit(page, f'{vp_name} sample open')
            page.screenshot(path=f'{OUT}/{vp_name}-3-ready.png', full_page=False)
            page.fill('#pin', '0000'); page.click('#approveBtn'); page.wait_for_selector('.toast.bad:not([hidden])', timeout=10000)
            ok('a wrong PIN is refused with a clear message and approves nothing', 'PIN' in page.inner_text('#toast'), page.inner_text('#toast'))
            page.fill('#pin', '1234'); page.click('#approveBtn'); page.wait_for_function("document.getElementById('toast').textContent.indexOf('Approved') === 0", timeout=15000)
            ok('with the PIN the pack is approved: 252 posts', 'Approved 252 posts' in page.inner_text('#toast'), page.inner_text('#toast'))
            page.wait_for_timeout(500); page.screenshot(path=f'{OUT}/{vp_name}-4-approved.png', full_page=False)
            ok('the 24-hour queue lists the posts about to go out (those from Asia and the Gulf, from Sunday noon), each with a Veto button', page.locator('#queue li').count() >= 10 and page.locator('#queue button:has-text("Veto")').count() == page.locator('#queue li').count(), page.locator('#queue li').count())
            first = page.locator('#queue li').first.inner_text(); page.once('dialog', lambda d: d.accept()); page.locator('#queue button:has-text("Veto")').first.click(); page.wait_for_function("document.getElementById('toast').textContent.indexOf('Vetoed') === 0", timeout=10000)
            page.wait_for_function("(t) => document.querySelector('#queue li') && document.querySelector('#queue li').innerText !== t", arg=first, timeout=10000)
            ok('a veto removes that post from the queue', page.locator('#queue li').first.inner_text() != first)
            page.once('dialog', lambda d: d.accept()); page.click('#pauseAll'); page.wait_for_function("document.getElementById('pauseAll').textContent.indexOf('Resume') === 0", timeout=10000)
            ok('Pause everything pauses, says so in a banner, and the button becomes Resume', 'Everything is paused' in page.inner_text('#banners'))
            audit(page, f'{vp_name} paused'); page.screenshot(path=f'{OUT}/{vp_name}-5-paused.png', full_page=False)
            page.click('#pauseAll'); page.wait_for_function("document.getElementById('pauseAll').textContent.indexOf('Pause') === 0", timeout=10000)
            ok('Resume releases it', 'Everything is paused' not in page.inner_text('#banners'))
            page.select_option('#pScope', 'market'); page.select_option('#pKey', 'JP'); page.fill('#pWhy', 'checking a post'); page.click('#pDo'); page.wait_for_selector('#pauses li:has-text("market JP")', timeout=10000)
            ok('a market can be paused by itself, and shows in the list with a Resume button', page.locator('#pauses li:has-text("market JP") button:has-text("Resume")').count() == 1)
            page.select_option('#iKind', 'sensitivity'); page.select_option('#iKey', 'GB'); page.fill('#iWhy', 'a major disaster'); page.click('#iDo'); page.wait_for_selector('#pauses li:has-text("market GB")', timeout=10000)
            ok('reporting a disaster holds that market for 24 hours by itself', 'lifts' in page.locator('#pauses li:has-text("market GB")').inner_text())
            ok('the audit log shows the chain intact with the approval in it', 'intact' in page.inner_text('#auditState') and 'approval' in page.inner_text('#audit'))
            audit(page, f'{vp_name} end')
            ok('there were no script errors and no server errors', not errors and not bad, errors + bad)
            ctx.close()
        # the rubber-stamper: reads nothing special, ticks every sample post including the flawed one, and is stopped
        print('rubber stamp')
        srv, url = start(); servers.append(srv)
        ctx = b.new_context(viewport={'width': 390, 'height': 844}); page = ctx.new_page(); page.goto(url); page.wait_for_selector('#kpis .kpi')
        page.click('#plan'); page.wait_for_function("document.getElementById('job').textContent.startsWith('Planned')", timeout=60000)
        page.click('#build'); page.wait_for_selector('#pack .approve', timeout=30000); cards = page.locator('#pack details.post[data-id]')
        for i in range(cards.count()):
            cards.nth(i).locator('summary').click(); cards.nth(i).get_by_label('I have read this post').check()       # the tick is inside the post: it has to be opened to be ticked
        page.fill('#pin', '1234'); page.click('#approveBtn'); page.wait_for_selector('.toast.bad:not([hidden])', timeout=15000)
        ok('ticking every post as read, including the one with the mistake, is refused with a plain explanation', 'must be rejected' in page.inner_text('#toast'), page.inner_text('#toast'))
        page.wait_for_timeout(400); ok('nothing was approved and the pack is closed', page.locator('#pack').is_hidden())
        page.screenshot(path=f'{OUT}/phone-6-rubberstamp.png'); ctx.close(); b.close()
finally:
    for sv in servers: sv.kill()
print(f'\n{passed} passed, {failed} failed'); sys.exit(1 if failed else 0)
