'use strict';
const assert = require('assert');
const { fxStatus, report, summaryLines } = require('../engine/readiness');
const PRICING = require('../pricing');
let passed = 0, failed = 0;
async function t(name, fn) { try { await fn(); passed++; console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e && e.message)); } }
const day = 864e5, NOW = Date.parse('2026-11-12T12:00:00Z');
const book = asOf => ({ book: { fx: { asOf, indicative: ['CAD', 'TWD'], perUsd: { USD: 1 } } } });
const data = PRICING.load({});

(async () => {
  await t('rates within the limit are fresh, the day after the limit they are stale (45 days by default)', () => {
    assert.strictEqual(fxStatus(book('2026-09-28'), {}, NOW).stale, false);
    assert.strictEqual(fxStatus(book('2026-09-28'), {}, NOW).ageDays, 45);
    assert.strictEqual(fxStatus(book('2026-09-27'), {}, NOW).stale, true); assert.strictEqual(fxStatus(book('2026-09-27'), {}, NOW).ageDays, 46);
  });
  await t('the limit is a setting, and a bad value falls back to 45', () => {
    assert.strictEqual(fxStatus(book('2026-09-27'), { FX_MAX_AGE_DAYS: '60' }, NOW).stale, false);
    for (const v of ['abc', '0', '-5', '']) assert.strictEqual(fxStatus(book('2026-09-27'), { FX_MAX_AGE_DAYS: v }, NOW).maxAgeDays, 45, v);
  });
  await t('a book with no date or an unreadable one counts as stale, and a future date is age zero, not negative', () => {
    assert.strictEqual(fxStatus({ book: { fx: {} } }, {}, NOW).stale, true); assert.strictEqual(fxStatus({ book: { fx: { asOf: 'yesterday' } } }, {}, NOW).ageDays, null); assert.strictEqual(fxStatus({}, {}, NOW).stale, true);
    assert.strictEqual(fxStatus(book('2027-01-01'), {}, NOW).ageDays, 0);
  });
  await t('a stale table says what to do, and which currencies are only indicative', () => {
    const s = fxStatus(book('2026-06-26'), {}, NOW);
    assert.strictEqual(s.ageDays, 139); assert.match(s.missing[0], /tools\/fetch_fx\.js/); assert.deepStrictEqual(s.indicative, ['CAD', 'TWD']); assert.deepStrictEqual(fxStatus(book('2026-11-01'), {}, NOW).missing, []);
  });
  await t('the readiness report carries it, and the summary names a stale table (and says nothing when fresh)', () => {
    const r = report({}, data); assert.ok(r.fx && 'stale' in r.fx && r.fx.asOf === data.book.fx.asOf);
    const stale = { ...data, book: { ...data.book, fx: { ...data.book.fx, asOf: '2020-01-01' } } }, fresh = { ...data, book: { ...data.book, fx: { ...data.book.fx, asOf: new Date().toISOString().slice(0, 10) } } };
    assert.ok(summaryLines({}, stale).some(l => /exchange rates are \d+ days old/.test(l))); assert.ok(!summaryLines({}, fresh).some(l => /exchange rates/.test(l)));
  });
  await t('the active price book really carries a date the check can read', () => { assert.ok(Number.isFinite(Date.parse(data.book.fx.asOf)), String(data.book.fx.asOf)); });
  console.log(`\n${passed} passed, ${failed} failed`); process.exitCode = failed ? 1 : 0;
})();
