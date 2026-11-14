'use strict';
const assert = require('assert');
const { REASONS, refusal, failureNote, isReason, createDayCounters, utcMidnight } = require('../engine/previewStates');
let passed = 0, failed = 0;
async function t(name, fn) { try { await fn(); passed++; console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); } }

(async () => {
  console.log('the reasons');
  await t('every reason has a status, a code and a sentence, and the existing codes are unchanged', () => {
    for (const [name, r] of Object.entries(REASONS)) { assert(r.status === 429 || r.status === 503, name); assert(r.code && r.error, name); }
    assert.deepStrictEqual(['daily_budget', 'daily_cap', 'market_cap', 'paused'].map(k => REASONS[k].code), ['paused', 'paused', 'paused', 'paused']);
    assert.strictEqual(REASONS.quota.code, 'quota'); assert.strictEqual(REASONS.quota.status, 429);
    assert.strictEqual(REASONS.busy.status, 429); assert.strictEqual(REASONS.busy.code, 'busy');
    assert([REASONS.daily_budget.status, REASONS.daily_cap.status, REASONS.market_cap.status, REASONS.paused.status].every(s => s === 503));
  });
  await t('the sentences that existed before are the same words', () => {
    assert.strictEqual(REASONS.daily_cap.error, 'New investigations are paused for today. Projects already investigated are still available.');
    assert.strictEqual(REASONS.daily_budget.error, REASONS.daily_cap.error);
    assert.strictEqual(REASONS.market_cap.error, 'New investigations in this market are paused for today. Projects already investigated are still available.');
    assert.strictEqual(REASONS.busy.error, 'Many investigations are running. Please try again in a few minutes.');
    assert.strictEqual(REASONS.quota.error, 'You have reached today\'s limit of new investigations. Projects already investigated are still open to you.');
  });
  await t('a refusal has the shape the website reads: ok false, code, reason, error and a retry time where one is known', () => {
    const now = Date.parse('2026-11-14T10:30:00Z');
    const r = refusal('daily_budget', { now });
    assert.strictEqual(r.status, 503);
    assert.deepStrictEqual(r.body, { ok: false, code: 'paused', reason: 'daily_budget', error: REASONS.daily_budget.error, retryAt: '2026-11-15T00:00:00.000Z' });
    const b = refusal('busy', { now }); assert.strictEqual(b.status, 429); assert.strictEqual(b.body.retryAt, '2026-11-14T10:33:00.000Z');
    const p = refusal('paused', { now, text: 'Research is paused for maintenance.' });
    assert.strictEqual(p.body.error, 'Research is paused for maintenance.'); assert(!('retryAt' in p.body));
  });
  await t('a failed preview says engines unavailable and when to try again, and an unknown reason falls back to it', () => {
    const now = Date.parse('2026-11-14T10:30:00Z');
    assert.deepStrictEqual(failureNote('engines_unavailable', { now }), { reason: 'engines_unavailable', error: REASONS.engines_unavailable.error, retryAt: '2026-11-14T10:35:00.000Z' });
    assert.strictEqual(failureNote(undefined, { now }).reason, 'engines_unavailable'); assert.strictEqual(failureNote('nonsense', { now }).reason, 'engines_unavailable');
    assert(/Nothing was charged/.test(REASONS.engines_unavailable.error));
  });
  await t('an unknown reason is refused loudly, not answered with a guess', () => { assert.throws(() => refusal('because'), /unknown preview reason/); assert(isReason('quota') && !isReason('toString') && !isReason('__proto__')); });

  console.log('the clock');
  await t('the daily limits retry at the next UTC midnight, including the last second of a day and a month end', () => {
    assert.strictEqual(utcMidnight(Date.parse('2026-11-14T23:59:59.999Z')), '2026-11-15T00:00:00.000Z');
    assert.strictEqual(utcMidnight(Date.parse('2026-11-14T00:00:00.000Z')), '2026-11-15T00:00:00.000Z');
    assert.strictEqual(utcMidnight(Date.parse('2026-11-30T12:00:00Z')), '2026-12-01T00:00:00.000Z');
    assert.strictEqual(utcMidnight(Date.parse('2026-12-31T12:00:00Z')), '2027-01-01T00:00:00.000Z');
  });

  console.log('the day\'s counters');
  await t('counts starts, refusals by reason and failures, and starts again each UTC day', () => {
    const clock = { t: Date.parse('2026-11-14T22:00:00Z') }; const c = createDayCounters(() => clock.t);
    c.started(); c.started(); c.refused('daily_cap'); c.refused('daily_cap'); c.refused('busy'); c.failed();
    assert.deepStrictEqual(c.snapshot(), { day: '2026-11-14', started: 2, refused: { daily_cap: 2, busy: 1 }, failed: 1 });
    clock.t = Date.parse('2026-11-15T00:00:01Z');
    assert.deepStrictEqual(c.snapshot(), { day: '2026-11-15', started: 0, refused: {}, failed: 0 });
    c.refused('quota'); assert.deepStrictEqual(c.snapshot().refused, { quota: 1 });
  });
  await t('a snapshot is a copy: changing it does not change the counters', () => {
    const c = createDayCounters(); c.refused('busy'); const s = c.snapshot(); s.refused.busy = 99; assert.strictEqual(c.snapshot().refused.busy, 1);
  });

  console.log(`\n${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
})();
