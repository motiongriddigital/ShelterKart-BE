'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path');
const { stripPII } = require('../lib/pii');
const PRICING = require('../pricing');
const { fyOf, issueInvoice } = require('../pricing/invoice');
const { mountSalesAdmin } = require('../engine/salesAdmin');
let passed = 0, failed = 0;
async function t(name, fn) { try { await fn(); passed++; console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); } }
const ms = fn => { const t0 = process.hrtime.bigint(); fn(); return Number(process.hrtime.bigint() - t0) / 1e6; };

(async () => {
  await t('stripPII takes linear time on long runs with no address in them', async () => {
    for (const unit of ['a', '.', 'a.', 'a+', 'a-']) {
      const s10 = unit.repeat(10000 / unit.length), s20 = unit.repeat(20000 / unit.length);
      const a = Math.max(ms(() => stripPII(s10)), 0.05), b = ms(() => stripPII(s20));
      assert.ok(b < 20, `${JSON.stringify(unit)}: 20,000 characters took ${b.toFixed(1)} ms`);
      assert.ok(b / a < 3.2, `${JSON.stringify(unit)}: doubling the input multiplied the time by ${(b / a).toFixed(1)}`);
    }
  });
  await t('stripPII still removes addresses and phone numbers', async () => {
    assert.strictEqual(stripPII('Hubtown Celeste mail me at buyer.name+x@example.co.in please'), 'Hubtown Celeste mail me at please');
    assert.strictEqual(stripPII('call +91 98765 43210 now'), 'call now');
    assert.strictEqual(stripPII('Hubtown Celeste, Worli'), 'Hubtown Celeste, Worli');
  });

  await t('a 36-character string of hyphens is not a purchase id', async () => {
    const { UUID_RE } = require('../lib/ids');
    assert.ok(!UUID_RE.test('-'.repeat(36)));
    assert.ok(!UUID_RE.test('0'.repeat(36)));
    assert.ok(UUID_RE.test('123e4567-e89b-42d3-a456-426614174000'));
    assert.ok(UUID_RE.test(require('crypto').randomUUID()));
  });
  await t('no handler still validates ids with the loose 36-character pattern', async () => {
    const root = path.join(__dirname, '..'), bad = [];
    const walk = d => fs.readdirSync(d, { withFileTypes: true }).forEach(e => {
      if (e.name === 'node_modules' || e.name === 'test') return;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p); else if (e.name.endsWith('.js') && fs.readFileSync(p, 'utf8').includes('[0-9a-f-]{36}')) bad.push(path.relative(root, p));
    });
    walk(root);
    assert.deepStrictEqual(bad, []);
  });

  await t('the invoice financial year and date follow India time', async () => {
    assert.strictEqual(fyOf(new Date('2026-03-31T19:00:00Z')), '2026-27');
    assert.strictEqual(fyOf(new Date('2026-03-31T18:29:00Z')), '2025-26');
    assert.strictEqual(fyOf(new Date('2026-04-01T00:00:00Z')), '2026-27');
    const saved = []; const store = { async nextInvoiceNumber() { return 1; }, async saveInvoice(x) { saved.push(x); } };
    const body = await issueInvoice({ data: {}, store, purchase: { id: 'p1' }, quote: { buyer: { country: 'IN' }, currency: 'INR', ref: 'SK-1', id: 'q1', net: 1, tax: 0, gross: 1, taxName: 'GST', taxRateBps: 0, priceBookVersion: 'v' }, now: new Date('2026-03-31T19:00:00Z'), env: {} });
    assert.ok(body.number.startsWith('SK/2026-27/'));
    assert.strictEqual(body.date, '2026-04-01');
  });

  await t('a tax-threshold alert is raised once per level even when the store returns dates', async () => {
    const data = PRICING.load({});
    const events = [];
    const store = { ...PRICING.makeStore({}),
      async addEvent(type, o = {}) { events.push({ at: new Date(), type, details: o.details || {} }); },
      async listEvents(f = {}) { return events.filter(e => !f.type || e.type === f.type).map(e => ({ ...e })); } };
    let target = null;
    for (const [iso] of data.countries) { const x = PRICING.taxFor(data, iso); if (x && x.mode === 'not_required_yet' && x.thresholds && x.thresholds.length) { target = { iso, th: x.thresholds[0] }; break; } }
    store.salesSince = async () => [{ country: target.iso, month: new Date().toISOString().slice(0, 7), currency: target.th.currency, gross: target.th.amount * 0.75, tax: 0 }];
    const runs = []; for (let i = 0; i < 3; i++) runs.push((await PRICING.ledger.checkThresholds({ data, store })).length);
    assert.ok(runs[0] > 0, 'the first run raises an alert');
    assert.deepStrictEqual(runs.slice(1), [0, 0]);
  });

  const routes = new Map(), app = { get: (p, ...h) => routes.set(p, h) };
  const pass = (req, res, next) => next && next();
  mountSalesAdmin(app, { adminAuth: pass, wrap: fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(e => res.status(500).json({ err: e.message })), rateLimit: () => pass,
    source: { async sales() { return []; }, async refunds() { return []; }, async pending() { return 0; }, async orders() { return []; }, async refundList() { return []; } }, fx: () => ({ USD: 1 }) });
  const call = (p, query) => new Promise(resolve => {
    const res = { code: 200, set() { return this; }, status(c) { this.code = c; return this; }, json(b) { resolve({ code: this.code, body: b }); } };
    const hs = routes.get(p); let i = 0; const next = () => { const f = hs[i++]; if (f) f({ query }, res, next); }; next();
  });
  await t('an array where the sales orders filter expects text is a 400, not a 500', async () => {
    for (const q of [{ country: ['US'] }, { country: { a: 'US' } }, { status: ['paid'] }, { q: ['x'] }]) assert.strictEqual((await call('/api/admin/sales/orders', q)).code, 400, JSON.stringify(q));
    assert.strictEqual((await call('/api/admin/sales/orders', { country: 'us' })).code, 200);
  });

  await t('production start-up warns when ACCOUNTS_CSRF is switched to report or off', async () => {
    const { check } = require('../engine/configCheck');
    const base = { NODE_ENV: 'production', ACCOUNTS_ENABLED: 'on', ADMIN_USERNAME: 'a', ADMIN_PASSWORD: 'x'.repeat(20), ACCESS_TOKEN_SECRET: 'a'.repeat(40), QUOTE_SECRET: 'b'.repeat(40), DATABASE_URL: 'postgres://x', ALLOWED_ORIGINS: 'https://x', TRUST_PROXY: '1' };
    assert.ok(!check(base).warnings.some(w => w.includes('ACCOUNTS_CSRF')), 'unset is on in production');
    assert.ok(check({ ...base, ACCOUNTS_CSRF: 'report' }).warnings.some(w => w.includes('ACCOUNTS_CSRF')));
    assert.ok(check({ ...base, ACCOUNTS_CSRF: 'off' }).warnings.some(w => w.includes('ACCOUNTS_CSRF')));
    assert.ok(!check({ ...base, ACCOUNTS_CSRF: 'on' }).warnings.some(w => w.includes('ACCOUNTS_CSRF')));
    assert.ok(!check({ ...base, ACCOUNTS_ENABLED: '' }).warnings.some(w => w.includes('ACCOUNTS_CSRF')));
  });
  await t('production start-up warns when a database is there but investigations are still kept as files', async () => {
    const { check } = require('../engine/configCheck');
    const base = { NODE_ENV: 'production', ADMIN_USERNAME: 'a', ADMIN_PASSWORD: 'x'.repeat(20), ACCESS_TOKEN_SECRET: 'a'.repeat(40), QUOTE_SECRET: 'b'.repeat(40), DATABASE_URL: 'postgres://x', ALLOWED_ORIGINS: 'https://x', TRUST_PROXY: '1' };
    assert.ok(check(base).warnings.some(w => w.includes('JOB_STORE')));
    assert.ok(!check({ ...base, JOB_STORE: 'postgres' }).warnings.some(w => w.includes('JOB_STORE')));
    assert.ok(!check({ ...base, DATABASE_URL: '' }).warnings.some(w => w.includes('JOB_STORE')));
  });
  console.log(`\n${passed} passed, ${failed} failed`); process.exitCode = failed ? 1 : 0;
})();
