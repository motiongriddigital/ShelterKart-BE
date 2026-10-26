#!/usr/bin/env python3
"""Readability of every state the search can show: the home search box, the results list, a spelling suggestion, a record,
and every microphone state (first use, listening, a blocked microphone with its recovery, the confirmation, and no speech
support). Each visible text is checked against its own background: 4.5:1 for normal text, 3:1 for large text.
The browser's speech and microphone are replaced by stand-ins, so each state can be reached on any machine.
    python3 tools/search_readability.py"""
import asyncio, os, sys
from playwright.async_api import async_playwright
PAGE = 'file://' + os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'shelterkart-frontend.html'))
SHOT = '/tmp/readability'
os.makedirs(SHOT, exist_ok=True)
LOW = r'''(sel)=>{const root=document.querySelector(sel); if(!root) return ['missing '+sel];
 const L=c=>{const m=c.match(/\d+(\.\d+)?/g);if(!m)return null;const [r,g,b]=m.slice(0,3).map(Number);return {r,g,b,a:m.length>3?Number(m[3]):1}};
 const lum=({r,g,b})=>{const f=v=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4)};return 0.2126*f(r)+0.7152*f(g)+0.0722*f(b)};
 const gradMean=img=>{const cols=[...img.matchAll(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/g)].map(m=>[+m[1],+m[2],+m[3]]);if(!cols.length)return null;const n=cols.length;return {r:cols.reduce((a,c)=>a+c[0],0)/n,g:cols.reduce((a,c)=>a+c[1],0)/n,b:cols.reduce((a,c)=>a+c[2],0)/n,a:1};};
 const bgOf=el=>{let e=el;while(e){const cs=getComputedStyle(e);if(cs.backgroundImage&&cs.backgroundImage!=='none'&&!/url\(/.test(cs.backgroundImage)){const g=gradMean(cs.backgroundImage);if(g)return g;}const c=L(cs.backgroundColor);if(c&&c.a>0.5)return c;e=e.parentElement;}return {r:255,g:255,b:255,a:1}};
 const out=[]; const w=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
 while(w.nextNode()){const n=w.currentNode,t=n.textContent.trim();if(t.length<2)continue;const el=n.parentElement;if(!el)continue;const r=el.getBoundingClientRect();if(r.width<2||r.height<2)continue;
  const cs=getComputedStyle(el); if(cs.visibility==='hidden'||cs.display==='none'||Number(cs.opacity)<0.2) continue;
  const fg=L(cs.color); if(!fg) continue; const bg=bgOf(el), a=fg.a, mx={r:fg.r*a+bg.r*(1-a),g:fg.g*a+bg.g*(1-a),b:fg.b*a+bg.b*(1-a)};
  const l1=lum(mx),l2=lum(bg),cr=(Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05);
  const s=parseFloat(cs.fontSize),big=s>=24||(Number(cs.fontWeight)>=600&&s>=18.66);
  if(cr<(big?3:4.5)) out.push(t.slice(0,36)+' '+cr.toFixed(2)+' ('+cs.color+' on '+'rgb('+bg.r+','+bg.g+','+bg.b+'))');}
 return out;}'''
