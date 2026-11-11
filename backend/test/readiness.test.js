'use strict';
const assert = require('assert');
const P = require('../pricing');
const { report, summaryLines, mountReadiness } = require('../engine/readiness');
let passed = 0, failed = 0;
async function t(name, fn) { try { await fn(); passed++; console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); } }

const SECRET = 'sentinel-secret-value-9f3a';
const rep = env => report({ NODE_ENV: 'production', ...env }, P.load({ NODE_ENV: 'production', ...env }));
const group = (r, reason) => r.countries.find(g => g.reason === reason);
const FULL_RAZORPAY = { RAZORPAY_KEY_ID: SECRET, RAZORPAY_KEY_SECRET: SECRET, RAZORPAY_WEBHOOK_SECRET: SECRET };

(async () => {
  await t('with nothing set every provider lists what it lacks and nothing is on sale', async () => {
    const r = rep({});
    assert.deepStrictEqual(r.onSale, []);
    assert.deepStrictEqual(r.company.missing, ['GSTIN']);
    assert.deepStrictEqual(r.providers.razorpay.missing, ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET']);
    assert.deepStrictEqual(r.providers.razorpayInternational.missing, ['RAZORPAY_INTERNATIONAL']);
    assert.deepStrictEqual(r.providers.merchantOfRecord.missing, ['DODO_API_KEY', 'DODO_WEBHOOK_KEY', 'MOR_PRODUCTS']);
    assert.strictEqual(r.providers.razorpay.ready, false);
  });
  await t('settings that are present leave the lists', async () => {
    const r = rep({ GSTIN: '27AAAAA0000A1Z5', ...FULL_RAZORPAY, RAZORPAY_INTERNATIONAL: 'true', DODO_API_KEY: SECRET, DODO_WEBHOOK_KEY: SECRET, MOR_PRODUCTS: JSON.stringify({ USD: 'p' }) });
    assert.deepStrictEqual(r.company.missing, []);
    assert.strictEqual(r.providers.razorpay.ready, true);
    assert.strictEqual(r.providers.razorpayInternational.ready, true);
    assert.strictEqual(r.providers.merchantOfRecord.ready, true);
    assert.strictEqual(r.onSale.length, 47);
  });
  await t('closed countries are grouped by reason with the alternatives that would open them', async () => {
    const r = rep({ GSTIN: '27AAAAA0000A1Z5' });
    const reg = group(r, 'registration_required'), unv = group(r, 'unverified'), route = group(r, 'no_payment_route');
    assert.strictEqual(reg.countries.length, 25);
    assert.strictEqual(unv.countries.length, 13);
    assert.strictEqual(route.countries.length, 8);
    assert.deepStrictEqual(route.options, [['RAZORPAY_INTERNATIONAL'], ['DODO_API_KEY', 'DODO_WEBHOOK_KEY', 'MOR_PRODUCTS']]);
    assert.ok(unv.options.some(o => o.join(' ').includes('TAX_PROFILES')));
    assert.strictEqual(reg.registrationSettings.GB, 'UK_VAT_NO');
    assert.strictEqual(reg.registrationSettings.FR, 'EU_OSS_VAT_NO');
    assert.deepStrictEqual(reg.options[0], ['the country registration number (see registrationSettings)', 'RAZORPAY_INTERNATIONAL']);
  });
  await t('India is listed with the GSTIN and the Razorpay keys until they are set', async () => {
    const g = group(rep({}), 'registration_missing');
    assert.deepStrictEqual(g.countries, ['IN']);
    assert.deepStrictEqual(g.options, [['GSTIN', 'RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET']]);
  });
  await t('mail and the SEC identity report what is missing', async () => {
    const none = rep({});
    assert.strictEqual(none.mail.ready, false);
    assert.ok(none.mail.missing.includes('DELIVERY_FROM'));
    assert.deepStrictEqual(none.sec.missing, ['SEC_USER_AGENT']);
    const ok = rep({ DELIVERY_FROM: 'ShelterKart <no-reply@shelterkart.com>', RESEND_API_KEY: SECRET, SEC_USER_AGENT: 'ShelterKart Research research@shelterkart.com' });
    assert.strictEqual(ok.mail.ready, true);
    assert.strictEqual(ok.mail.provider, 'resend');
    assert.deepStrictEqual(ok.sec.missing, []);
  });
  await t('no secret value or address ever appears in the report', async () => {
    const r = rep({ GSTIN: SECRET, ...FULL_RAZORPAY, DODO_API_KEY: SECRET, DODO_WEBHOOK_KEY: SECRET, RESEND_API_KEY: SECRET, DELIVERY_FROM: SECRET, SEC_USER_AGENT: SECRET, MOR_PRODUCTS: SECRET });
    assert.ok(!JSON.stringify(r).includes(SECRET));
  });
  await t('the start-up summary names what is missing and never a value', async () => {
    const env = { NODE_ENV: 'production', ...FULL_RAZORPAY };
    const lines = summaryLines(env, P.load(env));
    assert.ok(lines[0].startsWith('0 countries on sale'));
    assert.ok(lines.some(l => l.includes('GSTIN')));
    assert.ok(lines.some(l => l.includes('SEC_USER_AGENT')));
    assert.ok(!lines.join('\n').includes(SECRET));
    assert.ok(!lines.some(l => l.startsWith('razorpay not ready')));
  });
  await t('the route is admin-only, rate limited, never cached and answers with the report', async () => {
    const routes = new Map(), app = { get: (p, ...h) => routes.set(p, h) };
    const calls = [];
    mountReadiness(app, { adminAuth: (q, s, n) => { calls.push('auth'); n(); }, wrap: fn => fn, rateLimit: () => (q, s, n) => { calls.push('limit'); n(); }, data: () => P.load({}), env: () => ({}) });
    const h = routes.get('/api/admin/readiness'); assert.ok(h);
    assert.strictEqual(h.length, 3);
    let status = 200, headers = {}, body;
    const res = { set: (k, v) => { headers[k] = v; }, status(s) { status = s; return this; }, json(b) { body = b; } };
    h[0]({}, res, () => {}); h[1]({}, res, () => {}); await h[2]({}, res);
    assert.deepStrictEqual(calls, ['limit', 'auth']);
    assert.strictEqual(headers['Cache-Control'], 'no-store');
    assert.strictEqual(body.ok, true);
    assert.deepStrictEqual(body.onSale, []);
  });
  console.log(`\n${passed} passed, ${failed} failed`); process.exitCode = failed ? 1 : 0;
})();
