'use strict';
// The AI engine over real sockets: the real Claude adapter, router, meter and cost tracker talk HTTP to the stand-in server, which keeps
// its own ledger of what it billed. Each scenario checks the engine's accounting against that ledger, and counts the requests made.
const assert = require('assert');
const anthropic = require('../../../backend/engines/anthropic');
const engines = require('../../../backend/engines');
const { costedEngines, addStageCost, stageTotals } = require('../../../backend/engine/jobCosts');
const STUB = 'http://stub:8080';
const env = { ANTHROPIC_API_KEY: 'sandbox-not-a-real-key', ANTHROPIC_API_URL: STUB + '/v1/messages', ANTHROPIC_RETRY_WAIT_MS: '0', NODE_ENV: 'test' };
let passed = 0, failed = 0;
const say = (ok, name, extra = '') => { ok ? passed++ : failed++; console.log((ok ? '  ok   ' : '  FAIL ') + name + (extra ? '\n       ' + extra : '')); };
const ledger = async () => (await fetch(STUB + '/__ledger')).json();
const script = steps => fetch(STUB + '/__script', { method: 'POST', body: JSON.stringify(steps) });
async function scenario(name, steps, run, check) {
  await script(steps);
  let out, err; try { out = await run(); } catch (e) { err = e; }
  const l = await ledger();
  try { check({ out, err, l }); say(true, name, `requests ${l.requests} (ok ${l.ok}, failed ${l.failed}, dropped ${l.dropped}); stub billed ${l.billedInput}+${l.billedOutput} tokens`); }
  catch (e) { say(false, name, e.message + ' | ledger ' + JSON.stringify(l)); }
}
const P = (i, o) => ({ kind: 'pause', input: i, output: o }), D = (i, o, text) => ({ kind: 'done', input: i, output: o, text });
const search = (extra = {}) => anthropic.search({ prompt: 'p', maxUses: 5, rounds: 12, ...extra }, { env, fetchImpl: fetch });

(async () => {
  console.log('engine over real sockets (stand-in Claude API, its own ledger)');
  await scenario('a three-round lead: the engine counts exactly what the server billed', [P(10000, 500), P(20000, 600), D(30000, 900, '{"ok":1}')], search,
    ({ out, l }) => { assert.deepStrictEqual(out.usage, { input: l.billedInput, output: l.billedOutput }); assert.strictEqual(out.searches, 2); assert.strictEqual(l.requests, 3); });
  await scenario('a 429 with Retry-After is retried once, and the failed request is not in the bill', [{ status: 429, retryAfter: 0 }, D(12000, 800)], search,
    ({ out, l }) => { assert.strictEqual(l.requests, 2); assert.strictEqual(l.failed, 1); assert.deepStrictEqual(out.usage, { input: 12000, output: 800 }); });
  await scenario('a dropped connection is retried once', [{ drop: true }, D(12000, 800)], search,
    ({ out, l }) => { assert.strictEqual(l.requests, 2); assert.strictEqual(l.dropped, 1); assert.strictEqual(out.text, '{"ok":true}'); });
  await scenario('a failure after paid rounds: the spend of those rounds is on the error, equal to the server ledger', [P(10000, 500), P(20000, 600), { status: 400 }], search,
    ({ err, l }) => { assert(err, 'should fail'); assert.deepStrictEqual(err.usage, { input: l.billedInput, output: l.billedOutput }); assert.strictEqual(err.searches, 2); assert.strictEqual(l.requests, 3, 'a 400 is not retried'); });
  await scenario('a server error in the middle of a lead is retried and the paid rounds are kept', [P(10000, 500), P(20000, 600), { status: 503 }, D(30000, 900)], search,
    ({ out, l }) => { assert.deepStrictEqual(out.usage, { input: l.billedInput, output: l.billedOutput }); assert.strictEqual(l.requests, 4); assert.strictEqual(l.failed, 1); });
  await scenario('an outage: two errors in a row stop at two requests and bill nothing', [{ status: 500 }, { status: 500 }, D()], search,
    ({ err, l }) => { assert(err); assert.strictEqual(l.requests, 2); assert.strictEqual(l.billedInput + l.billedOutput, 0); });
  await scenario('a bad key (401) is one request, never retried', [{ status: 401 }, D()], search,
    ({ err, l }) => { assert(err); assert.strictEqual(l.requests, 1); });
  await scenario('a reply cut off at the token limit is reported as cut and still counted', [{ kind: 'cut', input: 9000, output: 16000 }], () => search({ maxTokens: 16000 }),
    ({ out, l }) => { assert.strictEqual(out.stop, 'max_tokens'); assert.strictEqual(out.usage.output, l.billedOutput); });
  await scenario('through the router and the job cost tracker: a half-failed lead is priced into the stage costs', [P(10000, 500), { status: 400 }], async () => {
    const stages = {}, wrapped = costedEngines(engines, (usd, info) => addStageCost(stages, usd, info));
    let res; try { res = await wrapped.runEach('research', 'search', { prompt: 'p', maxUses: 5, rounds: 12, stage: 'leads' }, { env, max: 1 }); } catch (e) { res = { thrown: e.message }; }
    return { res, total: stageTotals(stages) };
  }, ({ out, l }) => { assert(out.total.length && out.total[0].stage === 'leads' && out.total[0].usd > 0, JSON.stringify(out.total)); assert.strictEqual(l.billedInput, 10000); });
  console.log(`\n${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
})();
