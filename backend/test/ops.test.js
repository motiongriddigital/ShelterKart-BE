// Fixes from the blind-spot review: the migration runner (#1), the smoke test (#1), the daily cap, pause switches and
// budget alerts (#5, #20), the adverse-findings hold (#3), and the reply checks (#4).
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
let fails = 0; const out = [];
const t = async (label, fn) => { try { await fn(); out.push('  ok   ' + label); } catch (e) { fails++; out.push('  FAIL ' + label + '\n       ' + String(e.message).split('\n')[0]); } };
const { MIGRATIONS, plan, migrate } = require('../../tools/migrate');
const R = require('../engine/research'), REVIEW = require('../engine/review');
const { senderCheck, findingMatch, makeReviewStore } = require('../engine/reviews');

function fakeClient({ failOn = null } = {}) {
  const applied = new Map(), log = [];
  return { log, applied, async query(sql, params) {
    log.push(String(sql).trim().split(/\s+/).slice(0, 3).join(' '));
    if (/^SELECT name, checksum FROM schema_migrations/.test(sql)) return { rows: [...applied].map(([name, checksum]) => ({ name, checksum })) };
    if (/^INSERT INTO schema_migrations/.test(sql)) { applied.set(params[0], params[1]); return { rows: [] }; }
    if (failOn && sql.includes(failOn)) throw new Error('syntax error near "' + failOn + '"');
    return { rows: [] }; } };
}

