'use strict';

const PAUSED_TODAY = 'New investigations are paused for today. Projects already investigated are still available.';

const utcMidnight = now => new Date(Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate() + 1)).toISOString();
const inMinutes = n => now => new Date(now + n * 60000).toISOString();

const REASONS = {
  engines_unavailable: { status: 503, code: 'engines_unavailable', error: 'We could not run this search just now. Nothing was charged. Please try again in a few minutes.', retryAt: inMinutes(5) },
  daily_budget: { status: 503, code: 'paused', error: PAUSED_TODAY, retryAt: utcMidnight },
  daily_cap: { status: 503, code: 'paused', error: PAUSED_TODAY, retryAt: utcMidnight },
  market_cap: { status: 503, code: 'paused', error: 'New investigations in this market are paused for today. Projects already investigated are still available.', retryAt: utcMidnight },
  paused: { status: 503, code: 'paused', error: 'New investigations are paused. Projects already investigated are still available.', retryAt: null },
  busy: { status: 429, code: 'busy', error: 'Many investigations are running. Please try again in a few minutes.', retryAt: inMinutes(3) },
  quota: { status: 429, code: 'quota', error: 'You have reached today\'s limit of new investigations. Projects already investigated are still open to you.', retryAt: utcMidnight },
};

const isReason = r => Object.prototype.hasOwnProperty.call(REASONS, r);

function noteOf(reason, { now = Date.now(), text } = {}) {
  const r = REASONS[reason];
  const retryAt = r.retryAt ? r.retryAt(now) : null;
  return { reason, error: text || r.error, ...(retryAt ? { retryAt } : {}) };
}

function refusal(reason, opts = {}) {
  if (!isReason(reason)) throw new Error('unknown preview reason: ' + reason);
  const r = REASONS[reason];
  return { status: r.status, body: { ok: false, code: r.code, ...noteOf(reason, opts) } };
}

const failureNote = (reason = 'engines_unavailable', opts = {}) => noteOf(isReason(reason) ? reason : 'engines_unavailable', opts);

function createDayCounters(now = () => Date.now()) {
  const day = () => new Date(now()).toISOString().slice(0, 10);
  let cur = { day: day(), started: 0, refused: {}, failed: 0 };
  const roll = () => { if (cur.day !== day()) cur = { day: day(), started: 0, refused: {}, failed: 0 }; return cur; };
  return {
    started() { roll().started++; },
    refused(reason) { const c = roll(); c.refused[reason] = (c.refused[reason] || 0) + 1; },
    failed() { roll().failed++; },
    snapshot() { const c = roll(); return { day: c.day, started: c.started, refused: { ...c.refused }, failed: c.failed }; },
  };
}

module.exports = { REASONS, refusal, failureNote, isReason, createDayCounters, utcMidnight, PAUSED_TODAY };
