const vm = require('vm'), fs = require('fs');
const path = require('path');
const A = require(path.join(__dirname, '..', 'engine', 'analytics.js'));
const html = fs.readFileSync(path.join(__dirname, '..', '..', 'admin.html'), 'utf8');
const script = html.match(/<script>([\s\S]*)<\/script>/)[1].replace('const API_BASE = "";', 'const API_BASE = "https://api.test";');

// 30 days of plausible traffic, aggregated by the REAL function
const now = new Date(); const rows = [];
const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const chans = [['instagram', 'instagram', 'launch'], ['whatsapp', 'whatsapp', ''], ['google', '', ''], ['direct', '', '']];
for (let i = 29; i >= 0; i--) {
  const day = new Date(now.getTime() - i * 86400000).toISOString().slice(0, 10), at = day + 'T10:00:00.000Z';
  const n = rnd(40, 90) + (29 - i) * 3;
  for (let v = 0; v < n; v++) {
    const [ch, src, camp] = chans[v % 7 < 3 ? 0 : v % 7 < 5 ? 1 : v % 7 < 6 ? 2 : 3];
    const vis = day + '-' + v;
    const lang = v % 9 === 0 ? 'ar' : v % 4 === 0 ? 'hi' : 'en';
    rows.push({ at, day, event: 'page_view', visitor: vis, lang, channel: ch, referrer: ch === 'google' ? 'google.com' : '', utm_source: src, utm_campaign: camp,
      country: v % 9 === 0 ? 'AE' : v % 11 === 0 ? 'GB' : 'IN', device: v % 5 === 0 ? 'desktop' : 'mobile' });
    if (v % 3 === 0) rows.push({ at, day, event: 'search', visitor: vis, lang, market: v % 9 === 0 ? 'ae' : 'in', query: ['casagrand casamia', 'hubtown celeste', 'lodha world towers', 'emaar creek bay'][v % 4], detail: v % 5 === 0 ? 'cached' : 'fresh' });
    if (v % 12 === 0) rows.push({ at, day, event: 'unlock_click', visitor: vis, lang });
    if (v % 24 === 0) rows.push({ at, day, event: 'checkout_started', visitor: vis, lang });
    if (v % 30 === 0) rows.push({ at, day, event: 'purchase_paid', visitor: vis, value: 499, currency: 'INR' });
    if (v % 15 === 0) rows.push({ at, day, event: 'save_pdf', visitor: vis });
    if (v % 20 === 0) rows.push({ at, day, event: 'share_whatsapp', visitor: vis });
  }
}
const analytics = { ok: true, ...A.aggregate(rows, { days: 30, now }), stored: true };
const health = { ok: true, markets: [
  { market: 'uk', label: 'United Kingdom', state: 'healthy', detail: 'found 05172586 through 1 host(s)', lastOkAt: now.toISOString(), checkedAt: now.toISOString() },
  { market: 'sg', label: 'Singapore', state: 'down', reason: 'blocked', detail: 'data.gov.sg robots.txt now disallows /api/action/datastore_search', checkedAt: now.toISOString() },
  { market: 'fr', label: 'France', state: 'unconfirmed', detail: 'the canary company was not found', checkedAt: now.toISOString() },
  { market: 'in', label: 'India', state: 'skipped', detail: 'no canary defined for this market', checkedAt: now.toISOString() } ] };
const disputes = [{ id: '11111111-1111-4111-8111-111111111111', report_ref: 'SK-ABCDEF123456', contact: 'buyer@example.com',
  note: 'Possession date is wrong <img src=x onerror="alert(1)">', submitted_at: now.toISOString() }];