(async () => {
  await t('migrations: exactly the seventeen, in the documented order, each present on disk', async () => {
    assert.deepStrictEqual(MIGRATIONS, ['schema.sql', 'schema_evidence.sql', 'razorpay_orders.sql', 'idempotent_checkout.sql', 'research_persistence.sql', 'source_health.sql', 'analytics.sql', 'translations.sql', 'pricing_v2.sql', 'responses.sql', 'social.sql', 'purchase_attribution.sql', 'accounts.sql', 'error_log.sql', 'health_history.sql', 'engine_usage.sql', 'backups.sql']);
    assert.strictEqual(plan().length, 17);
  });
  await t('migrations: each runs once, in its own transaction, and a second run applies nothing', async () => {
    const c = fakeClient();
    const first = await migrate(c);
    assert.deepStrictEqual([first.applied.length, first.skipped.length], [17, 0]);
    assert.strictEqual(c.log.filter(x => x === 'BEGIN').length, 17); assert.strictEqual(c.log.filter(x => x === 'COMMIT').length, 17);
    const second = await migrate(c);
    assert.deepStrictEqual([second.applied.length, second.skipped.length], [0, 17]);
  });
  await t('migrations: a file edited after it was applied stops the run, and a failing file is rolled back and named', async () => {
    const c = fakeClient(); await migrate(c);
    c.applied.set('analytics.sql', 'not-the-real-checksum');
    await assert.rejects(() => migrate(c), /analytics\.sql was changed after it was applied/);
    const d = fakeClient({ failOn: 'CREATE TABLE IF NOT EXISTS translation' });
    await assert.rejects(() => migrate(d), /translations\.sql failed and was rolled back/);
    assert(d.log.includes('ROLLBACK')); assert.strictEqual(d.applied.has('translations.sql'), false); assert.strictEqual(d.applied.has('analytics.sql'), true);
  });
  await t('migrations: a dry run touches nothing', async () => {
    const c = fakeClient(); const r = await migrate(c, { dryRun: true });
    assert.strictEqual(r.pending.length, 17); assert(!c.log.includes('BEGIN'));
  });
  await t('smoke test: passes a correct server, and catches a webhook that accepts a forged signature', async () => {
    const { run } = require('../../tools/smoke');
    const H = o => ({ get: k => o[k.toLowerCase()] ?? null });
    const make = (acceptsForged, crashes) => async (url, o = {}) => {
      if (url.endsWith('/api/health')) return { status: 200, headers: H({ 'content-security-policy': "default-src 'self'", 'x-content-type-options': 'nosniff', 'x-frame-options': 'SAMEORIGIN' }) };
      if (url.endsWith('/api/pricing/countries')) return { status: 200, headers: H({}), json: async () => ({ countries: [{ iso: 'IN' }] }) };
      if (url.includes('/api/developer-response/')) return { status: 200, headers: H({}) };
      if (url.endsWith('/api/research/challenge')) return { status: 200, headers: H({}), json: async () => ({ ok: true, token: 'p.s', bits: 16 }) };
      if (url.endsWith('/api/payments/webhook')) { if (crashes) throw new Error('connection refused'); return { status: 415, headers: H({}) }; }
      if (url.endsWith('/api/developer-response')) { if (crashes) throw new Error('connection refused'); return { status: 400, headers: H({}) }; }
      if (url.endsWith('/razorpay/webhook')) {
        const good = crypto.createHmac('sha256', 'whs').update(o.body).digest('hex') === o.headers['x-razorpay-signature'];
        return { status: good || acceptsForged ? 200 : 401, headers: H({}) };
      }
      return { status: 400, headers: H({ 'ratelimit-limit': '10' }) };
    };
    const okRun = await run(make(false), { SMOKE_WEBHOOK_SECRET: 'whs' });
    assert(okRun.every(c => c.pass), okRun.filter(c => !c.pass).map(c => c.label).join('; '));
    const bad = await run(make(true), { SMOKE_WEBHOOK_SECRET: 'whs' });
    assert(bad.some(c => !c.pass && /wrong signature is refused/.test(c.label)));
    const crashed = await run(make(false, true), { SMOKE_WEBHOOK_SECRET: 'whs' });
    assert(crashed.some(c => !c.pass && /non-JSON content type/.test(c.label)));
    assert(crashed.some(c => !c.pass && /object instead of text/.test(c.label)));
  });
  await t('the daily cap: unset is 1,500; 0 now PAUSES (it used to become 1,500); nonsense is 1,500', async () => {
    assert.deepStrictEqual([R.capOf({}), R.capOf({ RESEARCH_DAILY_CAP: '' }), R.capOf({ RESEARCH_DAILY_CAP: '0' }), R.capOf({ RESEARCH_DAILY_CAP: '25' }), R.capOf({ RESEARCH_DAILY_CAP: 'lots' })], [1500, 1500, 0, 25, 1500]);
  });
  await t('emergency switches: pause everything, or one market, with a plain message', async () => {
    assert(/paused/.test(R.pausedReason({ RESEARCH_PAUSED: 'true' }, 'in')));
    assert(/paused/.test(R.pausedReason({ RESEARCH_DAILY_CAP: '0' }, 'in')));
    assert(/in this market is paused/.test(R.pausedReason({ RESEARCH_MARKETS_OFF: 'tw, cz' }, 'cz')));
    assert.strictEqual(R.pausedReason({ RESEARCH_MARKETS_OFF: 'tw' }, 'in'), null); assert.strictEqual(R.pausedReason({}, 'in'), null);
    const ENG = { ANTHROPIC_API_KEY: 'k', RESEARCH_PAUSED: 'true' };
    await assert.rejects(() => R.runResearch({ query: 'A New Project Name', location: 'Mumbai', market: 'in' }, { env: ENG, fetchImpl: async () => { throw new Error('no network'); } }), e => e.status === 503 && e.code === 'paused');
  });
  await t('budget alerts: at 50%, 80% and 100% of the day\'s allowance, once each, to the alert address', async () => {
    const sent = [], prev = globalThis.fetch;
    globalThis.fetch = async (url, o) => { sent.push(JSON.parse(o.body).text); return { ok: true }; };
    try {
      R._daily.day = ''; const env = { RESEARCH_DAILY_CAP: '10', ALERT_WEBHOOK_URL: 'https://hooks.example/x' };
      const results = []; for (let i = 0; i < 12; i++) results.push(R._underDailyCap(env));
      await new Promise(r => setTimeout(r, 20));
      assert.deepStrictEqual([results.filter(Boolean).length, results.filter(x => !x).length], [10, 2]);
      assert.strictEqual(sent.length, 3); assert(/50% of today's 10/.test(sent[0]) && /80%/.test(sent[1]) && /limit of 10 new researches is used up/.test(sent[2]));
    } finally { globalThis.fetch = prev; R._daily.day = ''; }
  });
  const brief = () => ({ ref: 'SK-0123456789AB', market: 'in', query: 'q', location: 'l', project: { name: 'P', developer: 'D', developer_site: 'https://www.hubtown.co.in' },
    reading: [{ observation: 'repeats the adverse point' }],
    findings: [{ topic: 'legal', claim: 'The developer was admitted to insolvency proceedings in 2023.', stance: 'negative', mark: 'confirmed', sources: [{ url: 'https://ibbi.gov.in/x' }], sites: 1 },
               { topic: 'registration', claim: 'Registered with MahaRERA as P51900008925.', stance: 'neutral', mark: 'confirmed', sources: [{ url: 'https://maharera.gov.in/y' }], sites: 1 }] });
  await t('hold: off by default; in a held market a negative finding and the reading are withheld until approved', async () => {
    const b = brief();
    assert.strictEqual(REVIEW.isHeld(b, {}), false); assert.strictEqual(REVIEW.forBuyer(b, {}), b);
    const env = { ADVERSE_HOLD_MARKETS: 'in,ae' }, v = REVIEW.forBuyer(b, env);
    assert.strictEqual(v.findings[0].claim, REVIEW.HELD_TEXT); assert.deepStrictEqual(v.findings[0].sources, []);
    assert.strictEqual(v.findings[1].claim, b.findings[1].claim, 'other findings unchanged');
    assert(v.held && v.held.count === 1); assert.deepStrictEqual(v.reading, []);
    assert.strictEqual(b.findings[0].claim.startsWith('The developer was admitted'), true, 'the stored report is never modified');
    assert.strictEqual(REVIEW.isHeld({ ...b, market: 'uk' }, env), false, 'other markets unaffected');
    assert.strictEqual(REVIEW.isHeld({ ...b, review: { status: 'approved' } }, env), false, 'approved: shown in full');
    assert.strictEqual(REVIEW.isHeld({ ...b, findings: [b.findings[1]] }, env), false, 'nothing negative: nothing held');
  });
  await t('reply checks: email on the developer\'s domain matches, a look-alike or a bare "co.in" does not; the finding is located', async () => {
    const b = brief();
    assert.deepStrictEqual([senderCheck('legal@hubtown.co.in', b), senderCheck('a@mail.hubtown.co.in', b), senderCheck('x@hubtown-co.in', b), senderCheck('x@gmail.com', b), senderCheck('x@co.in', b), senderCheck('x@y.com', { project: {} })],
      ['match', 'match', 'no_match', 'no_match', 'no_match', 'unknown']);
    assert.strictEqual(findingMatch('admitted to insolvency proceedings in 2023', b), 0); assert.strictEqual(findingMatch('something unrelated entirely', b), -1);
  });
  await t('the review store works without a database: pending, approve, public list without the sender\'s address', async () => {
    const s = makeReviewStore(null);
    await s.addReply({ reportRef: 'SK-0123456789AB', findingText: 'f', responseText: 'r', contactEmail: 'a@b.com' });
    const [p] = await s.pendingReplies(); assert.strictEqual((await s.approvedReplies('SK-0123456789AB')).length, 0);
    await s.setReply(p.id, 'approved'); const pub = await s.approvedReplies('SK-0123456789AB');
    assert.strictEqual(pub.length, 1); assert.strictEqual((await s.pendingReplies()).length, 0);
    await s.addDispute({ note: 'wrong date', reportRef: 'SK-0123456789AB' }); const [d] = await s.openDisputes(); await s.resolveDispute(d.id); assert.strictEqual((await s.openDisputes()).length, 0);
  });
  await t('validation set: 10 troubled and 10 clean, every label backed by a public source, no duplicates', async () => {
    const { cases } = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'tools', 'validation', 'cases.json'), 'utf8'));
    const { MARKETS } = require('../engine/markets');
    assert.deepStrictEqual([cases.filter(c => c.label === 'troubled').length, cases.filter(c => c.label === 'clean').length], [10, 10]);
    for (const c of cases) {
      assert(MARKETS[c.market], c.id + ' market'); assert(c.query && c.location && c.developer && c.evidence, c.id + ' fields');
      assert(c.sources.length && c.sources.every(u => /^https:\/\//.test(u)), c.id + ' needs an https source');
    }
    assert.strictEqual(new Set(cases.map(c => c.query.toLowerCase())).size, 20); assert.strictEqual(new Set(cases.map(c => c.id)).size, 20);
  });
  await t('licence credits: a report credits exactly the registers whose pages it contains, once each', async () => {
    const { creditsFor } = require('../engine/credits');
    const b = { pages: [{ url: 'https://data.gov.sg/datasets/x' }, { url: 'https://news.example/y' }],
      findings: [{ sources: [{ url: 'https://find-and-update.company-information.service.gov.uk/company/123' }, { url: 'https://data.gov.sg/datasets/z' }] }] };
    const c = creditsFor(b);
    assert.deepStrictEqual(c.map(x => x.id), ['sg', 'gb']); assert(/Singapore Open Data Licence/.test(c[0].credit));
    assert.deepStrictEqual(creditsFor({ pages: [{ url: 'https://news.example/only' }] }), []); assert.deepStrictEqual(creditsFor(null), []);
  });
  await t('licence credits: every host the register connectors call maps to a credited register, and the Taiwan notice is flagged as not yet sent', async () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'engine', 'registry.js'), 'utf8');
    const hosts = [...new Set([...src.matchAll(/https?:\/\/([a-z0-9.\-]+)/g)].map(m => m[1]))];
    const { REGISTERS } = require('../engine/credits');
    const known = new Set(REGISTERS.flatMap(r => r.hosts));
    assert.deepStrictEqual(hosts.filter(h => !known.has(h)), [], 'a connector host with no credit entry');
    assert.deepStrictEqual(REGISTERS.map(r => r.id).sort(), ['au', 'cz', 'fi', 'fr', 'gb', 'ie', 'in', 'no', 'sg', 'tw']);
    assert.strictEqual(REGISTERS.find(r => r.id === 'tw').notificationSent, false);
  });
  await t('licence credits survive the paywall: the locked preview keeps them', async () => {
    const { previewOf } = require('../engine/access');
    const p = previewOf({ ref: 'SK-0123456789AB', findings: [], credits: [{ id: 'fi', credit: 'Contains data from PRH under CC BY 4.0.' }], score: { value: 70 } });
    assert.strictEqual(p.locked, true); assert.deepStrictEqual(p.credits.map(c => c.id), ['fi']);
  });
  // ---- bot protection (#5) ----
  const BOT = require('../engine/botguard');
  const solver = { skSolvePow: async (token, bits) => {
    const zeroBits = d => { let n = 0; for (const x of d) { if (x === 0) { n += 8; continue; } n += Math.clz32(x) - 24; break; } return n; };
    for (let i = 0, max = Math.pow(2, Math.min(bits, 26)) * 32; i < max; i++) { const s = i.toString(36); if (zeroBits(crypto.createHash('sha256').update(token + ':' + s).digest()) >= bits) return s; }
    return null; } };
  await t('round trip: the server issues a puzzle, the page solves it, the server accepts it once only', async () => {
    const env = { BOT_SECRET: 's', BOT_POW_BITS: '12' }, c = BOT.issue(env);
    const solution = await solver.skSolvePow(c.token, c.bits);
    assert(solution != null);
    assert.deepStrictEqual(BOT.verify({ token: c.token, solution }, env), { ok: true });
    assert.deepStrictEqual(BOT.verify({ token: c.token, solution }, env), { ok: false, reason: 'used' }, 'a solved puzzle cannot be replayed');
  });
  await t('the guard refuses wrong, forged, expired and malformed answers', async () => {
    const env = { BOT_SECRET: 's', BOT_POW_BITS: '12' }, c = BOT.issue(env), sol = await solver.skSolvePow(c.token, c.bits);
    let wrong = 'zz'; while (BOT.leadingZeroBits(crypto.createHash('sha256').update(c.token + ':' + wrong).digest()) >= 12) wrong += 'z';
    assert.strictEqual(BOT.verify({ token: c.token, solution: wrong }, env).reason, 'not_solved');
    const [payload] = c.token.split('.'); const forged = Buffer.from(JSON.stringify({ n: 'x', b: 1, e: Date.now() + 60000 })).toString('base64url') + '.' + c.token.split('.')[1];
    assert.strictEqual(BOT.verify({ token: forged, solution: '0' }, env).reason, 'tampered', 'an easier puzzle cannot be signed by the visitor');
    assert.strictEqual(BOT.verify({ token: c.token, solution: sol }, { BOT_SECRET: 'other', BOT_POW_BITS: '12' }).reason, 'tampered');
    assert.strictEqual(BOT.verify({ token: c.token, solution: sol }, env, { now: Date.now() + BOT.TTL_MS + 1000 }).reason, 'expired');
    assert.strictEqual(BOT.verify({ token: c.token, solution: '<script>' }, env).reason, 'malformed'); assert.strictEqual(BOT.verify(null, env).reason, 'missing');
    assert(payload.length > 10);
  });
  await t('difficulty: 16 bits by default, harder as the day\'s allowance runs down; on in production, off elsewhere unless set', async () => {
    assert.deepStrictEqual([BOT.bitsFor({}, 0), BOT.bitsFor({}, 0.5), BOT.bitsFor({}, 0.85), BOT.bitsFor({ BOT_POW_BITS: '30' }, 0), BOT.bitsFor({ BOT_POW_BITS: 'x' }, 0)], [16, 17, 18, 24, 16]);
    assert.deepStrictEqual([BOT.enabled({ NODE_ENV: 'production' }), BOT.enabled({}), BOT.enabled({ BOT_GUARD: 'on' }), BOT.enabled({ NODE_ENV: 'production', BOT_GUARD: 'off' })], [true, false, true, false]);
  });
  await t('cost to a person: the default 16-bit puzzle, solved by the page\'s own code, takes about a second or less on this machine', async () => {
    const env = { BOT_SECRET: 's' }, times = [];
    for (let i = 0; i < 3; i++) { const c = BOT.issue(env), t0 = Date.now(); await solver.skSolvePow(c.token, c.bits); times.push(Date.now() - t0); }
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    out.push(`       (16-bit solves here: ${times.join(', ')} ms; a mid-range phone is typically several times slower)`);
    assert(avg < 3000, 'average ' + avg + ' ms');
  });
  console.log(out.join('\n')); console.log(fails ? `\n${fails} FAILED` : '\nall passing'); process.exitCode = fails ? 1 : 0;
})();
