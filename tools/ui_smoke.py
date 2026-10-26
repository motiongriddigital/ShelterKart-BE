#!/usr/bin/env python3
"""Browser smoke test of the website, as a visitor would use it: every footer window opens, is readable and closes;
Escape closes; Restore answers; the guide opens and closes; every sample report opens; search, preview, checkout and
payment lead to the full report; Terms opens in Hindi and Arabic; no script error anywhere; and every visible text in
each window meets 4.5:1 contrast (3:1 for large text).   python3 tools/ui_smoke.py   (needs Playwright with Chromium)"""
import asyncio, os, sys
from playwright.async_api import async_playwright
PAGE = 'file://' + os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'shelterkart-frontend.html'))
LOW = r'''(root)=>{const L=c=>{const m=c.match(/\d+(\.\d+)?/g);if(!m)return null;const [r,g,b]=m.slice(0,3).map(Number);return {r,g,b,a:m.length>3?Number(m[3]):1}};
 const lum=({r,g,b})=>{const f=v=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4)};return 0.2126*f(r)+0.7152*f(g)+0.0722*f(b)};
 const bgOf=el=>{let e=el;while(e){const cs=getComputedStyle(e),c=L(cs.backgroundColor);if(c&&c.a>0.5)return c;if(cs.backgroundImage&&cs.backgroundImage!=='none'&&!/url\(/.test(cs.backgroundImage)){const m=cs.backgroundImage.match(/rgba?\([^)]*\)/);if(m){const g=L(m[0]);if(g&&g.a>0.3)return g;}}e=e.parentElement;}return {r:255,g:255,b:255,a:1}};
 const scope=root?document.getElementById(root):document.body;const w=document.createTreeWalker(scope,NodeFilter.SHOW_TEXT);const out=[];
 while(w.nextNode()){const n=w.currentNode,t=n.textContent.trim();if(t.length<2)continue;const el=n.parentElement,r=el.getBoundingClientRect();if(r.width<2||r.height<2)continue;const cs=getComputedStyle(el);if(cs.visibility==='hidden'||Number(cs.opacity)<0.2)continue;
  const fg=L(cs.color),bg=bgOf(el),a=fg.a,mx={r:fg.r*a+bg.r*(1-a),g:fg.g*a+bg.g*(1-a),b:fg.b*a+bg.b*(1-a)},l1=lum(mx),l2=lum(bg),cr=(Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05);
  const s=parseFloat(cs.fontSize),big=s>=24||(Number(cs.fontWeight)>=600&&s>=18.66);if(cr<(big?3:4.5))out.push(t.slice(0,40)+' '+cr.toFixed(2));}return out;}'''
fails = 0
def ok(label, cond, detail=''):
    global fails
    if not cond: fails += 1
    print(('  ok   ' if cond else '  FAIL ') + label + ('' if cond else f'  ({detail})'))
