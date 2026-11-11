const assert = require('assert');
const P = require('../pricing');
let fails = 0; const results = [];
const t = async (id, label, fn) => { try { await fn(); results.push(['ok', id, label]); } catch (e) { fails++; results.push(['FAIL', id, label + '\n       ' + String(e && e.message).split('\n').slice(0, 4).join('\n       ')]); } };

const BASE = { NODE_ENV: 'production' };
const DODO = { DODO_API_KEY: 'k', DODO_WEBHOOK_KEY: 'w', MOR_PRODUCTS: JSON.stringify({ USD: 'prod_usd' }) };
const state = env => {
  const d = P.load({ ...BASE, ...env }); const on = [], off = {};
  for (const c of d.countries.values()) {
    if (c.blocked) continue;
    const s = P.saleStatus(d, c.iso);
    if (s.onSale) on.push(c.iso); else (off[s.reason] = off[s.reason] || []).push(c.iso);
  }
  return { d, on: on.sort(), off };
};
const NOT_REQUIRED = ['AU', 'CA', 'CH', 'NO', 'NZ', 'SG', 'US'];
const REGISTRATION = ['AT', 'BE', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR', 'GB', 'GR', 'HR', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'SE', 'SI', 'SK'];
const UNVERIFIED = ['AE', 'BH', 'BR', 'JP', 'MX', 'MY', 'OM', 'PH', 'QA', 'SA', 'TH', 'TW', 'ZA'];

(async () => {
  await t('S1', 'with nothing configured no country sells and every closed country has a reason', async () => {
    const s = state({});
    assert.deepStrictEqual(s.on, []);
    assert.deepStrictEqual(s.off.registration_missing, ['IN']);
    assert.deepStrictEqual(s.off.registration_required.slice().sort(), REGISTRATION);
    assert.deepStrictEqual(s.off.unverified.slice().sort(), UNVERIFIED);
    assert.deepStrictEqual(Object.keys(s.off).sort(), ['no_payment_route', 'registration_missing', 'registration_required', 'unverified']);
  });
  await t('S2', 'the GSTIN alone opens India and nothing else', async () => {
    const s = state({ GSTIN: '27AAAAA0000A1Z5' });
    assert.deepStrictEqual(s.on, ['IN']);
    assert.strictEqual(P.saleStatus(s.d, 'IN').taxBy, 'shelterkart');
  });
  await t('S3', 'Razorpay International without the GSTIN opens the no-tax countries but not India', async () => {
    const s = state({ RAZORPAY_INTERNATIONAL: 'true' });
    assert.ok(!s.on.includes('IN'));
    assert.deepStrictEqual(s.on, [...NOT_REQUIRED, 'HK'].sort());
  });
  await t('S4', 'GSTIN plus Razorpay International sells in exactly nine markets; registration and unverified countries stay closed', async () => {
    const s = state({ GSTIN: '27AAAAA0000A1Z5', RAZORPAY_INTERNATIONAL: 'true' });
    assert.deepStrictEqual(s.on, ['IN', ...NOT_REQUIRED, 'HK'].sort());
    assert.deepStrictEqual(s.off.registration_required.slice().sort(), REGISTRATION);
    assert.deepStrictEqual(s.off.unverified.slice().sort(), UNVERIFIED);
  });
  await t('S5', 'a configured VAT registration opens that one country through Razorpay International', async () => {
    const s = state({ GSTIN: '27AAAAA0000A1Z5', RAZORPAY_INTERNATIONAL: 'true', UK_VAT_NO: 'GB123456789' });
    assert.ok(s.on.includes('GB'));
    assert.strictEqual(s.on.length, 10);
    assert.ok(!s.on.includes('FR'));
  });
  await t('S6', 'the merchant of record opens every unblocked country except India, and it is the seller', async () => {
    const s = state({ GSTIN: '27AAAAA0000A1Z5', RAZORPAY_INTERNATIONAL: 'true', ...DODO });
    assert.deepStrictEqual(s.off, {});
    for (const iso of [...REGISTRATION, ...UNVERIFIED, ...NOT_REQUIRED, 'HK']) assert.strictEqual(P.saleStatus(s.d, iso).taxBy, 'merchant_of_record', iso);
    assert.strictEqual(P.saleStatus(s.d, 'IN').taxBy, 'shelterkart');
  });
  await t('S7', 'merchant keys without a product for the currency do not open anything', async () => {
    const s = state({ GSTIN: '27AAAAA0000A1Z5', DODO_API_KEY: 'k', DODO_WEBHOOK_KEY: 'w' });
    assert.deepStrictEqual(s.on, ['IN']);
  });
  await t('S8', 'India is never served by the merchant of record', async () => {
    const s = state({ ...DODO });
    assert.ok(!s.on.includes('IN'));
    assert.strictEqual(P.saleStatus(s.d, 'IN').reason, 'registration_missing');
  });
  await t('S9', 'blocked countries never sell, whatever is configured', async () => {
    const d = P.load({ ...BASE, GSTIN: 'x', RAZORPAY_INTERNATIONAL: 'true', ...DODO });
    const blocked = [...d.countries.values()].filter(c => c.blocked).map(c => c.iso);
    assert.ok(blocked.length >= 6);
    for (const iso of blocked) assert.deepStrictEqual(P.saleStatus(d, iso), { onSale: false, reason: 'blocked' });
  });
  await t('S10', 'the tax gate cannot be switched off in production, only outside it', async () => {
    const prod = state({ TAX_GATE: 'off', RAZORPAY_INTERNATIONAL: 'true' });
    assert.ok(!prod.on.includes('GB') && !prod.on.includes('AE'));
    const dev = P.load({ NODE_ENV: 'development', TAX_GATE: 'off', RAZORPAY_INTERNATIONAL: 'true' });
    assert.strictEqual(P.saleStatus(dev, 'GB').onSale, true);
  });
  await t('S11', 'the payment route data keeps India on Razorpay and foreign countries off it until activated', async () => {
    const d = P.load({ ...BASE, GSTIN: 'x' });
    assert.strictEqual(P.routeFor(d, 'IN', 'INR').provider, 'razorpay');
    assert.strictEqual(P.routeFor(d, 'US', 'USD'), null);
  });

  for (const [s, id, l] of results) console.log(`  ${s === 'ok' ? 'ok  ' : 'FAIL'} ${id.padEnd(4)} ${l}`);
  console.log(fails ? `\n${fails} FAILED` : '\nall passing'); process.exitCode = fails ? 1 : 0;
})();
