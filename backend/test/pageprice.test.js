'use strict';
/** The report page's unlock form (B8): the price shown follows the billing country, and paying takes a second press once the price for that country is on screen. The page's own script runs here against a stand-in page. */
const assert = require('assert'), vm = require('vm');
const { SCRIPT } = require('../engine/reportPages');
let passed = 0, failed = 0;
async function t(name, fn) { try { await fn(); passed++; console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); } }
const settle = async () => { for (let i = 0; i < 12; i++) await new Promise(r => setImmediate(r)); };

function stage(over = {}) {
  const calls = [], handlers = {};
  const el = (extra = {}) => ({ textContent: '', value: '', disabled: false, ...extra, addEventListener(type, fn) { this.on = this.on || {}; this.on[type] = fn; }, getAttribute: () => null });
  const select = Object.assign(el({ value: 'IN' }), { options: [{ textContent: 'India' }, { textContent: 'United Kingdom' }], selectedIndex: 0 });
  const button = el({ textContent: 'Unlock the full report' });
  const form = Object.assign(el(), { country: select, email: el({ value: 'a@b.co' }), phone: el({ value: '' }), querySelector: () => button });
  const msg = el(), prices = [el({ textContent: '₹4,400' }), el({ textContent: '₹4,400' })];
  const root = el(); root.getAttribute = k => ({ 'data-ref': 'SK-ABC123456789', 'data-token': '', 'data-phase': 'preview', 'data-live': 'off' })[k] || '';
  const byId = { sk: root, 'sk-unlock': form, 'sk-unlock-msg': msg };
  const document = { getElementById: id => byId[id] || null, querySelectorAll: s => (s === '.sk-price' ? prices : []), createElement: () => el(), head: { appendChild() {} } };
  const location = { href: '' };
  const answers = { '/price?country=GB': { ok: true, price: 'GBP 36' }, '/price?country=IN': { ok: true, price: '₹4,400' }, '/contact': { ok: true },
    '/api/research/quote': { ok: true, quote: { id: 'q1', currency: 'GBP', gross: 36 } }, '/api/research/checkout': { ok: true, mor: { checkoutUrl: 'https://pay.example/c1' }, purchaseId: 'p1' }, ...over };
  const fetch = async (url, o) => {
    calls.push({ url, body: o && o.body ? JSON.parse(o.body) : null });
    const key = Object.keys(answers).find(k => url.endsWith(k) || url === k); const j = answers[key] || { ok: false, error: 'unexpected ' + url };
    return { status: 200, json: async () => j };
  };
  vm.runInNewContext(SCRIPT, { document, location, fetch, window: {}, crypto: {}, TextEncoder, encodeURIComponent, Date, Math, JSON, Promise, setTimeout, console });
  const choose = (value, index) => { select.value = value; select.selectedIndex = index; };
  return { calls, select, button, form, msg, prices, location, choose, submit: async () => { form.on.submit({ preventDefault() {} }); await settle(); }, change: async () => { select.on.change(); await settle(); } };
}

(async () => {
  await t('choosing another billing country changes the price on the page to that country’s price', async () => {
    const s = stage(); s.choose('GB', 1); await s.change();
    assert(s.calls.some(c => /\/api\/investigate\/SK-ABC123456789\/price\?country=GB$/.test(c.url)), JSON.stringify(s.calls));
    assert.deepStrictEqual(s.prices.map(p => p.textContent), ['GBP 36', 'GBP 36']);
    assert.strictEqual(s.msg.textContent, 'Price for United Kingdom: GBP 36');
    assert.strictEqual(s.button.textContent, 'Unlock the full report');
  });
  await t('the first press fetches the quote and shows what will be charged; nothing is charged yet', async () => {
    const s = stage(); s.choose('GB', 1); await s.change(); await s.submit();
    assert(s.calls.some(c => /\/api\/research\/quote$/.test(c.url) && c.body.billingCountry === 'GB'));
    assert(!s.calls.some(c => /\/api\/research\/checkout$/.test(c.url)), 'checkout must wait for the second press');
    assert.strictEqual(s.button.textContent, 'Pay GBP 36'); assert.strictEqual(s.button.disabled, false);
    assert(/Price for United Kingdom: GBP 36\. Press the button again to pay\./.test(s.msg.textContent), s.msg.textContent);
    assert.strictEqual(s.location.href, '');
  });
  await t('the second press pays with the quote that was shown, in the country that was shown', async () => {
    const s = stage(); s.choose('GB', 1); await s.change(); await s.submit(); await s.submit();
    const co = s.calls.find(c => /\/api\/research\/checkout$/.test(c.url));
    assert(co, JSON.stringify(s.calls.map(c => c.url)));
    assert.strictEqual(co.body.quoteId, 'q1'); assert.strictEqual(co.body.billingCountry, 'GB'); assert.strictEqual(co.body.returnTo, '/r/SK-ABC123456789');
    assert.strictEqual(s.calls.filter(c => /\/api\/research\/quote$/.test(c.url)).length, 1, 'one quote, not a second');
    assert.strictEqual(s.location.href, 'https://pay.example/c1');
  });
  await t('changing the country after the price was shown takes the quote back: the next press asks for a new price', async () => {
    const s = stage(); s.choose('GB', 1); await s.change(); await s.submit();
    s.choose('IN', 0); await s.change();
    assert.strictEqual(s.button.textContent, 'Unlock the full report');
    assert.deepStrictEqual(s.prices.map(p => p.textContent), ['₹4,400', '₹4,400']);
    await s.submit();
    assert(!s.calls.some(c => /\/api\/research\/checkout$/.test(c.url)));
    assert.strictEqual(s.calls.filter(c => /\/api\/research\/quote$/.test(c.url)).length, 2);
  });
  await t('a quote that is refused says why, resets the button and charges nothing', async () => {
    const s = stage({ '/api/research/quote': { ok: false, error: 'India is not open for sale yet.' } }); await s.submit();
    assert.strictEqual(s.msg.textContent, 'India is not open for sale yet.'); assert.strictEqual(s.button.textContent, 'Unlock the full report'); assert.strictEqual(s.button.disabled, false);
    assert(!s.calls.some(c => /\/api\/research\/checkout$/.test(c.url)));
  });
  await t('a price that cannot be fetched leaves the page as it was', async () => {
    const s = stage({ '/price?country=GB': { ok: false, error: 'x' } }); s.choose('GB', 1); await s.change();
    assert.deepStrictEqual(s.prices.map(p => p.textContent), ['₹4,400', '₹4,400']); assert.strictEqual(s.msg.textContent, '');
  });
  console.log(`\n${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
})();
