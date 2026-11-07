'use strict';
/**
 * The Polish (KRS) and United States (SEC EDGAR) register connectors.
 *  - Poland is tested against a REAL extract (PKP S.A., KRS 0000019193, read from the live API on 7 Nov 2026, board section removed).
 *    Lookup is by KRS number only; a NIP, a wrong number, or an extract for another number is never accepted; no person is ever named.
 *  - United States is tested against the SEC's documented format as we understand it, NOT a live response: the field names have not been
 *    seen by us yet, so these tests prove the guards (no declared identity, no match, missing fields) and not the real shape.
 */
const assert = require('assert');
const fs = require('fs'), path = require('path');
const { CONNECTORS } = require('../engine/registry');
const MARKETS = require('../engine/markets').MARKETS;
const HEALTH = require('../engine/health');
let passed = 0, failed = 0;
async function t(name, fn) { try { await fn(); passed++; console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); } }
const KRS = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'krs-0000019193.json'), 'utf8'));
const clone = o => JSON.parse(JSON.stringify(o));
const reply = (status, body) => ({ status, json: async () => body });
const official = u => /^https:\/\/(api-krs\.ms\.gov\.pl|www\.sec\.gov|data\.sec\.gov)\//.test(u);

(async () => {
  console.log('\nPoland (KRS)');
  const pl = CONNECTORS.pl;
  const asked = [];
  const httpKrs = (body = KRS, status = 200) => async url => { asked.push(url); return reply(status, body); };
  await t('a KRS number gets one request, to the official host, for the entrepreneurs register', async () => {
    asked.length = 0;
    await pl.lookup('PKP', { http: httpKrs(), ids: ['0000019193'] });
    assert.deepStrictEqual(asked, ['https://api-krs.ms.gov.pl/api/krs/OdpisAktualny/0000019193?rejestr=P&format=json']);
  });
  await t('findings from the real extract: identity, share capital, latest financial statement, latest entry', async () => {
    const r = await pl.lookup('PKP', { http: httpKrs(), ids: ['KRS 0000019193'] });
    assert.strictEqual(r.match.id, '0000019193'); assert.strictEqual(r.match.name, 'POLSKIE KOLEJE PAŃSTWOWE SPÓŁKA AKCYJNA');
    const by = id => r.findings.find(f => f.id === id).claim;
    assert(/joint-stock company \(S\.A\.\)/.test(by('r1')) && /registered 11 June 2001/.test(by('r1')) && /seat WARSZAWA, mazowieckie/.test(by('r1')), by('r1'));
    assert(/10,150,715,600 PLN/.test(by('r2')), by('r2'));
    assert(/filed on 9 July 2026, for the period OD 01\.01\.2025 DO 31\.12\.2025/.test(by('r3')), by('r3'));
    assert(/dated 8 October 2026 \(entry number 216\)/.test(by('r4')), by('r4'));
    assert(r.findings.every(f => f.lane === 'registry' && f.kind === 'fact' && f.urls.every(official)));
  });
  await t('nothing in a finding names a person, and the extract that was tested has no board section', async () => {
    const r = await pl.lookup('PKP', { http: httpKrs(), ids: ['0000019193'] });
    assert(!KRS.odpis.dane.dzial2);
    assert(r.findings.every(f => !/\*{3}|prokur|zarz[aą]d|board|director/i.test(f.claim)));
  });
  await t('a healthy extract is never described as "all clear": no insolvency or removal claim either way', async () => {
    const r = await pl.lookup('PKP', { http: httpKrs(), ids: ['0000019193'] });
    assert(!r.findings.some(f => f.id === 'r5'));
    assert(r.findings.every(f => !/no (insolvency|bankruptcy|liquidation)|not (in|under) (insolvency|liquidation)/i.test(f.claim)));
  });
  await t('an extract with a non-empty liquidation, bankruptcy or removal entry is flagged, with a pointer to read it', async () => {
    for (const key of ['likwidacja', 'upadlosc', 'wykreslenie']) {
      const x = clone(KRS); x.odpis.dane.dzial6[key] = [{ opis: 'x' }];
      const r = await pl.lookup('PKP', { http: httpKrs(x), ids: ['0000019193'] });
      assert(/removal from the register, liquidation, bankruptcy, restructuring or suspension/.test(r.findings.find(f => f.id === 'r5').claim), key);
    }
    const empty = clone(KRS); empty.odpis.dane.dzial6.likwidacja = [];
    assert(!(await pl.lookup('PKP', { http: httpKrs(empty), ids: ['0000019193'] })).findings.some(f => f.id === 'r5'));
  });
  await t('no KRS number: nothing is requested and the research notes say so', async () => {
    asked.length = 0;
    const r = await pl.lookup('PKP', { http: httpKrs(), ids: [] });
    assert.strictEqual(r.note, 'no-krs'); assert.strictEqual(r.match, null); assert.strictEqual(asked.length, 0);
  });
  await t('a NIP or REGON is never sent as a KRS number', async () => {
    asked.length = 0;
    for (const id of ['5250000251', '00012680100000', '012680100', 'L12345MH2000PLC123456', '19193']) assert.strictEqual((await pl.lookup('PKP', { http: httpKrs(), ids: [id] })).note, 'no-krs', id);
    assert.strictEqual(asked.length, 0);
  });
  await t('an extract for another number than the one asked is refused', async () => {
    const x = clone(KRS); x.odpis.naglowekA.numerKRS = '0000000001';
    const r = await pl.lookup('PKP', { http: httpKrs(x), ids: ['0000019193'] });
    assert.strictEqual(r.match, null); assert.deepStrictEqual(r.findings, []);
  });
  await t('not found, an error status, or a body that is not an extract: no match and no claim', async () => {
    for (const [body, status] of [[{}, 404], [{}, 500], [{}, 200], [{ odpis: {} }, 200], [null, 200]])
      assert.strictEqual((await pl.lookup('PKP', { http: httpKrs(body, status), ids: ['0000019193'] })).match, null);
  });
  await t('missing optional parts produce fewer findings, not wrong ones', async () => {
    const x = clone(KRS); delete x.odpis.dane.dzial1.kapital; delete x.odpis.dane.dzial3; delete x.odpis.naglowekA.dataOstatniegoWpisu;
    const r = await pl.lookup('PKP', { http: httpKrs(x), ids: ['0000019193'] });
    assert.deepStrictEqual(r.findings.map(f => f.id), ['r1']);
  });
  await t('Poland is a market with this register, found by its canary, and its host is allowed', () => {
    assert.strictEqual(MARKETS.pl.registry, 'pl'); assert.strictEqual(pl.byIdOnly, true); assert.deepStrictEqual(pl.hosts, ['api-krs.ms.gov.pl']);
    assert.deepStrictEqual(HEALTH.CANARIES.pl, { name: 'PKP S.A.', ids: ['0000019193'], expectId: '0000019193' });
  });

  console.log('\nUnited States (SEC EDGAR)');
  const us = CONNECTORS.us;
  const UA = 'ShelterKart Research research@example.test';
  const TICKERS = { 0: { cik_str: 794170, ticker: 'TOL', title: 'TOLL BROTHERS, INC.' }, 1: { cik_str: 1, ticker: 'ZZ', title: 'Toll Gate Foods Corp' } };
  const SUB = { cik: '0000794170', name: 'TOLL BROTHERS, INC.', sicDescription: 'Operative Builders', stateOfIncorporationDescription: 'DE',
    filings: { recent: { form: ['8-K', '10-Q', '10-K'], filingDate: ['2026-09-01', '2026-08-28', '2025-12-19'] } } };
  const seen = [];
  const httpSec = (over = {}) => async (url, opts) => {
    seen.push({ url, ua: opts && opts.headers && opts.headers['user-agent'] });
    if (url.endsWith('company_tickers.json')) return reply(over.tickersStatus || 200, over.tickers || TICKERS);
    return reply(over.subStatus || 200, over.sub || SUB);
  };
  await t('without a declared identity nothing is sent', async () => {
    for (const env of [{}, { SEC_USER_AGENT: '' }, { SEC_USER_AGENT: 'just-a-name' }, { SEC_USER_AGENT: 'no-space@example.test' }]) {
      seen.length = 0;
      const r = await us.lookup('Toll Brothers', { http: httpSec(), env });
      assert(r.skipped && !r.match); assert.strictEqual(seen.length, 0);
    }
  });
  await t('with a declared identity: two requests, both carrying it, to the SEC hosts only', async () => {
    seen.length = 0;
    const r = await us.lookup('Toll Brothers Inc', { http: httpSec(), env: { SEC_USER_AGENT: UA } });
    assert.strictEqual(seen.length, 2); assert(seen.every(x => x.ua === UA && official(x.url)));
    assert.strictEqual(seen[1].url, 'https://data.sec.gov/submissions/CIK0000794170.json');
    assert.strictEqual(r.match.id, '0000794170'); assert(r.findings.every(f => f.urls.every(official)));
  });
  await t('findings: public reporting company, industry, state, latest 10-K and 10-Q', async () => {
    const r = await us.lookup('Toll Brothers Inc', { http: httpSec(), env: { SEC_USER_AGENT: UA } });
    assert(/public reporting company, industry: Operative Builders, incorporated in DE/.test(r.findings[0].claim), r.findings[0].claim);
    assert(/10-K\) as filed on 19 December 2025, and its latest quarterly report \(Form 10-Q\) on 28 August 2026/.test(r.findings[1].claim), r.findings[1].claim);
  });
  await t('THE NAME-ALIKE TRAP: "Toll" alone does not match; an unlisted (private) developer is simply not found', async () => {
    assert.strictEqual((await us.lookup('Toll', { http: httpSec(), env: { SEC_USER_AGENT: UA } })).match, null);
    assert.strictEqual((await us.lookup('Hudson Yards Private Developer LLC', { http: httpSec(), env: { SEC_USER_AGENT: UA } })).match, null);
  });
  await t('a submissions record for another CIK than the one asked, or with no name, is refused', async () => {
    assert.strictEqual((await us.lookup('Toll Brothers Inc', { http: httpSec({ sub: { ...SUB, cik: '0000000001' } }), env: { SEC_USER_AGENT: UA } })).match, null);
    assert.strictEqual((await us.lookup('Toll Brothers Inc', { http: httpSec({ sub: { cik: '794170' } }), env: { SEC_USER_AGENT: UA } })).match, null);
  });
  await t('missing or odd fields give fewer findings, never a wrong one; error statuses give no match', async () => {
    const r = await us.lookup('Toll Brothers Inc', { http: httpSec({ sub: { cik: '794170', name: 'TOLL BROTHERS, INC.', filings: { recent: { form: 'oops', filingDate: [3] } } } }), env: { SEC_USER_AGENT: UA } });
    assert.deepStrictEqual(r.findings.map(f => f.id), ['r1']);
    for (const over of [{ tickersStatus: 403 }, { subStatus: 404 }]) assert.strictEqual((await us.lookup('Toll Brothers Inc', { http: httpSec(over), env: { SEC_USER_AGENT: UA } })).match, null);
  });
  await t('the US register stays unconfirmed until its canary has found a company: it needs the identity to run', () => {
    assert.strictEqual(MARKETS.us.registry, 'us'); assert.deepStrictEqual(HEALTH.CANARIES.us.needs, ['SEC_USER_AGENT']);
    assert(!HEALTH.CANARIES.us.expectId, 'no expected id was read from the source');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
