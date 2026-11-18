'use strict';
/** Live check of the custom report pipeline (Tavily + Groq) against a running server with real API keys set.
 * Usage: node tools/smoke_custom_report.js [base url, default http://localhost:4000] */
const base = process.argv[2] || 'http://localhost:4000';
let failed = 0;
const ok = (label, c) => { if (!c) failed++; console.log((c ? '  ok   ' : '  FAIL ') + label); };
async function call(method, path, body) {
  const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null; try { json = await r.json(); } catch { json = null; }
  return { status: r.status, json };
}
(async () => {
  ok('a missing query is refused', (await call('POST', '/api/custom/research', {})).json.code === 'invalid_query');

  const free = await call('POST', '/api/custom/research', { query: 'Hubtown Celeste', location: 'Mumbai', tier: 'free' });
  ok('a free report is generated with the full schema', free.status === 200 && free.json.tier === 'free' && free.json.summary && Array.isArray(free.json.keyFacts) && Array.isArray(free.json.differences) && Array.isArray(free.json.questions));
  ok('the free report has a ref', /^CR-[0-9A-F]{12}$/.test(free.json && free.json.ref));

  const fetched = await call('GET', '/api/custom/research/' + free.json.ref);
  ok('the free report can be re-fetched by ref', fetched.status === 200 && fetched.json.ref === free.json.ref);

  const paid = await call('POST', '/api/custom/research', { query: 'Hubtown Celeste', location: 'Mumbai', tier: 'paid' });
  ok('a paid report is generated with the same schema, higher caps', paid.status === 200 && paid.json.tier === 'paid' && Array.isArray(paid.json.keyFacts));

  const pdf = await fetch(base + '/api/custom/research/' + paid.json.ref + '/pdf');
  ok('the paid report prints as a PDF (or says plainly that printing is not installed)', pdf.status === 200 || pdf.status === 503);
  if (pdf.status === 200) ok('the PDF response is actually a PDF', (pdf.headers.get('content-type') || '').includes('pdf'));

  ok('an unknown ref is a 404', (await call('GET', '/api/custom/research/CR-DOESNOTEXIST')).status === 404);

  console.log(failed ? '\n' + failed + ' FAILED' : '\nall passing against ' + base);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