function ctx_render_empty() {        // the panel with no language data at all
  const el = { innerHTML: '' }; const c = { document: { getElementById: id => id === 'languages' ? el : { innerHTML: '', textContent: '', hidden: false, value: '' } }, console, JSON, Math, Object, Array, String, Number, Date, Intl, Map, Set };
  vm.createContext(c); vm.runInContext(script, c);
  try { vm.runInContext('renderAnalytics(' + JSON.stringify({ ...analytics, languages: [] }) + ')', c); } catch {}
  return el.innerHTML;
}
function run({ password = 'right', expireAfterLogin = false } = {}) {
  const els = {};
  class El { constructor(id){ this.id = id; this.innerHTML = ''; this.textContent = ''; this.value = ''; this.hidden = false; this.disabled = false; } }
  const byId = id => els[id] || (els[id] = new El(id));
  byId('dashboard').hidden = true; byId('period').value = '30';
  let calls = 0;
  const ctx = { console, Promise, JSON, Object, Math, Date, Array, Set, Map, Error, String, Number, Intl, encodeURIComponent,
    btoa: s => Buffer.from(s).toString('base64'), alert: () => {},
    document: { getElementById: byId },
    fetch: async (url, o) => {
      calls++;
      const auth = o.headers.Authorization, good = 'Basic ' + Buffer.from('ops:right').toString('base64');
      const r = (status, body) => ({ status, ok: status < 300, json: async () => body });
      if (auth !== good || (expireAfterLogin && calls > 1)) return r(401, { ok: false });
      if (url.includes('/admin/held')) return r(200, { ok: true, markets: ['in'], held: [{ ref: 'SK-0123456789AB', project: 'Hubtown Celeste', developer: 'Hubtown Limited', market: 'in',
        adverse: [{ index: 1, claim: 'An insolvency application was admitted in 2023.', topic: 'legal', sources: ['https://ibbi.gov.in/y'] }] }] });
      if (url.includes('/admin/engines')) return r(200, { ok: true, pricesChecked: '2026-10-07', benchmarkAt: '2026-10-06T10:00:00Z',
        roles: { research: { candidates: [{ engine: 'xai', model: 'grok-4.3', estUsd: 0.075, basis: 'quality gate' }, { engine: 'anthropic', model: 'claude-sonnet-5-5', estUsd: 0.15, basis: 'quality gate' }],
                             excluded: [{ engine: 'deepseek', reason: 'cannot search the web' }, { engine: 'openai', reason: 'failed the quality gate' }, { engine: 'gemini', reason: 'not set up (no API key)' }] },
                 documents: { candidates: [], excluded: [{ engine: 'anthropic', reason: 'not approved for personal data' }] } },
        engines: { anthropic: { label: 'Anthropic (Claude)', configured: true, jurisdiction: 'United States' }, xai: { label: 'xAI (Grok)', configured: true, jurisdiction: 'United States' },
                   deepseek: { label: 'DeepSeek', configured: true, jurisdiction: "People's Republic of China" }, openai: { label: 'OpenAI (ChatGPT models)', configured: true, jurisdiction: 'United States' }, gemini: { label: 'Google (Gemini)', configured: false, jurisdiction: 'United States' } },
        usage: { anthropic: { calls: 40, ok: 37, failed: 3, rescued: 0, searches: 210, tokensIn: 512000, tokensOut: 98000, avgMs: 41000, estimatedCostUsd: 6.02, costComplete: true, lastError: 'research service error 529', lastErrorAt: '2026-10-07T09:00:00Z' },
                 xai: { calls: 3, ok: 3, failed: 0, rescued: 3, searches: 14, tokensIn: 30000, tokensOut: 9000, avgMs: 22000, estimatedCostUsd: 0.07, costComplete: false } } });
      if (url.includes('/admin/tax')) return r(200, { ok: true, progress: [{ country: 'CH', name: 'Switzerland', thresholds: [{ amount: 100000, currency: 'CHF', basis: 'worldwide', sales: 92000, pct: 0.92 }], pct: 0.92, level: 'alert', registered: false },
        { country: 'CA', name: 'Canada', thresholds: [{ amount: 10000, currency: 'CAD', basis: 'country', sales: 1200, pct: 0.12 }], pct: 0.12, level: 'ok', registered: false }],
        off: [{ iso: 'GB', name: 'United Kingdom', reason: 'registration_required' }, { iso: 'AE', name: 'United Arab Emirates', reason: 'unverified' }] });
      if (url.includes('/analytics')) return r(200, analytics);
      if (url.includes('/stats')) return r(200, { paidPurchases: 41, pendingCheckouts: 17, openDisputes: 1, pendingResponses: 0 });
      if (url.includes('/source-health')) return r(200, health);
      if (url.includes('/disputes')) return r(200, disputes);
      if (url.includes('/responses')) return r(200, []);
      return r(404, {});
    } };
  vm.createContext(ctx); vm.runInContext(script, ctx);
  byId('loginUser').value = 'ops'; byId('loginPass').value = password;
  return { ctx, els, byId };
}
let fails = 0; const ok = (l, c) => { if (!c) fails++; console.log((c ? '  ok   ' : '  FAIL ') + l); };
(async () => {
  const bad = run({ password: 'wrong' }); await bad.ctx.login();
  ok('a wrong password never reveals the dashboard', bad.els.dashboard.hidden === true && /Wrong username or password/.test(bad.els.loginError.textContent));

  const w = run(); await w.ctx.login();
  ok('the right password shows the dashboard, and clears the password field', w.els.dashboard.hidden === false && w.els.loginPass.value === '');
  ok('headline numbers render: visitors, revenue in rupees, PDFs saved', /Visitors/.test(w.els.kpis.innerHTML) && /₹/.test(w.els.kpis.innerHTML) && /PDFs saved/.test(w.els.kpis.innerHTML));
  ok('the funnel has all six steps with conversion percentages', (w.els.funnel.innerHTML.match(/<li>/g) || []).length === 6 && /%<\/span>/.test(w.els.funnel.innerHTML));
  ok('Instagram leads the traffic sources', w.els.channels.innerHTML.indexOf('instagram') < w.els.channels.innerHTML.indexOf('whatsapp'));
  ok('the Languages panel shows conversion by reading language, by name, with search-to-checkout rates, and an empty state says so', /English/.test(w.els.languages.innerHTML) && /Hindi/.test(w.els.languages.innerHTML) && /Arabic/.test(w.els.languages.innerHTML) && /\d+(\.\d)?%/.test(w.els.languages.innerHTML) && (() => { const e = ctx_render_empty(); return /No data yet/.test(e); })());
  ok('conversion by country: each country by name with its visitors; a rate only where there were searches (a dash, never a made-up 0%)', /<td>India<\/td><td>\d+<\/td>/.test(w.els.countryFunnel.innerHTML) && /<td>United Kingdom<\/td>/.test(w.els.countryFunnel.innerHTML) && /<td>\u2014<\/td>/.test(w.els.countryFunnel.innerHTML));
  ok('tax exposure: progress per country, worldwide thresholds labelled, alerts highlighted, and every country that is off with its reason',
    /Switzerland<\/td><td>CHF 100,000 \(worldwide\)/.test(w.els.taxProgress.innerHTML) && /92%/.test(w.els.taxProgress.innerHTML) && /color:#B42318/.test(w.els.taxProgress.innerHTML) && /Alert: over 90%/.test(w.els.taxProgress.innerHTML)
    && /United Kingdom \(needs a tax registration first\)/.test(w.els.taxOff.innerHTML) && /United Arab Emirates \(tax rule not yet confirmed by the tax adviser\)/.test(w.els.taxOff.innerHTML));
  ok('AI engines: per agent the engines cheapest first with model, cost and basis, the ones left out and why (not the unset ones), and each engine\'s jurisdiction',
    /Research:<\/strong> xAI \(Grok\) <span class="sub">\(grok-4\.3, \$0\.075 a call, quality gate\)<\/span> \u2192 Anthropic/.test(w.els.engineRoles.innerHTML)
    && /Not used: DeepSeek: cannot search the web; OpenAI \(ChatGPT models\): failed the quality gate<\/div>/.test(w.els.engineRoles.innerHTML) && !/Gemini\): not set up/.test(w.els.engineRoles.innerHTML)
    && /Document check:<\/strong> <strong>no engine available<\/strong>/.test(w.els.engineRoles.innerHTML)
    && /<td>DeepSeek<\/td><td>Yes<\/td><td>People&#039;s Republic of China<\/td>/.test(w.els.engineUsage.innerHTML) && /\$0\.07 \(partial\)/.test(w.els.engineUsage.innerHTML) && /Last error: research service error 529/.test(w.els.engineUsage.innerHTML));
  ok('held for a person: the market setting, each negative finding with its sources, and a release button',
    /Holding negative findings for review in: in\./.test(w.els.heldNote.textContent) && /An insolvency application was admitted in 2023\./.test(w.els.held.innerHTML) && /ibbi\.gov\.in\/y/.test(w.els.held.innerHTML) && /Checked: release/.test(w.els.held.innerHTML));
  ok('countries are shown by name', /India/.test(w.els.countries.innerHTML) && /United Arab Emirates/.test(w.els.countries.innerHTML));
  ok('the daily chart is drawn as an SVG with 30 days', /<svg/.test(w.els.daily.innerHTML) && (w.els.daily.innerHTML.match(/<rect /g) || []).length === 30);
  ok('a switched-off register raises a banner at the top', /Switched to research-only: Singapore/.test(w.els.banners.innerHTML));
  ok('a dispute note containing HTML is shown as text, never run', w.els.disputes.innerHTML.includes('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;') && !w.els.disputes.innerHTML.includes('<img'));

  const exp = run({ expireAfterLogin: true }); await exp.ctx.login();
  ok('if the session stops being valid mid-way, the page signs out instead of showing stale numbers', exp.els.dashboard.hidden === true);

  // ---- the admin DEMO: no server, no sign-in, demo data from tools/build_admin_demo.js ----
  {
    const els = {};
    class El2 { constructor(id){ this.id = id; this.innerHTML = ''; this.textContent = ''; this.value = ''; this.hidden = false; this.disabled = false; } }
    const byId = id => els[id] || (els[id] = new El2(id));
    byId('dashboard').hidden = true; byId('period').value = '30'; byId('demoLogin').hidden = true;
    let calls = 0;
    const ctx = { console, Promise, JSON, Object, Math, Date, Array, Set, Map, Error, String, Number, Intl, encodeURIComponent, decodeURIComponent,
      setTimeout: f => { f(); return 0; }, btoa: x => Buffer.from(x).toString('base64'), alert: () => {}, document: { getElementById: byId },
      fetch: async () => { calls++; throw new Error('no network in the demo'); } };
    vm.createContext(ctx); vm.runInContext(html.match(/<script>([\s\S]*)<\/script>/)[1], ctx);
    ok('demo: with no server, sign-in gives way to "Open the demo dashboard"', els.demoLogin.hidden === false && els.loginPass.hidden === true && els.loginBtn.hidden === true && els.loginIntro.hidden === true);
    await ctx.openDemo(); await new Promise(r => setImmediate(r));
    ok('demo: the dashboard opens, labelled as demo data', els.dashboard.hidden === false && /Demo\.<\/strong> Demo data: visitor traffic is simulated/.test(els.banners.innerHTML));
    ok('demo: headline numbers and the funnel are filled', /Visitors/.test(els.kpis.innerHTML) && (els.funnel.innerHTML.match(/<li>/g) || []).length === 6);
    const rows = (els.reports.innerHTML.match(/<tr><td>/g) || []).length;
    ok('demo: the Reports panel lists all five reports with their findings', rows === 5 && /Hubtown Celeste/.test(els.reports.innerHTML) && /Findings/.test(els.reports.innerHTML));
    const pdfs = [...els.reports.innerHTML.matchAll(/href="sample-reports\/([^"]+)"/g)].map(m => decodeURIComponent(m[1]));
    ok('demo: every "Open full report" opens a PDF that exists', pdfs.length === 5 && pdfs.every(f => fs.existsSync(path.join(__dirname, '..', '..', 'sample-reports', f))));
    ok('demo: every report can be seen as a client sees it', (els.reports.innerHTML.match(/shelterkart-frontend\.html\?ref=SK-[0-9A-F]{12}/g) || []).length === 5);
    const before = (els.disputes.innerHTML.match(/Mark resolved/g) || []).length;
    await ctx.resolveDispute('0b6a1f3e-0000-4000-8000-000000000001'); await new Promise(r => setImmediate(r));
    ok('demo: actions work -- resolving a dispute removes it', before === 2 && (els.disputes.innerHTML.match(/Mark resolved/g) || []).length === 1);
    ok('demo: success metrics are measured against their targets', /Visitor → paid report/.test(els.success.innerHTML) && /on target|below target/.test(els.success.innerHTML) && (els.success.innerHTML.match(/<tr><td><strong>/g) || []).length === 6);
    ok('demo: not a single network request', calls === 0);
  }
  console.log(fails ? `\n${fails} FAILED` : '\nall passing');
  process.exitCode = fails ? 1 : 0;
})();
