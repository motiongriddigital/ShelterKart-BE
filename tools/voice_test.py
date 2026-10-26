#!/usr/bin/env python3
"""Voice search test. The browser's speech recognition is replaced by a stand-in, so the page's own behaviour is what is tested:
the microphone shows only where speech is supported; a heard name is shown back and searched only when the buyer confirms it;
the heard text is plain text (never markup); long input is capped; a failed hearing returns the buyer to typing.
    python3 tools/voice_test.py"""
import asyncio, os, sys
from playwright.async_api import async_playwright
PAGE = 'file://' + os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'shelterkart-frontend.html'))
STANDIN = """
window.__transcript = 'Sky Villas Pune'; window.__fail = false; window.__injected = false;
class FakeRec {
  constructor(){ this.lang = ''; }
  start(){ this.onstart && this.onstart();
    setTimeout(() => {
      if (window.__fail) { this.onerror && this.onerror({ error: 'no-speech' }); }
      else { this.onresult && this.onresult({ results: [[{ transcript: window.__transcript }]] }); }
      this.onend && this.onend(); }, 30); }
  stop(){ this.onend && this.onend(); }
}
window.SpeechRecognition = FakeRec; window.webkitSpeechRecognition = FakeRec;
Object.defineProperty(navigator,"mediaDevices",{value:{getUserMedia:()=>Promise.resolve({getTracks:()=>[{stop(){}}]})},configurable:true});
"""
DENIED = "Object.defineProperty(navigator,'mediaDevices',{value:{getUserMedia:()=>Promise.reject(Object.assign(new Error('denied'),{name:'NotAllowedError'}))},configurable:true});"
NO_SPEECH = "Object.defineProperty(window,'SpeechRecognition',{value:undefined,configurable:true}); Object.defineProperty(window,'webkitSpeechRecognition',{value:undefined,configurable:true});"
fails = 0
def ok(label, cond, detail=''):
    global fails
    if not cond: fails += 1
    print(('  ok   ' if cond else '  FAIL ') + label + ('' if cond else f'  ({detail})'))
async def new_page(b, init):
    pg = await b.new_page(viewport={'width': 390, 'height': 844}); await pg.add_init_script(init)
    await pg.goto(PAGE); await pg.wait_for_timeout(700)
    c = pg.locator('#consentBanner button').filter(has_text='OK').first
    if await c.count() and await c.is_visible(): await c.click()
    return pg
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await new_page(b, STANDIN)
        ok('the microphone is shown where speech is supported', await pg.is_visible('#micBtn'))
        await pg.evaluate("window.__injected=false")
        await pg.click('#micBtn'); await pg.wait_for_timeout(150)
        ok('the first click asks the buyer to allow the microphone, on the page', 'Allow microphone' in await pg.inner_text('#voiceConfirm'))
        await pg.click('#voiceConfirm .voice-yes'); await pg.wait_for_timeout(250)
        panel = await pg.inner_text('#voiceConfirm')
        ok('what is heard is shown back as a question', 'Sky Villas Pune' in panel and 'Did you mean' in panel, panel[:80])
        ok('nothing is searched before the buyer confirms', await pg.input_value('#searchInput') == '' and not await pg.locator('.sk-dossier-host').count())
        await pg.click('.voice-yes'); await pg.wait_for_timeout(400)
        ok('confirming fills the search and runs it', await pg.input_value('#searchInput') == 'Sky Villas Pune')
        await pg.close()
        # edit path: the heard text goes into the box, nothing runs
        pg = await new_page(b, STANDIN)
        await pg.click('#micBtn'); await pg.wait_for_timeout(150); await pg.click('#voiceConfirm .voice-yes'); await pg.wait_for_timeout(250); await pg.click('.voice-edit'); await pg.wait_for_timeout(150)
        ok('Edit puts the heard text in the box without searching', await pg.input_value('#searchInput') == 'Sky Villas Pune' and await pg.is_hidden('#voiceConfirm'))
        await pg.close()
        # markup in speech is shown as text, never executed or parsed
        pg = await new_page(b, STANDIN + "window.__transcript = '<img src=x onerror=\"window.__injected=true\">Sky Villas';")
        await pg.click('#micBtn'); await pg.wait_for_timeout(150); await pg.click('#voiceConfirm .voice-yes'); await pg.wait_for_timeout(250)
        ok('speech containing markup is shown as plain text', 'onerror' in (await pg.inner_text('#voiceConfirm')) and not await pg.locator('#voiceConfirm img').count())
        ok('speech containing markup is never executed', await pg.evaluate('window.__injected') is False)
        await pg.close()
        # long speech is capped
        pg = await new_page(b, STANDIN + "window.__transcript = 'A'.repeat(500);")
        await pg.click('#micBtn'); await pg.wait_for_timeout(150); await pg.click('#voiceConfirm .voice-yes'); await pg.wait_for_timeout(250)
        await pg.click('.voice-yes'); await pg.wait_for_timeout(200)
        ok('a very long spoken search is capped in length', len(await pg.input_value('#searchInput')) <= 120)
        await pg.close()
        # failure returns the buyer to typing
        pg = await new_page(b, STANDIN + "window.__fail = true;")
        await pg.click('#micBtn'); await pg.wait_for_timeout(150); await pg.click('#voiceConfirm .voice-yes'); await pg.wait_for_timeout(250)
        msg = await pg.inner_text('#voiceConfirm')
        ok('when hearing fails, the buyer is told the specific reason', 'no speech was heard' in msg.lower(), msg[:80])
        ok('the search box is still usable', await pg.is_enabled('#searchInput'))
        await pg.close()
        pg = await new_page(b, STANDIN + DENIED)
        await pg.click('#micBtn'); await pg.wait_for_timeout(150); await pg.click('#voiceConfirm .voice-yes'); await pg.wait_for_timeout(250)
        blocked = await pg.inner_text('#voiceConfirm')
        ok('a blocked microphone is explained, with Try again and Type instead, on the page', 'Try again' in blocked and 'Type instead' in blocked and 'lock icon' in blocked, blocked[:80])
        await pg.close()
        # no speech support: the microphone stays hidden, typing still works
        pg = await new_page(b, NO_SPEECH)
        ok('without speech support the microphone is still shown, so the buyer can see why it cannot be used', await pg.is_visible('#micBtn'))
        await pg.click('#micBtn'); await pg.wait_for_timeout(150)
        ok('without speech support the buyer is told which browsers work, and can type', 'Chrome' in (await pg.inner_text('#voiceConfirm')) and await pg.is_enabled('#searchInput'))
        await pg.close()
        await b.close()
    print('\nall passing' if not fails else f'\n{fails} FAILED'); sys.exit(1 if fails else 0)
asyncio.run(main())
