// Languages end to end, through the real server: the paywall still decides what is shown,
// translation can only fail into English, marks/sources/ids never change, and every
// sentence is translated once. The translator is a deterministic fake; the checks are the real ones.
const path = require('path');
Object.assign(process.env, { ANTHROPIC_API_KEY: 'k', PAYMENTS_ENABLED: 'true', ACCESS_TOKEN_SECRET: 'tok', PAYMENT_WEBHOOK_SECRET: 'whsec',
  RAZORPAY_KEY_ID: 'rzp_test_id', RAZORPAY_KEY_SECRET: 'key_secret', RAZORPAY_WEBHOOK_SECRET: 'rzp_whsec' });
const calls = { research: 0, translate: 0, verify: 0 };
let mode = 'good';          // good | change-number | verify-fails | down
globalThis.fetch = async (url, o) => {
  const mk = c => ({ ok: true, status: 200, json: async () => c });
  const b = JSON.parse(o.body), prompt = (b.messages && b.messages[0] && b.messages[0].content) || '';
  if (/^You translate extracts/.test(prompt)) {
    calls.translate++;
    if (mode === 'down') return { ok: false, status: 500, json: async () => ({}) };
    const items = JSON.parse(prompt.slice(prompt.lastIndexOf('\n{') + 1));
    const out = {}; for (const [id, text] of Object.entries(items)) out[id] = mode === 'change-number' ? '【hi】' + text.replace(/2027/g, '2028') : '【hi】' + text;
    return mk({ content: [{ type: 'text', text: JSON.stringify(out) }] });
  }
  if (/^You check Hindi translations/.test(prompt)) {
    calls.verify++;
    const ids = Object.keys(JSON.parse(prompt.slice(prompt.indexOf('\n{') + 1)));
    return mk({ content: [{ type: 'text', text: JSON.stringify(Object.fromEntries(ids.map(i => [i, mode === 'verify-fails' ? { ok: false, issue: 'meaning differs' } : { ok: true }]))) }] });
  }
  if (b.tools) {
    calls.research++;
    const out = { project: { name: 'Hubtown Celeste', location: 'Worli, Mumbai', developer: 'Hubtown Limited', ids: ['P51900008925'], developer_site: '' }, sources: ['https://a.com/1', 'https://b.com/2'],
      findings: [{ id: 'f1', topic: 'dates', stance: 'neutral', claim: 'Possession is stated as December 2027 on the registration P51900008925.', kind: 'fact', src: [0, 1] },
                 { id: 'f2', topic: 'legal', stance: 'negative', claim: 'A lender filed a petition against Hubtown Limited in 2025.', kind: 'fact', src: [0, 1] },
                 { id: 'f3', topic: 'progress', stance: 'positive', claim: 'The structure stands to the 27th floor.', kind: 'fact', src: [0, 1] },
                 { id: 'f4', topic: 'other', stance: 'neutral', claim: 'A single tower of 38 floors.', kind: 'fact', src: [0, 1] }],
      conflicts: [{ topic: 'Possession date', versions: [{ value: 'December 2027', src: 0 }, { value: 'July 2028', src: 1 }] }], gaps: [{ topic: 'Escrow account', why: 'Not published on any page found.' }] };
    return mk({ stop_reason: 'end_turn', content: [{ type: 'server_tool_use', name: 'web_search' }, { type: 'web_search_tool_result', content: [{ url: 'https://a.com/1', title: 'A' }, { url: 'https://b.com/2', title: 'B' }] }, { type: 'text', text: JSON.stringify(out) }] });
  }
  return mk({ content: [{ type: 'text', text: JSON.stringify({ reading: [], questions: [{ when: 'Before booking', who: 'Sales team', question: 'Which date is on the registration?', good: 'The certificate.', red_flag: 'A verbal date.' }] }) }] });
};
const app = require(path.join(__dirname, '..', '..', 'server.js'));
const { _db } = require('pg');
const find = (m, p) => app.routes.find(r => r.method === m && r.path === p);
function call(route, body, extra = {}) { return new Promise(resolve => {
  const res = { code: 200, status(c) { this.code = c; return this; }, set() { return this; }, end() { resolve({ code: this.code }); }, json(o) { resolve({ code: this.code, body: o }); } };
  const headers = { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1', ...(extra.headers || {}) }; const req = { body, params: extra.params || {}, query: extra.query || {}, ip: '5.5.5.5', headers, path: route.path, get: k => headers[k.toLowerCase()] };
  const hs = route.handlers; let i = 0; const next = err => { if (err) return resolve({ code: 500, body: { error: err.message } }); const x = hs[i++]; if (x) x(req, res, next); }; next(); }); }
let failures = 0;
const ok = (l, c) => { if (!c) failures++; console.log((c ? '  ok   ' : '  FAIL ') + l); };
process.on('exit', () => { console.log(failures ? '\n' + failures + ' FAILED' : '\nall passing'); if (failures) process.exitCode = 1; });

(async () => {
  const research = find('post', '/api/research'), byRef = find('get', '/api/research/by-ref/:ref'), langs = find('get', '/api/languages');
  const q = { query: 'Hubtown Celeste', market: 'in' };
  const en = await call(research, q);
  ok('English is unchanged: the report as researched, no i18n block', en.code === 200 && !en.body.brief.i18n && en.body.brief.locked === true);

  const hi = await call(research, { ...q, lang: 'hi' });
  const f = hi.body.brief.findings;
  ok('Hindi request: the FREE PREVIEW is translated as a preview -- still locked, never widened', hi.body.brief.locked === true && f.length === en.body.brief.findings.length && f.every(x => x.claim.startsWith('【hi】')));
  ok('...and says what happened: AI translation, English governs', hi.body.brief.i18n.lang === 'hi' && hi.body.brief.i18n.status === 'ai' && hi.body.brief.i18n.original === 'en' && hi.body.brief.i18n.review === 'ai');
  ok('marks, ids and sources are exactly the English report\u2019s', JSON.stringify(f.map(x => [x.id, x.mark, x.sites, x.sources])) === JSON.stringify(en.body.brief.findings.map(x => [x.id, x.mark, x.sites, x.sources]))
      && hi.body.brief.ref === en.body.brief.ref);
  ok('the price is the same in every language', JSON.stringify(hi.body.paywall) === JSON.stringify(en.body.paywall));
  const before = calls.translate;
  await call(research, { ...q, lang: 'hi' });
  ok('the second request for the same report makes NO translation call: every sentence is cached', calls.translate === before);
  ok('the sensitive claims got the independent meaning check', calls.verify >= 1);

  const open = await call(byRef, null, { params: { ref: en.body.brief.ref }, query: { lang: 'hi' } });
  ok('by-ref (shared link) honours the language and the same paywall', open.code === 200 && open.body.brief.locked === true && open.body.brief.i18n.lang === 'hi');

  mode = 'change-number'; require('../../engine/translate')._memory.clear(); _db.translations.clear();
  const bad = await call(research, { ...q, lang: 'hi' });
  const claims = bad.body.brief.findings.map(x => x.claim);
  ok('a translation that changes a number (2027 -> 2028) is REFUSED: that item is shown in English', claims.some(c => /Possession is stated as December 2027/.test(c) && !c.startsWith('【hi】')) && bad.body.brief.i18n.status === 'partial' && bad.body.brief.i18n.fallback >= 1);
  ok('...while items with nothing to protect are still translated', claims.some(c => c.startsWith('【hi】')));

  mode = 'verify-fails'; require('../../engine/translate')._memory.clear(); _db.translations.clear();
  const vf = await call(research, { ...q, lang: 'hi' });
  ok('a negative legal claim that fails the meaning check is shown in ENGLISH, never in doubtful translation', vf.body.brief.findings.some(x => /lender filed a petition/.test(x.claim) && !x.claim.startsWith('【hi】')));

  mode = 'down'; require('../../engine/translate')._memory.clear(); _db.translations.clear();
  const down = await call(research, { ...q, lang: 'hi' });
  ok('translation service down: the report still opens, in English, and says so', down.code === 200 && down.body.brief.findings.length > 0 && down.body.brief.findings.every(x => !x.claim.startsWith('【hi】')) && ['english', 'unavailable'].includes(down.body.brief.i18n.status));

  mode = 'good';
  const dis = await call(research, { ...q, lang: 'zz' }), off = await call(research, { ...q, lang: 'it' });
  ok('an unknown or not-yet-enabled language is simply English', !dis.body.brief.i18n && !off.body.brief.i18n);
  const list = await call(langs, null);
  ok('GET /api/languages lists only enabled languages, with their direction, and each market\u2019s languages', list.body.languages.map(l => l.code).join() === 'en,hi,ar,fr,pl,zh-Hant,es,de,ja' && list.body.languages.find(l => l.code === 'ar').dir === 'rtl' && list.body.markets.in[0] === 'hi' && list.body.markets.ae[0] === 'ar');
  ok('language is recorded on analytics events', require('../../engine/analytics')._memory.some(e => e.event === 'search' && e.lang === 'hi'));
})();
