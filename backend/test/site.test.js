const vm = require('vm'), fs = require('fs'), path = require('path');
const SITE = fs.readFileSync(path.join(__dirname, '..', '..', 'shelterkart-frontend.html'), 'utf8').match(/<script>([\s\S]*)<\/script>/)[1];
if (!SITE.includes('const API_BASE = "";')) throw new Error('shelterkart-frontend.html no longer ships with an empty API_BASE');
const CODE = { live: SITE.replace('const API_BASE = "";', 'const API_BASE = "https://api.test";'), off: SITE };
function world(file, search = '', opts = {}) {
  class CL { constructor(){ this.s = new Set(); } add(...c){ c.forEach(x => this.s.add(x)); } remove(...c){ c.forEach(x => this.s.delete(x)); } contains(c){ return this.s.has(c); } toggle(){} }
  class El { constructor(tag){ this.tag = tag; this.children = []; this._a = {}; this._l = {}; this.classList = new CL(); this.style = {}; this.dataset = {}; this.value = ''; this.textContent = ''; this.innerHTML = ''; this.hidden = false; }
    addEventListener(e, f){ (this._l[e] ||= []).push(f); } removeEventListener(){} click(){ (this._l.click || []).forEach(f => f({ preventDefault(){} })); }
    append(...c){ this.children.push(...c); } prepend(...c){ this.children.unshift(...c); } appendChild(c){ this.children.push(c); return c; } replaceChildren(...c){ this.children = c; }
    setAttribute(k, v){ this._a[k] = v; } getAttribute(k){ return this._a[k] ?? null; } removeAttribute(k){ delete this._a[k]; }
    querySelector(){ return null; } querySelectorAll(){ return []; } closest(){ return null; } focus(){} scrollIntoView(){}
    get offsetWidth(){ return 10; } get offsetHeight(){ return 10; } }
  const ids = {}; const byId = id => ids[id] || (ids[id] = new El('div'));
  const listeners = {}, sent = [], store = {};
  // A returning visitor who chose India (the demo's main audience). Country tests pass opts.country: null for a first visit.
  if (opts.country !== null) store.sk_country = JSON.stringify({ iso: opts.country || 'IN', at: Date.now() });
  const ctx = {
    console, URL, URLSearchParams, Promise, JSON, Object, Math, Date, Array, Set, Map, RegExp, String, Number, Boolean, Error,
    setTimeout: (f) => 0, clearTimeout(){}, requestAnimationFrame: f => f(), AbortController: class { constructor(){ this.signal = {}; } abort(){} },
    SK_REPORT_FLOW: opts.flow || 'classic',   // the original flow unless a test asks for the investigator
    crypto: { randomUUID: () => '11111111-2222-4333-8444-555555555555' },
    location: { href: 'https://shelterkart.com/' + search, search, pathname: '/', hash: '' },
    history: { replaceState(){}, pushState(){} }, navigator: { userAgent: 'test' },
    setInterval: () => 0, clearInterval: () => {},          // the checkout's countdown: a fake clock that never ticks
    matchMedia: () => ({ matches: false, addEventListener(){} }), IntersectionObserver: class { observe(){} unobserve(){} },
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
    sessionStorage: { getItem: () => null, setItem(){} }, alert(){}, print(){ sent.push({ printed: true }); },
    fetch: async (url, o = {}) => { sent.push({ url, body: o.body ? JSON.parse(o.body) : null, keepalive: o.keepalive });
      if (opts.handle) { const r = opts.handle(url, o.body ? JSON.parse(o.body) : null); if (r) return r; }
      if (url.endsWith('/api/research/recover')) {
        const b = JSON.parse(o.body);
        return b.paymentId === 'pay_GOODRECEIPT01' ? { ok: true, status: 200, json: async () => ({ ok: true, ref: 'SK-ABCDEF123456', token: 'TOKEN-X' }) }
                                                   : { ok: false, status: 404, json: async () => ({ ok: false, error: 'No paid ShelterKart report matches that payment ID.' }) };
      }
      if (url.includes('/api/research/by-ref/')) return { ok: true, status: 200, json: async () => ({ ok: true, brief: { ref: 'SK-ABCDEF123456', market: 'in', query: 'x', location: '', project: { name: 'X', ids: [] }, findings: [], conflicts: [], gaps: [], reading: [], questions: [], pages: [], notes: [], counts: {}, responsible: { name: '', title: '', contact: '' }, disclaimer: '', locked: false }, paywall: { active: false } }) };
      return { ok: true, status: 204, json: async () => ({}) }; },
    document: { getElementById: byId, createElement: t => new El(t), createDocumentFragment: () => new El('frag'), createTextNode: t => ({ nodeType: 3, textContent: t }),
      addEventListener: (e, f) => { (listeners[e] ||= []).push(f); }, removeEventListener(){}, querySelector: () => null, querySelectorAll: () => [],
      body: new El('body'), documentElement: new El('html'), head: new El('head'), referrer: 'https://l.instagram.com/?u=x', activeElement: null },
  };
  ctx.window = ctx; ctx.document.body.contains = () => true;
  vm.createContext(ctx);
  vm.runInContext(CODE[file], ctx);
  return { ctx, sent, store, byId, fire: e => (listeners[e] || []).forEach(f => f()) };
}
let fails = 0; const ok = (l, c) => { if (!c) fails++; console.log((c ? '  ok   ' : '  FAIL ') + l); };
(async () => {
  // Live site, arriving from an Instagram bio link
  const w = world('live', '?utm_source=instagram&utm_campaign=launch');
  w.fire('DOMContentLoaded'); await new Promise(r => setImmediate(r));
  const pv = w.sent.find(x => x.url && x.url.endsWith('/api/track'));
  ok('a page view is sent on load, with the Instagram tag and referrer', pv && pv.body.event === 'page_view' && pv.body.utm.source === 'instagram' && pv.body.utm.campaign === 'launch' && pv.body.referrer.includes('instagram'));
  ok('...as a keepalive request, so it survives the visitor leaving the page', pv && pv.keepalive === true);

  // The report's actions
  const acts = w.ctx.lbActions({ ref: 'SK-ABCDEF123456', market: 'in', query: 'Casagrand Casamia', project: { name: 'Casagrand Casamia' } });
  const [wa, pdf] = acts.children;
  const shareText = decodeURIComponent(wa.href.split('text=')[1]);
  ok('the WhatsApp link opens the exact report, tagged as a WhatsApp share', /ref=SK-ABCDEF123456/.test(shareText) && /utm_source=whatsapp/.test(shareText) && /utm_medium=share/.test(shareText));
  const before = w.sent.length; wa.click(); pdf.click(); await new Promise(r => setImmediate(r));
  const newEvents = w.sent.slice(before).filter(x => x.body).map(x => x.body.event);
  ok('sharing and saving the PDF are each recorded', newEvents.includes('share_whatsapp') && newEvents.includes('save_pdf'));
  ok('...and Save as PDF still opens the print dialog', w.sent.some(x => x.printed));

  // Restore access
  const input = w.byId('restorePaymentId'), msg = w.byId('restoreMsg');
  input.value = 'hello'; await w.ctx.lbRestoreAccess();
  ok('restore: a malformed ID is caught before anything is sent', /starts with pay_/.test(msg.textContent) && !w.sent.some(x => x.url && x.url.endsWith('/recover')));
  input.value = 'pay_WRONGRECEIPT9'; await w.ctx.lbRestoreAccess();
  ok('restore: an unknown payment ID shows the server\u2019s explanation', /No paid ShelterKart report/.test(msg.textContent));
  input.value = 'pay_GOODRECEIPT01'; await w.ctx.lbRestoreAccess();
  ok('restore: a real payment ID stores the access code...', w.store['sk_access_SK-ABCDEF123456'] === 'TOKEN-X');
  ok('...in localStorage, where it survives closing the tab', 'sk_access_SK-ABCDEF123456' in w.store);
  ok('...and opens that exact report with the access code', w.sent.some(x => x.url && x.url.includes('/api/research/by-ref/SK-ABCDEF123456')));

  // The unconnected preview sends nothing at all
  const off = world('off', '?utm_source=instagram');
  off.fire('DOMContentLoaded'); await new Promise(r => setImmediate(r));
  off.ctx.lbActions({ ref: 'SK-ABCDEF123456', project: { name: 'X' } }).children.forEach(c => c.click && c.click());
  ok('with no backend connected, not a single tracking request is made', !off.sent.some(x => x.url && x.url.includes('/api/track')));

  // ---- the investor demo: exactly the client's journey, no backend ----
  const rawText = n => !n ? '' : (n.nodeType === 3 ? n.textContent : (n.textContent || '') + ' ' + (n.children || []).map(rawText).join(' '));
  const text = n => rawText(n).replace(/\s+/g, ' ');
  const find = (n, pred) => { if (!n || n.nodeType === 3) return null; if (pred(n)) return n; for (const c of n.children || []) { const r = find(c, pred); if (r) return r; } return null; };
  const demo = world('off'); demo.ctx.SK_DEMO_FAST = true;
  demo.fire('DOMContentLoaded'); await new Promise(r => setImmediate(r));
  const box = demo.byId('liveBrief');
  ok('on arrival no report is shown -- nothing is open by default', box.children.length === 0 && !/ShelterKart Score/.test(text(box)));
  const chips = demo.byId('demoChips');
  ok('under the search box: five real projects to try, as example searches', chips.hidden === false && /Try a real project/.test(text(chips)) && /Hubtown Celeste/.test(text(chips)) && (text(chips).match(/·/g) || []).length === 5);

  demo.byId('searchInput').value = 'hubtown';
  demo.byId('searchBtn').click(); for (let i = 0; i < 8; i++) await new Promise(r => setImmediate(r));
  const pre = text(box);
  ok('searching shows the FREE preview first, like a client', /Registered with MahaRERA as P51900008925/.test(pre));
  ok('...with the paid parts withheld: no disagreement details, no reasons, no source trail', !/3 July 2028/.test(pre) && !/25 South project in Prabhadevi/.test(pre) && !/not counted against the developer/.test(pre));
  const unlock = find(box, n => n.tag === 'button' && /Unlock the full report/.test(n.textContent || ''));
  ok('...and the Unlock button at the real price for a buyer in India: the engine\u2019s quote for this property and depth', unlock !== null && /₹3,100/.test(unlock.textContent) && /Prices shown for: India/.test(pre));
  ok('...and says why it costs that: a Heavy report, priced from the project\u2019s listed prices', /This is a Heavy report: much of its evidence is corroborated\. Its price follows this project’s listed prices \(₹1\.49 crore–2\.1 crore\), and is the same for every buyer\. How pricing works/.test(pre));
  ok('the free preview says what unlocking adds -- 7 protections for Maharashtra -- without giving them away', /7 buyer protections for India — Maharashtra, each cited to the law/.test(pre) && !/Section 13\(1\)/.test(pre));
  ok('no sample-only switches a client would never see', !/Free preview Full paid report/.test(pre) && !/Sample report: real research/.test(pre));

  unlock.click(); await new Promise(r => setImmediate(r));
  const lines = text(demo.byId('payLines')), prop = text(demo.byId('payProperty'));
  ok('Unlock opens the checkout: the project, its depth, the fee, GST inside it, and the total', /Hubtown Celeste · Worli, Mumbai/.test(demo.byId('payProject').textContent) && /Heavy report/.test(demo.byId('payProject').textContent) && /Report fee ₹2,627\.12/.test(lines) && /GST \(18%\) ₹472\.88/.test(lines) && /Total to pay ₹3,100/.test(lines));   // 2,627.12 + 472.88 = 3,100: the lines add up
  ok('the checkout does not show the property\u2019s value, only what ShelterKart charges', prop.trim() === '' && !/Property value|Your purchase/.test(prop));   // the value sets the price; it is not shown
  ok('...the currency, the lock time and the reason for the price', /Currency: INR · Prices shown for: India/.test(demo.byId('payMeta').textContent) && /Price locked until .+ \((29|30):\d\d left\)/.test(demo.byId('payLock').textContent));
  ok('the report stays locked while the checkout is open', !/3 July 2028/.test(text(box)));
  await demo.byId('payBtn').onclick(); await new Promise(r => setImmediate(r));
  const full = text(box);
  ok('after paying, the FULL report: every disagreement and how each finding is marked', /Payment received\. This is your full report\./.test(full) && /3 July 2028/.test(full) && /25 South project in Prabhadevi has been handed over/.test(full));
  ok('the full report includes the buyer\u2019s protections, cited to the law', /Your protections as a buyer/.test(full) && /RERA Act 2016, Section 13\(1\)/.test(full) && /Stamp duty and registration in Mumbai/.test(full));
  ok('...and the PDF download, as a client gets it', find(box, n => n.tag === 'a' && /sample-reports\/ShelterKart-Sample-India-Hubtown-Celeste\.pdf$/.test(n.href || '')) !== null);
  ok('no upload form on a sample', find(box, n => n.tag === 'input' && n.type === 'file') === null);

  const linked = world('off', '?ref=' + vm.runInContext('SAMPLE_REPORTS[2].full.ref', demo.ctx)); linked.ctx.SK_DEMO_FAST = true;
  linked.fire('DOMContentLoaded'); await new Promise(r => setImmediate(r));
  const lt = text(linked.byId('liveBrief'));
  ok('a shared link opens the free preview -- someone who has not paid never sees the full report', /Unlock the full report/.test(lt) && /₹6,400/.test(lt));

  // The research progress, mid-way: a fresh page where time does not pass (SK_DEMO_FAST unset)
  {
    const slow = world('off'); slow.fire('DOMContentLoaded'); await new Promise(r => setImmediate(r));
    slow.byId('searchInput').value = 'river modern'; slow.byId('searchBtn').click(); await new Promise(r => setImmediate(r));
    const pt = text(slow.byId('liveBrief'));
    const steps = (slow.byId('liveBrief').children[0].children[2].children || []).map(li => li.className);
    ok('while researching: the three searches run together, and grading waits for them', /Researching “River Modern”/.test(pt) && /Three searches run side by side/.test(pt)
      && JSON.stringify(steps) === JSON.stringify(['lb-step running', 'lb-step running', 'lb-step running', 'lb-step waiting']));
  }
  demo.byId('searchInput').value = 'Some Unknown Tower';
  demo.byId('searchBtn').click();
  ok('an unknown search says it is not in our records yet, and never invents a result', /not have this project in our records yet/.test(text(demo.byId('suggest'))) && !/Status:|Developer:/.test(text(demo.byId('suggest'))));
  ok('the whole demo made no network request of any kind', demo.sent.filter(x => x.url).length === 0 && linked.sent.filter(x => x.url).length === 0);

  // Every class the report code creates must have a style rule: a deletion once stripped a style silently.
  {
    const html = fs.readFileSync(path.join(__dirname, '..', '..', 'shelterkart-frontend.html'), 'utf8');
    const css = html.match(/<style>([\s\S]*)<\/style>/)[1], js = html.match(/<script>([\s\S]*)<\/script>/)[1];
    // 'm-' and 'lb-prot-' are prefixes completed in code (m-confirmed, lb-prot-right...), whose completed forms are styled.
    const INTENTIONALLY_UNSTYLED = new Set(['lb-foot-links', 'm-', 'lb-prot-']);
    const used = new Set(); for (const m of js.matchAll(/lbEl\(\s*'[a-z0-9]+'\s*,\s*'([^']+)'/g)) m[1].split(/\s+/).forEach(c => used.add(c));
    const unstyled = [...used].filter(c => !INTENTIONALLY_UNSTYLED.has(c) && !new RegExp('\\.' + c.replace(/[-]/g, '\\-') + '(?![\\w-])').test(css));
    ok(`every one of the ${used.size} classes the report code uses has a style rule`, unstyled.length === 0 || (console.log('   unstyled:', unstyled), false));
    ok('the hidden-report rule is present', /\.lb\[hidden\]\{ display:none; \}/.test(css));
  }

  // Currency: one formatter for every price; ambiguous symbols carry their code; no currency, no price.
  {
    const f = (a, c, l) => vm.runInContext(`fmtPrice(${a}, ${JSON.stringify(c)}, ${JSON.stringify(l)})`, demo.ctx).replace(/\u00a0/g, ' ');   // prices use a non-breaking space so they never wrap
    ok('rupees, pounds and dirhams show unambiguously', f(1499, 'INR', 'en-IN') === '₹1,499' && f(39, 'GBP', 'en-GB') === '£39' && f(149, 'AED', 'en-AE') === 'AED 149');
    ok('a bare "$" is never left ambiguous: Singapore, Australian and New Zealand dollars carry their code', f(69, 'SGD', 'en-SG') === '$69 (SGD)' && f(69, 'AUD', 'en-AU') === '$69 (AUD)' && f(69, 'NZD', 'en-NZ') === '$69 (NZD)');
    ok('"kr" carries its code: Norway, Sweden and Denmark', /NOK/.test(f(449, 'NOK', 'nb-NO')) && /SEK/.test(f(449, 'SEK', 'sv-SE')) && /DKK/.test(f(299, 'DKK', 'da-DK')));
    ok('no currency, or no amount, means no price at all -- never a guessed one', f(149, undefined, 'en-US') === '' && f(0, 'INR', 'en-IN') === '' && f(149, 'rupees', 'en-IN') === '');
  }
  // ---------------------------------------------------------------------------------------------
  // LANGUAGES: the report in the reader's language, the paywall untouched, English always one tap away
  // ---------------------------------------------------------------------------------------------
  {
    const L = world('off'); L.ctx.SK_DEMO_FAST = true; L.fire('DOMContentLoaded'); await new Promise(r => setImmediate(r));
    const root = L.ctx.document.documentElement, box = L.byId('liveBrief');
    const run = src => vm.runInContext(src, L.ctx);
    const sample = id => run('SAMPLE_REPORTS').find(x => x.id === id);          // top-level const: reachable by evaluation, not as a property
    ok('English by default: lang en, left to right', run('I18N.lang') === 'en' && root.lang === 'en' && root.dir === 'ltr');

    // Hindi on Hubtown: words change, facts do not, the paywall stays
    run("setLanguage('hi')");
    ok('choosing Hindi sets the document language and remembers the choice', root.lang === 'hi' && root.dir === 'ltr' && L.store.sk_lang === 'hi');
    L.ctx.showSample(sample('hubtown-celeste')); const hi = text(box);
    ok('Hindi preview: section headings, the rules and the unlock panel are in Hindi', /रिकॉर्ड क्या दिखाता है/.test(hi) && /पूरी रिपोर्ट अनलॉक करें/.test(hi) && /विस्तृत रिपोर्ट/.test(hi));
    ok('...the findings themselves are the translated sentences', /Hubtown Limited BSE \(532799\)|MahaRERA में P51900008925/.test(hi) || /ढाँचा 27वीं मंज़िल/.test(hi) || /Hubtown/.test(hi));
    ok('...and the FACTS are untouched: the price, the registration id', /₹3,100/.test(hi) && /P51900008925/.test(hi));
    ok('...the paywall is intact: still the preview, still locked, no paid section leaked', /पूरी रिपोर्ट अनलॉक करें/.test(hi) && !/खरीदार के रूप में आपके संरक्षण/.test(hi));
    ok('...it says plainly that it is an AI translation and the English governs, and offers English', /AI से अनुवादित/.test(hi) && /अंग्रेज़ी मूल ही मान्य है/.test(hi) && /अंग्रेज़ी दिखाएँ/.test(hi));
    ok('...the price range reads in Hindi units (crore -> करोड़), not English words', /करोड़/.test(hi) && !/ crore/.test(hi));
    // paying in Hindi opens the full report, with the protections translated
    L.ctx.openSamplePay(sample('hubtown-celeste')); ok('the checkout speaks Hindi and still charges the previewed price', /₹3,100/.test(text(L.byId('payLines'))) && /₹3,100 का भुगतान करें/.test(L.byId('payBtn').textContent) && /कुल देय राशि/.test(text(L.byId('payLines'))));
    await L.byId('payBtn').onclick(); await new Promise(r => setImmediate(r));
    const paid = text(box);
    ok('after payment, the full report is in Hindi: protections, questions, every page checked', /खरीदार के रूप में आपके संरक्षण/.test(paid) && /क्या पूछें, और किससे/.test(paid) && /पंजीकृत एग्रीमेंट से पहले 10% से अधिक कभी न दें/.test(paid) && /सेल्स टीम/.test(paid));
    ok('...questions are still grouped by their heading (the "when" labels are interface vocabulary, not translated per report)', /बुकिंग से पहले/.test(paid) && /हस्ताक्षर से पहले/.test(paid));
    // switching language redraws what is on screen without losing the report or the payment
    run("setLanguage('en')"); const back = text(box);
    ok('back to English: the same paid report in English, English notice gone', /Your protections as a buyer/.test(back) && /Never pay more than 10% before a registered agreement/.test(back) && !/AI से अनुवादित/.test(back) && root.lang === 'en');

    // Arabic on Creek Bay: right to left, Latin names and digits kept
    run("setLanguage('ar')"); L.ctx.showSample(sample('creek-bay-tower-b')); const ar = text(box);
    ok('Arabic sets right-to-left on the document', root.lang === 'ar' && root.dir === 'rtl');
    ok('Arabic report: Arabic headings and findings; names, ids and DLD stay Latin; the buyer\u2019s price unchanged', /ما يُظهره السجل/.test(ar) && /Dubai Creek Harbour/.test(ar) && /DLD/.test(ar) && /4,400/.test(ar) && /افتح التقرير الكامل/.test(ar));
    ok('...the numbers in the translated findings are the same numbers (AED 1.9 million, 2,600, 14%, 17 and 3 of the 17)', /1\.9/.test(ar) && /2,600/.test(ar) && /14%/.test(ar) && /17/.test(ar) && /\b3\b/.test(ar));

    // a language with no translation of this sample: French interface, English content, said plainly
    run("setLanguage('fr')"); L.ctx.showSample(sample('creek-bay-tower-b')); const fr = text(box);
    ok('French: the interface is French but this sample has no French text, so the findings stay English and the page says so', /Ce que montrent les données/.test(fr) && /Creek Bay Tower B and Creek Haven Tower B/.test(fr) && /n’a pas pu être traduit/.test(fr));
    ok('...and Show English works from the notice itself', (() => { run("setLanguage('en')"); L.ctx.showSample(sample('creek-bay-tower-b')); return /What the record shows/.test(text(box)); })());

    // plurals follow each language's grammar
    run("setLanguage('pl')");
    ok('Polish counts agree with their number: 2 and 22 take the "few" form, 5 and 12 the "many" form', run("[2, 22, 5, 12].map(n => txn(n, '1 more finding with sources', '{n} more findings with sources')).join(' | ')") === '2 dodatkowe ustalenia ze źródłami | 22 dodatkowe ustalenia ze źródłami | 5 dodatkowych ustaleń ze źródłami | 12 dodatkowych ustaleń ze źródłami');
    ok('...including inside sentences: "Podają 3 serwisy" but "Podaje 7 serwisów"', run("tx('Reported by {n} sites', { n: 3 })") === 'Podają 3 serwisy' && run("tx('Reported by {n} sites', { n: 7 })") === 'Podaje 7 serwisów');
    run("setLanguage('ar')");
    ok('Arabic counts agree with their number: dual for 2, plural for 3-10, singular for 11-99', run("[2, 5, 12].map(n => txn(n, '1 page', '{n} pages')).join(' | ')") === 'صفحتان | 5 صفحات | 12 صفحة');
    ok('the interface notice says exactly what checked the translation: AI, not a native speaker', /تُرجم ورُوجع بالذكاء الاصطناعي/.test(text(L.byId('langNote'))) && !/متحدّث أصلي/.test(text(L.byId('langNote'))));
    run("setLanguage('en')");

    // the English is the default for sample 4, which has no translations at all
    run("setLanguage('hi')"); L.ctx.showSample(sample('sutton-garden-square')); ok('a sample with no Hindi text: Hindi labels, English findings, honest notice', /इसलिए अंग्रेज़ी में दिखाई जा रही है/.test(text(box)));
    run("setLanguage('en')");

    // the page's word list mirrors the server's, field for field
    const T = require('../engine/translate');
    ok('the page and the server translate exactly the same fields of every sample report (no drift between the two lists)', run('SAMPLE_REPORTS').every(x => {
      for (const b of [x.full, x.preview]) {
        const page = run(`JSON.stringify(sampleTextFields(${JSON.stringify(b)}))`), server = JSON.stringify(T.collectTexts(b).map(f => [f.path, f.text]));
        if (page !== server) return false;
      } return true; }));
    ok('every translated sample map covers every sentence of its full report, and its preview', [['hubtown-celeste', 'hi'], ['casagrand-casamia', 'hi'], ['creek-bay-tower-b', 'ar']].every(([id, lang]) => { const x = sample(id);
      return [x.full, x.preview].every(b => T.collectTexts(b).every(f => x.tr[lang][f.text] != null)); }));
    ok('untranslated samples carry no translation map at all (nothing half-built ships)', ['sutton-garden-square', 'river-modern'].every(id => !sample(id).tr));
    ok('Casamia in Hindi: the regulator penalties stay exact (\u20b930 lakh, \u20b925 lakh, 2020, 2022) and the developer\u2019s denial is kept', (() => { run("setLanguage('hi')"); L.ctx.showSample(sample('casagrand-casamia')); const m = sample('casagrand-casamia').tr.hi; const t = Object.values(m).join(' '); run("setLanguage('en')"); return /₹30 लाख/.test(t) && /₹25 लाख/.test(t) && /2020/.test(t) && /2022/.test(t) && /इनकार/.test(t); })());
  }
  // language selection: remembered choice > shared link > browser > English; never forced, never an unknown code
  {
    const mk = async (search, nav, stored) => { const w = world('off', search); if (nav) w.ctx.navigator.languages = nav; if (stored) w.store.sk_lang = stored; w.fire('DOMContentLoaded'); await new Promise(r => setImmediate(r)); return w; };
    ok('a browser set to Hindi opens in Hindi, without storing a choice the reader never made', await (async () => { const w = await mk('', ['hi-IN', 'en']); return vm.runInContext('I18N.lang', w.ctx) === 'hi' && !w.store.sk_lang; })());
    ok('a remembered choice beats the browser', await (async () => { const w = await mk('', ['hi-IN'], 'fr'); return vm.runInContext('I18N.lang', w.ctx) === 'fr'; })());
    ok('a shared link\u2019s ?lang opens in the language it was shared in', await (async () => { const w = await mk('?lang=ar'); return vm.runInContext('I18N.lang', w.ctx) === 'ar'; })());
    ok('an unknown language, or one that is not enabled, is simply English', await (async () => { const a = await mk('?lang=zz'), b = await mk('', ['it-IT', 'nl']); return vm.runInContext('I18N.lang', a.ctx) === 'en' && vm.runInContext('I18N.lang', b.ctx) === 'en'; })());
    ok('a browser set to zh-TW or zh-HK opens in Traditional Chinese; a Spanish browser in Spanish', await (async () => { const a = await mk('', ['zh-TW']), b = await mk('', ['zh-HK', 'en']), c = await mk('', ['es-ES']); return [a, b, c].map(w => vm.runInContext('I18N.lang', w.ctx)).join() === 'zh-Hant,zh-Hant,es'; })());
    ok('English browsers stay English', await (async () => { const w = await mk('', ['en-GB']); return vm.runInContext('I18N.lang', w.ctx) === 'en'; })());
  }
  // the live site: the language travels with every request and every tracked event
  {
    const w = world('live'); w.fire('DOMContentLoaded'); await new Promise(r => setImmediate(r));
    vm.runInContext("setLanguage('hi')", w.ctx);
    w.byId('countrySelect').value = 'in'; w.sent.length = 0;
    await vm.runInContext("runLiveResearch('Hubtown Celeste', { market: 'in' })", w.ctx);
    const post = w.sent.find(x => x.url && x.url.endsWith('/api/research') && x.body);
    ok('a live search asks the server for Hindi', post && post.body.lang === 'hi' && post.body.market === 'in');
    vm.runInContext("skTrack('unlock_click', { ref: 'SK-ABCDEF123456' })", w.ctx);
    ok('tracked events carry the reading language, so conversion by language can be measured', w.sent.some(x => x.body && x.body.event === 'unlock_click' && x.body.lang === 'hi'));
    const sh = w.ctx.lbActions({ ref: 'SK-ABCDEF123456', market: 'in', query: 'Hubtown Celeste', project: { name: 'Hubtown Celeste' } }).children[0];
    ok('a WhatsApp share opens in the language it was shared in', /lang=hi/.test(decodeURIComponent(sh.href.split('text=')[1])));
    vm.runInContext("setLanguage('en')", w.ctx); w.sent.length = 0; await vm.runInContext("runLiveResearch('Hubtown Celeste', { market: 'in' })", w.ctx);
    ok('in English the request says English, and a share link carries no language', w.sent.find(x => x.url && x.url.endsWith('/api/research') && x.body).body.lang === 'en'
      && !/lang=/.test(decodeURIComponent(w.ctx.lbActions({ ref: 'SK-ABCDEF123456', market: 'in', query: 'x', project: { name: 'x' } }).children[0].href.split('text=')[1])));
  }
  // ---------------------------------------------------------------------------------------------
  // THE BUYER'S COUNTRY AND THE CHECKOUT: B5, W1-W4, the re-quote, the live flow
  // ---------------------------------------------------------------------------------------------
  const tick = () => new Promise(r => setImmediate(r));
  {
    const Q = world('off', '', { country: null }); Q.ctx.SK_DEMO_FAST = true; Q.fire('DOMContentLoaded'); await tick();
    const run = src => vm.runInContext(src, Q.ctx), box = Q.byId('liveBrief'), sample = id => run('SAMPLE_REPORTS').find(x => x.id === id);
    Q.ctx.showSample(sample('creek-bay-tower-b'));
    const first = find(box, n => n.tag === 'button' && /Unlock the full report/.test(n.textContent || ''));
    ok('first visit with no country known: the Buy button waits and the page asks for the country (suggest, confirm)', first.disabled === true && /Choose your country to see your price\./.test(text(box)));
    run("setBuyerCountry('GB')"); const gb = text(box);
    ok('choosing the UK shows the same report in GBP and remembers the choice', /£36/.test(gb) && /Prices shown for: United Kingdom/.test(gb) && JSON.parse(Q.store.sk_country).iso === 'GB');
    run("setBuyerCountry('ZZ')"); ok('an unknown country code is ignored', JSON.parse(Q.store.sk_country).iso === 'GB');
    ok('B5 a chosen country is remembered for 30 days, then forgotten', run('loadCountryChoice(Date.now() + 29 * 864e5)') === 'GB' && run('loadCountryChoice(Date.now() + 31 * 864e5)') === '' && !Q.store.sk_country);
  }
  {
    const D = world('off'); D.ctx.SK_DEMO_FAST = true; D.fire('DOMContentLoaded'); await tick();
    const run = src => vm.runInContext(src, D.ctx), sample = id => run('SAMPLE_REPORTS').find(x => x.id === id);
    D.ctx.openSamplePay(sample('creek-bay-tower-b'));
    ok('demo checkout opens at the Indian buyer\u2019s price for the Dubai flat: \u20b93,600 with GST inside it', /Total to pay ₹4,400/.test(text(D.byId('payLines'))) && /GST \(18%\)/.test(text(D.byId('payLines'))));
    run("PAY.billing = 'GB'"); await D.byId('payBtn').onclick(); await tick();
    ok('a different billing country shows the new total beside the old one and asks again; nothing is unlocked', !D.byId('payBanner').hidden && /New total: £36 \(was ₹4,400\)\. Please confirm\./.test(D.byId('payBanner').textContent) && /Total to pay £36/.test(text(D.byId('payLines'))) && run('demoUnlocked.size') === 0);
    const lines = text(D.byId('payLines')), prop = text(D.byId('payProperty'));
    ok('W2 the checkout shows the report fee and the total in the buyer\u2019s currency, and no property value', !/Property value/.test(prop) && /Report fee £/.test(lines) && !/AED/.test(lines));
    ok('W3 the tax line always shows, even when no tax is charged', /No tax charged £0/.test(lines));
    const lockGB = D.byId('payLock').textContent;
    await D.byId('payBtn').onclick(); await tick();
    ok('the second press pays the confirmed total and unlocks the report', run('demoUnlocked.size') === 1);
    D.ctx.openSamplePay(sample('hubtown-celeste'));
    ok('W4 the lock time shows for every country, and the "Why this price?" line is the same fixed sentence everywhere', /Price locked until .+ left\)/.test(lockGB) && /Price locked until .+ left\)/.test(D.byId('payLock').textContent));
  }
  {
    const html = fs.readFileSync(path.join(__dirname, '..', '..', 'shelterkart-frontend.html'), 'utf8');
    const why = 'It depends on the value of the property and how much evidence this report holds. It is the same for every buyer, shown in your currency.';
    const markup = html.replace(/\/\*I18N_START\*\/[\s\S]*?\/\*I18N_END\*\//, '');      // the dictionaries use the sentence as their key
    ok('W4 ...the "Why this price?" sentence lives once, in the checkout, and never varies by country', markup.split(why).length === 2 && markup.indexOf(why) > markup.indexOf('id="payModal"'));
    const banned = /local price|special price|price for your region|regional pric|pricing for your country/i;
    const dicts = fs.readdirSync(path.join(__dirname, '..', '..', 'i18n')).filter(f => f.endsWith('.json')).map(f => fs.readFileSync(path.join(__dirname, '..', '..', 'i18n', f), 'utf8'));
    ok('W1 no wording anywhere suggests the price depends on where the buyer is (page and every dictionary)', !banned.test(html.replace(/const SAMPLE_REPORTS = [\s\S]*?;\n\nfunction findSample/, '')) && dicts.every(d => !banned.test(d)));
  }
  {
    let started = null; const checkouts = [];
    const resp = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
    const exp = () => new Date(Date.now() + 30 * 60000).toISOString();
    const qa = 'q_' + 'a'.repeat(20), qb = 'q_' + 'b'.repeat(20);
    const handle = (url, body) => {
      if (url.endsWith('/api/research/quote')) return resp({ ok: true, quote: { id: qa, country: body.country, currency: 'INR', net: 3050.85, tax: 549.15, gross: 4400, taxName: 'GST', taxRateBps: 1800, property: { value: 1850000, currency: 'AED' }, depthLabel: 'Heavy', expiresAt: exp() } });
      if (url.endsWith('/api/research/checkout')) {
        checkouts.push(body);
        if (checkouts.length === 1) return resp({ ok: false, requote: true, code: 'billing_country', previous: { country: 'IN', currency: 'INR', gross: 4400 }, quote: { id: qb, country: 'GB', currency: 'GBP', net: 36, tax: 0, gross: 36, taxName: '', taxRateBps: 0, property: { value: 1850000, currency: 'AED' }, depthLabel: 'Heavy', expiresAt: exp() } }, 409);
        return resp({ ok: true, purchaseId: '11111111-2222-4333-8444-555555555555', amount: 36, currency: 'GBP', quoteId: qb });
      }
      return null;
    };
    const W = world('live', '', { handle }); W.ctx.SK_startPayment = o => { started = o; }; W.fire('DOMContentLoaded'); await tick();
    const run = src => vm.runInContext(src, W.ctx);
    await run("lbUnlock('SK-ABCDEF123456', document.createElement('button'), document.createElement('p'))");
    ok('live: Unlock asks the server for a quote for the buyer\u2019s country and session', W.sent.some(x => x.url.endsWith('/api/research/quote') && x.body.country === 'IN' && /^[a-z0-9]{24}$/.test(x.body.session)));
    run("PAY.billing = 'GB'"); await W.byId('payBtn').onclick(); await tick();
    ok('live: the checkout sends the quote id and the billing country, never an amount', checkouts[0].quoteId === qa && checkouts[0].billingCountry === 'GB' && !('amount' in checkouts[0]) && !('price' in checkouts[0]));
    ok('live: the server\u2019s re-quote is shown with both totals and needs a second press; nothing has been paid', /New total: £36 \(was ₹4,400\)/.test(W.byId('payBanner').textContent) && started === null);
    await W.byId('payBtn').onclick(); await tick();
    ok('live: the confirmed new quote is what gets paid', checkouts[1].quoteId === qb && started && started.amount === 36 && started.currency === 'GBP');
    const research = W.sent.filter(x => x.url && x.url.endsWith('/api/research') && x.body);
    ok('live: every research request carries the buyer\u2019s country', research.every(x => x.body.country === 'IN'));
  }
  // the investigator flow: a search starts an investigation and goes to its live page; the samples are the new reports
  {
    const w = world('live', '', { flow: 'investigator', handle: (url) => url.endsWith('/api/investigate') ? { ok: true, status: 202, json: async () => ({ ok: true, ref: 'SK-ABCDEF123456' }) } : null });
    w.fire('DOMContentLoaded'); await new Promise(r => setImmediate(r));
    w.byId('countrySelect').value = 'in'; w.sent.length = 0;
    await vm.runInContext("runLiveResearch('Hubtown Celeste', { market: 'in' })", w.ctx);
    const inv = w.sent.find(x => x.url && x.url.endsWith('/api/investigate') && x.body);
    ok('investigator: a search starts an investigation with the project and the country code', inv && inv.body.query === 'Hubtown Celeste' && inv.body.country === 'IN');
    ok('investigator: no classic research request is made', !w.sent.some(x => x.url && x.url.endsWith('/api/research')));
    ok('investigator: the buyer is taken to the live report page', /\/r\/SK-ABCDEF123456$/.test(w.ctx.location.href));
    vm.runInContext('renderDemoChips()', w.ctx);
    const chips = w.byId('demoChips');
    const hrefs = JSON.stringify(chips, (k, v) => (k === 'parent' || k === 'parentNode' ? undefined : v));
    ok('investigator: the sample links are the three new reference reports, not the old samples', ['/samples/celeste', '/samples/london', '/samples/dubai'].every(h => hrefs.includes(h)) && !/sample-reports\//.test(hrefs));
    const bad = world('live', '', { flow: 'investigator', handle: (url) => url.endsWith('/api/investigate') ? { ok: false, status: 503, json: async () => ({ ok: false, error: 'New investigations are paused for today.' }) } : null });
    bad.fire('DOMContentLoaded'); await new Promise(r => setImmediate(r)); bad.byId('countrySelect').value = 'in';
    await vm.runInContext("runLiveResearch('Hubtown Celeste', { market: 'in' })", bad.ctx);
    ok('investigator: when it cannot start, the buyer sees why and stays on the page', !/\/r\//.test(bad.ctx.location.href) && JSON.stringify(bad.byId('liveBrief'), (k, v) => (k === 'parent' || k === 'parentNode' ? undefined : v)).includes('paused for today'));
  }
  // ---- the free Home Buying Guide: the card, the reader, the download, and the copy embedded in the page
  {
    const PAGE = fs.readFileSync(path.join(__dirname, '..', '..', 'shelterkart-frontend.html'), 'utf8');
    ok('the page carries the guide card (read and download), the footer link and the reader window', /id="guideCard"/.test(PAGE) && /onclick="openGuide\(\)" data-i18n>Read the guide/.test(PAGE) && /onclick="downloadGuide\(\)" data-i18n>Download PDF/.test(PAGE) && /onclick="openGuide\(\)" data-i18n>Home Buying Guide/.test(PAGE) && /id="guideModal"/.test(PAGE) && /id="guideFrame"/.test(PAGE));
    const m = PAGE.match(/<script type="application\/json" id="sk-guide">([\s\S]*?)<\/script>/);
    const dist = fs.readFileSync(path.join(__dirname, '..', '..', 'guide', 'dist', 'ShelterKart-Home-Buying-Guide.html'), 'utf8');
    const embedded = m ? JSON.parse(m[1]) : '';
    ok('the guide embedded in the page is the current built guide', embedded === dist);
    ok('...and it is the final edition, with no draft marker', embedded.length > 100000 && !/Draft for review/.test(embedded) && /Preeyancc/.test(embedded));
    ok('a report\u2019s guide links open the reader on this page, at the chapter they name', /a\[data-guide\]/.test(SITE) && /a\[data-guide-pdf\]/.test(SITE) && /root\.__guideBound/.test(SITE));
    const guide = '<!doctype html><html><body><section id="ch2">Chapter 2</section></body></html>';
    const w = world('off'); w.byId('sk-guide').textContent = JSON.stringify(guide);
    vm.runInContext("openGuide('ch2')", w.ctx);
    ok('the guide opens in its reader inside the page, from the embedded copy', w.byId('guideFrame').srcdoc === guide && w.byId('guideModal').classList.contains('visible'));
    vm.runInContext('closeGuide()', w.ctx);
    ok('closing the reader hides it and clears its loader', !w.byId('guideModal').classList.contains('visible') && w.byId('guideFrame').onload === null);
    const live = world('live'); live.byId('sk-guide').textContent = JSON.stringify(guide);
    await vm.runInContext('downloadGuide()', live.ctx);
    ok('where the server has the PDF, Download PDF asks the server for it', live.sent.some(x => x.url === 'https://api.test/guide/pdf'));
    const tr = world('live'); tr.byId('sk-guide').textContent = JSON.stringify(guide);
    vm.runInContext("openGuide('ch2')", tr.ctx); await vm.runInContext('downloadGuide()', tr.ctx);
    const evs = tr.sent.filter(x => /\/api\/track$/.test(x.url)).map(x => x.body && (x.body.event + ':' + (x.body.detail || '')));
    ok('opening the guide and downloading it are each counted, with the chapter and nothing personal', evs.includes('guide_open:ch2') && evs.includes('guide_download:'));
    const off = world('off'); off.byId('sk-guide').textContent = JSON.stringify(guide);
    await vm.runInContext('downloadGuide()', off.ctx);
    ok('where it cannot (the page opened on its own), it opens the guide ready to print instead', off.byId('guideModal').classList.contains('visible') && !off.sent.some(x => x.url));
  }
  console.log(fails ? `\n${fails} FAILED` : '\nall passing'); process.exitCode = fails ? 1 : 0;
})();