# the same measurement, also for an element or a shadow root passed in directly (the report preview lives in one)
LOW_ANY = LOW.replace('const root=document.querySelector(sel);', 'const root=(sel&&sel.nodeType)?sel:document.querySelector(sel);')
NO_SPEECH = "Object.defineProperty(window,'SpeechRecognition',{value:undefined,configurable:true}); Object.defineProperty(window,'webkitSpeechRecognition',{value:undefined,configurable:true});"
STAND = """window.__transcript='Sky Villas Pune';
class FakeRec{constructor(){}start(){this.onstart&&this.onstart();setTimeout(()=>{this.onresult&&this.onresult({results:[[{transcript:window.__transcript}]]});this.onend&&this.onend();},400);}stop(){this.onend&&this.onend();}}
window.SpeechRecognition=FakeRec; window.webkitSpeechRecognition=FakeRec;"""
DENIED = "Object.defineProperty(navigator,'mediaDevices',{value:{getUserMedia:()=>Promise.reject(Object.assign(new Error('denied'),{name:'NotAllowedError'}))},configurable:true});"
GRANTED = "Object.defineProperty(navigator,'mediaDevices',{value:{getUserMedia:()=>Promise.resolve({getTracks:()=>[{stop(){}}]})},configurable:true});"
fails = 0; report = []
async def fresh(b, init=''):
    pg = await b.new_page(viewport={'width': 390, 'height': 844})
    if init: await pg.add_init_script(init)
    await pg.goto(PAGE); await pg.wait_for_timeout(700)
    c = pg.locator('#consentBanner button').filter(has_text='OK').first
    if await c.count() and await c.is_visible(): await c.click()
    await pg.evaluate("document.querySelector('.search-card').scrollIntoView({block:'center'})"); await pg.wait_for_timeout(150)
    return pg
async def check(pg, name, roots):
    bad = []
    for r in roots: bad += await pg.evaluate(LOW, r)
    global fails
    if bad: fails += 1
    print(('  ok   ' if not bad else '  FAIL ') + name + ('' if not bad else ': ' + '; '.join(bad[:3])))
    await pg.screenshot(path=f"{SHOT}/{name.replace(' ', '_').replace(':', '').replace('(', '').replace(')', '')[:60]}.png")
async def main():
    global fails
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await fresh(b); await check(pg, 'home search box', ['.search-card']); await pg.close()
        pg = await fresh(b); await pg.fill('#searchInput', 'Nowhere Tower'); await pg.click('#searchBtn'); await pg.wait_for_timeout(300)
        await check(pg, 'results: not found', ['#suggest']); await pg.close()
        pg = await fresh(b); await pg.fill('#searchInput', 'Sky Villas'); await pg.click('#searchBtn'); await pg.wait_for_timeout(300)
        await check(pg, 'results: several matches', ['#suggest']); await pg.close()
        pg = await fresh(b); await pg.fill('#searchInput', 'Sky Vilas'); await pg.click('#searchBtn'); await pg.wait_for_timeout(300)
        await check(pg, 'results: spelling suggestion', ['#suggest']); await pg.close()
        pg = await fresh(b); await pg.fill('#searchInput', 'Sky Villas'); await pg.click('#searchBtn'); await pg.wait_for_timeout(300)
        await pg.click('#suggest .suggest-item >> nth=1'); await pg.wait_for_timeout(200)
        await check(pg, 'results: record details', ['#suggest']); await pg.close()
        pg = await fresh(b, NO_SPEECH); await pg.click('#micBtn'); await pg.wait_for_timeout(200)
        await check(pg, 'voice: no speech support', ['#voiceConfirm']); await pg.close()
        pg = await fresh(b, STAND + GRANTED); await pg.click('#micBtn'); await pg.wait_for_timeout(200)
        await check(pg, 'voice: first use, allow microphone', ['#voiceConfirm']); await pg.close()
        pg = await fresh(b, STAND + GRANTED); await pg.click('#micBtn'); await pg.wait_for_timeout(200); await pg.click('#voiceConfirm .voice-yes'); await pg.wait_for_timeout(120)
        await check(pg, 'voice: listening', ['#voiceConfirm']); await pg.wait_for_timeout(700)
        await check(pg, 'voice: confirm what was heard', ['#voiceConfirm']); await pg.close()
        pg = await fresh(b, STAND + DENIED); await pg.click('#micBtn'); await pg.wait_for_timeout(200); await pg.click('#voiceConfirm .voice-yes'); await pg.wait_for_timeout(300)
        await check(pg, 'voice: microphone blocked, recovery on the page', ['#voiceConfirm']); await pg.close()
        await b.close()
    print('\nall passing' if not fails else f'\n{fails} state(s) below the readability standard'); sys.exit(1 if fails else 0)
if __name__ == "__main__":
    asyncio.run(main())