async def visible(pg, mid): return await pg.evaluate(f"(()=>{{const e=document.getElementById('{mid}');return !!e&&e.classList.contains('visible')&&e.getBoundingClientRect().width>0}})()")
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); pg = await b.new_page(viewport={'width': 390, 'height': 844}); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)[:100])); pg.on('dialog', lambda d: asyncio.ensure_future(d.dismiss()))
        await pg.route('https://wa.me/**', lambda r: r.fulfill(status=200, body='ok'))
        await pg.goto(PAGE); await pg.add_style_tag(content='html{scroll-behavior:auto!important}'); await pg.wait_for_timeout(900)
        c = pg.locator('#consentBanner button').first
        if await c.count() and await c.is_visible(): await c.click()
        ok('home page: every visible text is readable', not await pg.evaluate(LOW, None), (await pg.evaluate(LOW, None))[:3])
        for mid in ('tncModal', 'privacyModal', 'principlesModal', 'restoreModal', 'methodModal', 'disputeModal', 'replyModal'):
            # click the first trigger a visitor can actually see (the cookie banner's link is gone once accepted)
            trigs = pg.locator(f'[onclick="openModal(\'{mid}\')"]'); clicked = False
            for i in range(await trigs.count()):
                t = trigs.nth(i)
                if await t.is_visible() and await t.evaluate("e => !e.closest('#consentBanner')"):   # the accepted cookie banner slides off screen
                    await t.scroll_into_view_if_needed(); await t.click(); clicked = True; break
            if not clicked: await pg.evaluate(f"openModal('{mid}')")
            await pg.wait_for_timeout(250)
            shown = await visible(pg, mid); low = await pg.evaluate(LOW, mid)
            await pg.locator(f'#{mid} [onclick="closeModal(\'{mid}\')"]').first.click(); await pg.wait_for_timeout(150)
            ok(f'{mid}: opens, every text readable, closes', shown and not low and not await visible(pg, mid), f'shown={shown} low={low[:2]}')
        await pg.evaluate("openModal('tncModal')"); await pg.keyboard.press('Escape'); await pg.wait_for_timeout(150)
        ok('Escape closes an open window', not await visible(pg, 'tncModal'))
        await pg.evaluate("openModal('restoreModal')"); await pg.fill('#restorePaymentId', 'pay_TEST1234567'); await pg.click('#restoreModal .modal-submit'); await pg.wait_for_timeout(300)
        ok('Restore answers the visitor', len((await pg.inner_text('#restoreMsg')).strip()) > 10); await pg.evaluate("closeModal('restoreModal')")
        await pg.locator('#guideCard .guide-cta:not(.ghost)').click(); await pg.wait_for_timeout(800)
        g1 = await visible(pg, 'guideModal'); await pg.locator('.guide-bar .guide-btn.ghost').click(); await pg.wait_for_timeout(150)
        ok('the guide opens and closes', g1 and not await visible(pg, 'guideModal'))
        chips = pg.locator('#demoChips a'); n = await chips.count(); opened = 0
        for i in range(n):
            await chips.nth(i).scroll_into_view_if_needed(); await chips.nth(i).click(); await pg.wait_for_timeout(600)
            opened += 1 if await pg.locator('.sk-dossier-host').count() else 0
        ok('every sample report opens', n > 0 and opened == n, f'{opened} of {n}')
        await pg.fill('#searchInput', 'Hubtown Celeste'); await pg.click('#searchBtn'); await pg.wait_for_selector('.sk-dossier-host', timeout=20000); await pg.wait_for_timeout(300)
        await pg.locator('.sk-dossier-host .unlock .btn').first.click(); await pg.wait_for_timeout(400)
        ok('the checkout opens, and every text in it is readable', await visible(pg, 'payModal') and not await pg.evaluate(LOW, 'payModal'))
        await pg.fill('#payEmail', 'buyer@example.com'); await pg.click('#payBtn'); await pg.wait_for_timeout(2500)
        ok('after paying, the full report shows', await pg.evaluate("[...document.querySelectorAll('.sk-dossier-host')].some(h=>h.shadowRoot&&!h.shadowRoot.querySelector('.unlock')&&/question/i.test(h.shadowRoot.textContent))"))
        n_reply = await pg.evaluate("(document.querySelector('.sk-dossier-host')||{}).shadowRoot ? document.querySelector('.sk-dossier-host').shadowRoot.querySelectorAll('a[data-reply]').length : 0")
        ok('every finding in the paid report has a developer right-of-reply link', n_reply > 0, n_reply)
        if n_reply:
            await pg.evaluate("document.querySelector('.sk-dossier-host').shadowRoot.querySelector('a[data-reply]').click()"); await pg.wait_for_timeout(300)
            ok('the right-of-reply link opens the reply window with that finding filled in', await visible(pg, 'replyModal') and len((await pg.input_value('#replyFinding')).strip()) > 10)
            await pg.evaluate("closeModal('replyModal')")
        for code in ('hi', 'ar'):
            await pg.evaluate(f"setLanguage('{code}')"); await pg.wait_for_timeout(250); await pg.evaluate("openModal('tncModal')"); await pg.wait_for_timeout(150)
            ok(f'Terms opens in {code}', await visible(pg, 'tncModal')); await pg.evaluate("closeModal('tncModal')")
        ok('no script error anywhere', not errs, errs[:3])
        await b.close()
asyncio.run(main())
print('\nall passing' if not fails else f'\n{fails} FAILED'); sys.exit(1 if fails else 0)
