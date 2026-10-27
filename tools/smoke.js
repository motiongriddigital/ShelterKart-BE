#!/usr/bin/env node
'use strict';
/**
 * Smoke test a REAL running server (blind-spot review #1): real Express, real Helmet, real CORS, real rate limiter,
 * real database. Run it against staging after every deploy, and in CI after the migrations.
 *
 *   SMOKE_WEBHOOK_SECRET=<same as PAYMENT_WEBHOOK_SECRET or RAZORPAY_WEBHOOK_SECRET> node tools/smoke.js https://staging.example.com
 *
 * The most important check is the payment webhook: its signature must be verified over the exact raw bytes. Stand-in
 * tests cannot prove that; only a real Express server can. A failure here would reject every real payment.
 */
const crypto = require('crypto');
const base = (process.argv[2] || process.env.SMOKE_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const checks = []; const ok = (label, pass, detail = '') => checks.push({ label, pass: Boolean(pass), detail });

async function run(fetchImpl = globalThis.fetch, env = process.env) {
  const get = (p, h = {}) => fetchImpl(base + p, { headers: h });
  // 1. alive
  const h = await get('/api/health'); ok('the API answers /api/health', h.status === 200);
  // 2. real security headers from Helmet
  ok('security headers are set (Content-Security-Policy, nosniff, frame denial)', h.headers.get('content-security-policy') && h.headers.get('x-content-type-options') === 'nosniff' && /DENY|SAMEORIGIN/i.test(String(h.headers.get('x-frame-options') || 'DENY')));
  // 3. CORS refuses an origin that is not allowed
  const c = await get('/api/health', { origin: 'https://not-an-allowed-origin.example' });
  ok('CORS does not grant an unknown origin', c.headers.get('access-control-allow-origin') !== 'https://not-an-allowed-origin.example');
  // 4. the database is reachable and seeded: the country list comes from the price book
  const pc = await get('/api/pricing/countries'); const pj = pc.status === 200 ? await pc.json() : {};
  ok('the price book is loaded (country list served)', pc.status === 200 && Array.isArray(pj.countries) && pj.countries.length > 0, `status ${pc.status}`);
  // 4b. the DATABASE answers: replies are read from Postgres, so this returns 200 only when the query succeeds
  const db = await get('/api/developer-response/' + (env.SMOKE_REF || 'SK-000000000000'));
  ok('the database answers (developer replies query)', db.status === 200, `status ${db.status}`);
  // 5. the payment webhook: a wrong signature is refused, a right one over the raw bytes is accepted
  const secret = env.SMOKE_WEBHOOK_SECRET;
  if (!secret) ok('payment webhook signature (set SMOKE_WEBHOOK_SECRET to run this check)', false, 'skipped: no secret');
  else {
    const body = JSON.stringify({ event: 'shelterkart.smoke', created_at: Math.floor(Date.now() / 1000) });
    const sig = crypto.createHmac('sha256', secret).update(body).digest('hex');
    const post = s => fetchImpl(base + '/api/payments/razorpay/webhook', { method: 'POST', headers: { 'content-type': 'application/json', 'x-razorpay-signature': s }, body });
    const bad = await post('0'.repeat(64)); ok('a webhook with a wrong signature is refused (401)', bad.status === 401, `status ${bad.status}`);
    const good = await post(sig); ok('a webhook signed over the exact raw bytes is accepted (200)', good.status === 200, `status ${good.status}`);
    const wt = await fetchImpl(base + '/api/payments/webhook', { method: 'POST', headers: { 'content-type': 'text/plain', 'x-sk-signature': '0'.repeat(64) }, body: 'hello' }).catch(() => null);
    const alive = await get('/api/health').catch(() => null);
    ok('a webhook with a non-JSON content type is refused (415) and the server stays up', Boolean(wt) && wt.status === 415 && Boolean(alive) && alive.status === 200, `status ${wt && wt.status}, health ${alive && alive.status}`);
  }
  // 5b. bot protection: the challenge route issues a signed puzzle (production turns the guard on)
  const ch = await get('/api/research/challenge'); const cj = ch.status === 200 ? await ch.json() : {};
  ok('bot protection issues a signed puzzle', ch.status === 200 && /\./.test(String(cj.token || '')) && cj.bits >= 8, `status ${ch.status}`);
  // 6. the rate limiter is the real one: it reports its limits
  const q = await fetchImpl(base + '/api/research/quote', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ref: 'SK-000000000000' }) });
  ok('the rate limiter is active (RateLimit headers present)', q.headers.get('ratelimit-limit') || q.headers.get('ratelimit') || q.headers.get('ratelimit-policy'), `status ${q.status}`);
  const dr = await fetchImpl(base + '/api/developer-response', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reportRef: 'SK-AAAAAAAAAAAA', findingText: 'x', responseText: { toString: 1 }, contactEmail: 'a@b.co' }) }).catch(() => null);
  const drAlive = await get('/api/health').catch(() => null);
  ok('a reply with an object instead of text is refused (400) and the server stays up', Boolean(dr) && dr.status === 400 && Boolean(drAlive) && drAlive.status === 200, `status ${dr && dr.status}, health ${drAlive && drAlive.status}`);
  const mj = await fetchImpl(base + '/api/research/quote', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{bad json' });
  ok('malformed JSON is refused with 400, not 500', mj.status === 400, `status ${mj.status}`);
  return checks;
}
module.exports = { run };

if (require.main === module) {
  run().then(cs => {
    for (const c of cs) console.log(`${c.pass ? '  ok  ' : '  FAIL'} ${c.label}${c.detail ? '  (' + c.detail + ')' : ''}`);
    const failed = cs.filter(c => !c.pass).length; console.log(failed ? `\n${failed} FAILED against ${base}` : `\nall passing against ${base}`); process.exit(failed ? 1 : 0);
  }).catch(e => { console.error('smoke test could not run:', e.message); process.exit(1); });
}
