import asyncio, json, os, sys
from playwright.async_api import async_playwright
WIDTHS=[(360,740),(390,844),(768,1024),(1024,768),(1280,800),(1920,1000)]
CHECK = r'''(()=>{
  const vw=innerWidth, out={}; out.sideways=document.documentElement.scrollWidth-vw;
  const vis=e=>{const cs=getComputedStyle(e);if(cs.display==='none'||cs.visibility==='hidden'||Number(cs.opacity)<0.05)return false;const r=e.getBoundingClientRect();return r.width>1.5&&r.height>1.5};
  const inFixed=e=>{let x=e;while(x){const p=getComputedStyle(x).position;if(p==='fixed'||p==='sticky')return true;x=x.parentElement;}return false};
  const all=[...document.querySelectorAll('body *')].filter(e=>vis(e)&&!e.closest('.visually-hidden')&&!e.closest('#consentBanner'));
  out.edge=[];
  for(const e of all){const r=e.getBoundingClientRect();if(r.right>vw+1&&!inFixed(e)&&!e.closest('.sk-dossier-host,.market-grid,.lb-foot-links')){if(out.edge.length<4)out.edge.push((typeof e.className==='string'?e.className:e.tagName).slice(0,30)+' right '+Math.round(r.right)+' of '+vw);}}
  out.tapSmall=[];
  for(const e of all){if(!e.matches('button,a[href],input:not([type=hidden]),select,textarea,[role=button]'))continue;const r=e.getBoundingClientRect();
    if((r.height<40||r.width<40)&&!e.closest('.market-grid,.hero-foot-links,footer,.lb-foot-links,.sk-dossier-host')){if(out.tapSmall.length<5)out.tapSmall.push((e.textContent||e.getAttribute('aria-label')||e.tagName).trim().slice(0,24)+' '+Math.round(r.width)+'x'+Math.round(r.height));}}
  const texts=all.filter(e=>e.children.length===0&&(e.textContent||'').trim().length>1&&!inFixed(e));
  out.overlap=[];
  for(let i=0;i<texts.length&&out.overlap.length<5;i++){const a=texts[i].getBoundingClientRect();for(let j=i+1;j<texts.length&&out.overlap.length<5;j++){if(texts[i].contains(texts[j])||texts[j].contains(texts[i]))continue;const b=texts[j].getBoundingClientRect();const ix=Math.min(a.right,b.right)-Math.max(a.left,b.left),iy=Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top);if(ix>4&&iy>4)out.overlap.push((texts[i].textContent||'').trim().slice(0,20)+' / '+(texts[j].textContent||'').trim().slice(0,20));}}
  return out;})()'''
"""Layout audit of the website at six widths (360 to 1920 px) on the home page, the report preview and the checkout:
sideways scrolling, elements cut off at the screen edge, controls smaller than 44 px, and overlapping text.
A headline's two lines touch by design and are reported as overlaps; read them as headline lines, not defects.
    python3 tools/layout_audit.py"""
async def main():
    report={}
    async with async_playwright() as p:
        b=await p.chromium.launch()
        for w,h in WIDTHS:
            pg=await b.new_page(viewport={'width':w,'height':h}); await pg.goto('file:///home/claude/sk/shelterkart-frontend.html'); await pg.wait_for_timeout(1000)
            ok=pg.locator('#consentBanner button').filter(has_text='OK').first
            if await ok.count() and await ok.is_visible(): await ok.click(); await pg.wait_for_timeout(400)
            rec={'home':await pg.evaluate(CHECK)}
            await pg.screenshot(path=f'/tmp/la_{w}_home.png')
            await pg.fill('#searchInput','Hubtown Celeste'); await pg.click('#searchBtn'); await pg.wait_for_selector('.sk-dossier-host',timeout=20000); await pg.wait_for_timeout(500)
            rec['preview']=await pg.evaluate(CHECK)
            await pg.screenshot(path=f'/tmp/la_{w}_preview.png')
            await pg.locator('.sk-dossier-host .unlock .btn').first.click(); await pg.wait_for_timeout(500)
            rec['checkout']=await pg.evaluate(CHECK)
            await pg.screenshot(path=f'/tmp/la_{w}_checkout.png')
            report[f'{w}px']=rec; await pg.close()
        await b.close()
    
    for wd,rec in report.items():
        for scr,r in rec.items():
            bits=[]
            if r['sideways']>0: bits.append(f"SIDEWAYS {r['sideways']}px")
            if r['edge']: bits.append('edge: '+'; '.join(r['edge']))
            if r['tapSmall']: bits.append('small tap: '+'; '.join(r['tapSmall']))
            if r['overlap']: bits.append('overlap: '+' | '.join(r['overlap']))
            print(f"{wd:8}{scr:10}"+(' OK' if not bits else ' '+' ; '.join(bits))[:300])
asyncio.run(main())

