'use strict';
// The register connectors against the REAL services, from inside the sandbox: only what the firewall allows can leave, and this script
// first proves that. Poland: the live canary and a lookup. Latvia: the real daily file through the real loader into the sandbox database,
// then lookups, then a second run that must cost one request. The US register is skipped (it needs an identity we have not chosen).
const B = p => require('../../../backend/' + p);
const { Pool } = B('node_modules/pg');
const { guardedFetch } = B('connectors/egress');
const { makeRegistryHttp } = B('engine/registryHttp');
const { CONNECTORS } = B('engine/registry');
const H = B('engine/health');
const { loadBulk } = B('engine/bulk/loader');
const { spec } = B('engine/bulk/latvia');
const { makePgStore } = B('engine/persistence');
let passed = 0, failed = 0;
const say = (ok, name, extra = '') => { ok ? passed++ : failed++; console.log((ok ? '  ok   ' : '  FAIL ') + name + (extra ? '\n       ' + extra : '')); };
const allow = new Set(['api-krs.ms.gov.pl', 'data.gov.lv']);
const http = makeRegistryHttp({ guardedFetch, allowSet: allow });

(async () => {
  console.log('the guardrails hold (raw fetch, bypassing the application\'s own egress guard)');
  for (const url of ['https://example.com/', 'https://www.sec.gov/files/company_tickers.json', 'http://169.254.169.254/latest/meta-data/', 'http://1.1.1.1/']) {
    const t0 = Date.now(); let r;
    try { const res = await fetch(url, { signal: AbortSignal.timeout(8000) }); r = 'reached it: HTTP ' + res.status; } catch (e) { r = null; }
    say(r === null, 'refused: ' + url, r ? r : `blocked in ${Date.now() - t0} ms`);
  }

  console.log('\nPoland (KRS), live');
  const c = await H.runCanary('pl', CONNECTORS.pl, { http, env: process.env });
  say(c.kind === 'ok', 'the canary finds PKP S.A. (KRS 0000019193)', c.detail);
  const l = await CONNECTORS.pl.lookup('PKP', { http, env: process.env, ids: ['0000019193'] });
  say(l.match && l.findings.length >= 4, 'a lookup gives its findings', l.findings.map(f => f.claim.slice(0, 90)).join(' | '));
  const none = await CONNECTORS.pl.lookup('x', { http, env: process.env, ids: ['0000000001'] });
  say(none.match === null || none.match.id === '0000000001', 'an unknown KRS number is no match or an honest extract, never a guess', JSON.stringify(none.match && none.match.id));

  console.log('\nUnited States (SEC EDGAR)');
  const us = await CONNECTORS.us.lookup('Toll Brothers', { http, env: process.env });
  say(Boolean(us.skipped), 'without a declared identity nothing is sent', us.skipped);

  console.log('\nLatvia (bulk file), live, into the sandbox database');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const store = makePgStore(pool);
  let requests = 0;
  const fetchFile = (url, { headers }) => { requests++; return guardedFetch(url, { allowSet: new Set(spec.hosts), headers, timeoutMs: 60000 }).then(r => r.response); };
  const t0 = Date.now();
  const r = await loadBulk({ spec, pool, fetchFile, log: m => console.log('       ' + m) });
  say(r.status === 'ok', 'the daily file loads completely', `${JSON.stringify(r)} in ${((Date.now() - t0) / 1000).toFixed(0)} s over ${requests} request(s)`);
  if (r.status === 'ok') {
    say(r.bytes > 100e6 && r.rows > 100000, 'the whole file arrived and a plausible number of companies were kept', `${r.bytes} bytes, ${r.rows} rows`);
    const canary = await H.runCanary('lv', CONNECTORS.lv, { http, env: process.env, bulk: store });
    say(canary.kind === 'ok', 'the Latvian canary finds SIA MERKS by its registration number', canary.detail);
    const a = await CONNECTORS.lv.lookup('Merks', { http, env: process.env, bulk: store });
    say(a.match && a.match.id === '40003304295', 'a name lookup finds the right company', a.findings.map(f => f.claim).join(' | '));
    const before = requests;
    const again = await loadBulk({ spec, pool, fetchFile, log: () => {} });
    say(again.status === 'unchanged' && requests === before + 1, 'a second run is one request and changes nothing (304)', JSON.stringify(again) + `, ${requests - before} request`);
    const rows = (await pool.query(`SELECT count(*)::int n FROM bulk_register_entities WHERE country='lv'`)).rows[0].n;
    say(rows === r.rows, 'the table holds exactly the rows the loader reported', rows + ' rows');
  }
  await pool.end();
  console.log(`\n${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
})().catch(e => { console.error('ERR', e); process.exit(2); });
