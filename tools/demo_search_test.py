#!/usr/bin/env python3
"""Demo search test: the candidate list grouped by country, the spelling suggestion, developer-and-area matching, a record's
details, the not-found answer, and that the Search button stays reachable while results are open.
The demo records are illustrative; the test checks how the search answers, not whether a project exists.
    python3 tools/demo_search_test.py"""
import asyncio, os, sys
from playwright.async_api import async_playwright
PAGE = 'file://' + os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'shelterkart-frontend.html'))
fails = 0
def ok(label, cond, detail=''):
    global fails
    if not cond: fails += 1
    print(('  ok   ' if cond else '  FAIL ') + label + ('' if cond else f'  ({detail})'))
async def search(pg, q):
    await pg.fill('#searchInput', q); await pg.click('#searchBtn'); await pg.wait_for_timeout(300)
    return await pg.inner_text('#suggest')
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); pg = await b.new_page(viewport={'width': 390, 'height': 844}); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)[:100]))
        await pg.goto(PAGE); await pg.wait_for_timeout(800)
        c = pg.locator('#consentBanner button').filter(has_text='OK').first
        if await c.count() and await c.is_visible(): await c.click()
        t = await search(pg, 'Sky Villas')
        ok('a name with several matches lists them, grouped by country, with counts',
           'INDIA · 2' in t.upper() and 'UNITED ARAB EMIRATES · 1' in t.upper() and 'UNITED KINGDOM · 1' in t.upper(), t[:160])
        ok('the list says the results are so far, and does not claim a full count', 'so far' in t.lower() or 'matches so far' in t.lower())
        ok('the best match is labelled', 'best match' in t.lower())
        ok('the Search button is reachable while results are open', await pg.is_enabled('#searchBtn') and await pg.is_visible('#searchBtn'))
        t = await search(pg, 'Sky Vilas')
        ok('a misspelling gets "Did you mean" with the correct name', 'Did you mean' in t and 'Sky Villas' in t, t[:120])
        t = await search(pg, 'Example Developers Worli')
        first = (await pg.locator('#suggest .suggest-item').first.inner_text()).strip()
        ok('developer plus area puts the matching project first', 'Green Park' in first and 'Worli' in first, first)
        t = await search(pg, 'Nowhere Tower')
        ok('an unknown name gets an honest "not in our records yet"', 'not have this project' in t.lower() or 'records yet' in t.lower(), t[:120])
        ok('an unknown name does not list a project', await pg.locator('#suggest .suggest-item').count() == 0)
        await search(pg, 'Sky Villas'); await pg.click('#suggest .suggest-item >> nth=1'); await pg.wait_for_timeout(200)
        rec = await pg.inner_text('#suggest')
        ok('a record shows its developer, locality, country, registration number and status',
           all(k in rec for k in ('Developer:', 'Locality:', 'Country:', 'Registration number:', 'Status:')), rec[:160])
        ok('a record says it is a demo record, with no full report', 'Demo record' in rec)
        ok('no script errors during the search', not errs, errs[:3])
        await b.close()
    print('\nall passing' if not fails else f'\n{fails} FAILED'); sys.exit(1 if fails else 0)
asyncio.run(main())
