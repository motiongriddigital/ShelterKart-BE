#!/usr/bin/env python3
"""Readability sweep of the whole website: every visible text, in every state a visitor reaches (the home page, the search
results, the report preview, the checkout, the guide reader, every window, and Arabic), against its own background.
4.5:1 for normal text, 3:1 for large text. Run after any change to colours or layout.
    python3 tools/readability_sweep.py"""
import asyncio, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from playwright.async_api import async_playwright
from search_readability import LOW, LOW_ANY   # the same measurement; LOW_ANY also reaches into the report preview's shadow root
PAGE = 'file://' + os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'shelterkart-frontend.html'))
WINDOWS = ['tncModal','privacyModal','principlesModal','restoreModal','methodModal','disputeModal','replyModal','guideModal']
fails = 0
def ok(label, bad):
    global fails
    if bad: fails += 1
    print(('  ok   ' if not bad else '  FAIL ') + label + ('' if not bad else ': ' + '; '.join(bad[:2])))
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await b.new_page(viewport={'width': 390, 'height': 844}); await pg.goto(PAGE); await pg.wait_for_timeout(800)
        c = pg.locator('#consentBanner button').filter(has_text='OK').first
        if await c.count() and await c.is_visible(): await c.click()
        ok('home page', await pg.evaluate(LOW, 'body'))
        await pg.fill('#searchInput', 'Sky Villas'); await pg.click('#searchBtn'); await pg.wait_for_timeout(300)
        ok('search results', await pg.evaluate(LOW, '#suggest'))
        await pg.click('#suggest .suggest-item >> nth=1'); await pg.wait_for_timeout(200)
        ok('record in the results', await pg.evaluate(LOW, '#suggest'))
        await pg.fill('#searchInput', 'Hubtown Celeste'); await pg.click('#searchBtn'); await pg.wait_for_selector('.sk-dossier-host', timeout=20000); await pg.wait_for_timeout(400)
        ok('report preview', await pg.evaluate(f"({LOW_ANY})(document.querySelector('.sk-dossier-host').shadowRoot)"))
        await pg.locator('.sk-dossier-host .unlock .btn').first.click(); await pg.wait_for_timeout(400)
        ok('checkout', await pg.evaluate(LOW, '#payModal'))
        await pg.evaluate("closeModal('payModal')"); await pg.wait_for_timeout(150)
        for w in WINDOWS:
            await pg.evaluate(f"openModal('{w}')"); await pg.wait_for_timeout(250)
            ok(f'window: {w}', await pg.evaluate(LOW, '#' + w))
            await pg.evaluate(f"closeModal('{w}')"); await pg.wait_for_timeout(120)
        await pg.close()
        ar = await b.new_page(viewport={'width': 390, 'height': 844}); await ar.goto(PAGE); await ar.wait_for_timeout(800)
        c = ar.locator('#consentBanner button').filter(has_text='OK').first
        if await c.count() and await c.is_visible(): await c.click()
        await ar.evaluate("setLanguage('ar')"); await ar.wait_for_timeout(300)
        ok('home page, Arabic', await ar.evaluate(LOW, 'body'))
        await ar.close(); await b.close()
    print('\nall passing' if not fails else f'\n{fails} area(s) below the readability standard'); sys.exit(1 if fails else 0)
asyncio.run(main())
