import sys, asyncio
from playwright.async_api import async_playwright
async def main(src, out, footer):
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await b.new_page()
        await pg.goto('file://' + src, wait_until='networkidle')
        await pg.pdf(path=out, format='A4', print_background=True, margin={'top':'16mm','bottom':'18mm','left':'16mm','right':'16mm'},
                     display_header_footer=True, header_template='<span></span>',
                     footer_template='<div style="font:8px sans-serif;color:#52657F;width:100%;padding:0 16mm;display:flex;justify-content:space-between"><span>' + footer + '</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>')
        await b.close()
asyncio.run(main(sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else 'ShelterKart. Research, not advice.'))
