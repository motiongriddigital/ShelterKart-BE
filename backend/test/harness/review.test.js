// Server routes for the blind-spot fixes: the adverse-findings hold (#3), the right of reply and disputes (#4) with no
// database, error text never leaked (#21), and the emergency pause (#20). Real server.js routes, in-memory stand-ins.
const env = { ANTHROPIC_API_KEY: 'k', ACCESS_TOKEN_SECRET: 'tok-secret', ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'pw', ADVERSE_HOLD_MARKETS: 'in' };
Object.assign(process.env, env); delete process.env.DATABASE_URL;
const RET = [['https://maharerait.maharashtra.gov.in/x', 'MahaRERA'], ['https://ibbi.gov.in/y', 'IBBI'], ['https://news.example/z', 'News']];
const OUT = { project: { name: 'Hubtown Celeste', location: 'Mumbai', developer: 'Hubtown Limited', ids: ['P51900008925'] }, sources: RET.map(r => r[0]),
  findings: [{ id: 'f0', topic: 'registration', claim: 'Registered with MahaRERA as P51900008925.', kind: 'fact', stance: 'neutral', src: [0] },
             { id: 'f1', topic: 'legal', claim: 'An insolvency application against the developer was admitted in 2023.', kind: 'fact', stance: 'negative', src: [1, 2] }],
  conflicts: [], gaps: [] };
globalThis.fetch = async (url, o) => { const mk = c => ({ ok: true, status: 200, json: async () => c }); const b = JSON.parse(o.body);
  if (b.tools) return mk({ stop_reason: 'end_turn', content: [{ type: 'server_tool_use', name: 'web_search' }, { type: 'web_search_tool_result', content: RET.map(([u, t]) => ({ url: u, title: t })) }, { type: 'text', text: JSON.stringify(OUT) }] });
  return mk({ content: [{ type: 'text', text: '{"reading":[{"observation":"Repeats the insolvency point.","based_on":["f1"],"question":"Ask about it."}],"questions":[]}' }] }); };
const app = require(require('path').join(__dirname, '..', '..', 'server.js'));
const find = (m, p) => app.routes.find(r => r.method === m && r.path === p);
const AUTH = 'Basic ' + Buffer.from('admin:pw').toString('base64');
function call(route, { body = {}, params = {}, headers = {} } = {}) { return new Promise(resolve => {
  const res = { code: 200, headers: {}, status(c) { this.code = c; return this; }, set(k, v) { this.headers[k] = v; return this; }, json(o) { resolve({ code: this.code, body: o }); } };
  const h = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  const req = { body, params, query: {}, ip: '4.4.4.4', path: route.path, headers: h, get: k => h[k.toLowerCase()] };
  const hs = route.handlers; let i = 0; const next = err => { if (err) return resolve({ code: 500, body: { error: err.message } }); const fn = hs[i++]; if (fn) fn(req, res, next); }; next(); }); }
let failures = 0; const ok = (label, c) => { if (!c) failures++; console.log((c ? '  ok   ' : '  FAIL ') + label); };
process.on('exit', () => { console.log(failures ? '\n' + failures + ' FAILED' : '\nall passing'); if (failures) process.exitCode = 1; });

(async () => {
  const research = find('post', '/api/research');
  const r1 = await call(research, { body: { query: 'Hubtown Celeste', market: 'in', country: 'IN' } });
  const b1 = r1.body.brief, ref = b1 && b1.ref;
  const claims = (b1 && b1.findings || []).map(f => f.claim).join(' | ');
  ok('held market: the negative finding is replaced by the "being checked" notice; the other finding is shown', r1.code === 200 && /being checked by a person/.test(claims) && /MahaRERA as P51900008925/.test(claims) && !/insolvency/i.test(JSON.stringify(b1.findings)));
  ok('held market: the held finding is withheld and no "reading between the lines" is shown while a person checks', b1.held && b1.held.count === 1 && /held while a person checks/.test(b1.held.note || ''));
  const q1 = await call(find('post', '/api/research/quote'), { body: { ref, country: 'IN' } });
  ok('held report cannot be quoted, so nobody pays for an incomplete report (409, code "held")', q1.code === 409 && q1.body.code === 'held');
  const held = await call(find('get', '/api/admin/held'), { headers: { authorization: AUTH } });
  ok('admin sees the held report with the negative finding and its sources', held.code === 200 && held.body.held.length === 1 && held.body.held[0].ref === ref && /insolvency/.test(held.body.held[0].adverse[0].claim) && held.body.held[0].adverse[0].sources.length === 2);
  ok('admin held list refuses without credentials', (await call(find('get', '/api/admin/held'))).code === 401);
  const ap = await call(find('post', '/api/admin/held/:ref/approve'), { params: { ref }, headers: { authorization: AUTH } });
  ok('a person releases it', ap.code === 200 && ap.body.review.status === 'approved');
  const r2 = await call(research, { body: { query: 'Hubtown Celeste', market: 'in', country: 'IN' } });
  ok('after release the buyer sees the full finding and the reading, and nothing is held for review', /insolvency application/.test(JSON.stringify(r2.body.brief.findings)) && !(r2.body.brief.held && r2.body.brief.held.count) && r2.body.brief.reading.length === 1);
  ok('the report credits the official register it used (IBBI) and nothing else', JSON.stringify((r2.body.brief.credits || []).map(c => c.id)) === '["in"]');
  const q2 = await call(find('post', '/api/research/quote'), { body: { ref, country: 'IN' } });
  ok('after release the quote is no longer refused as "held" (here it is refused only because India is not switched on for sale in this test)', q2.body.code !== 'held');

  // Right of reply, with no database configured
  const post = find('post', '/api/developer-response');
  ok('a reply must name a real report: a bad reference is refused (400), an unknown one too (404)',
    (await call(post, { body: { reportRef: 'nope', findingText: 'x', responseText: 'y', contactEmail: 'a@b.com' } })).code === 400
    && (await call(post, { body: { reportRef: 'SK-000000000000', findingText: 'x', responseText: 'y', contactEmail: 'a@b.com' } })).code === 404);
  const sent = await call(post, { body: { reportRef: ref, findingText: 'An insolvency application against the developer was admitted in 2023.', responseText: 'The application was dismissed in 2024; order attached.', contactEmail: 'Legal@Example.com' } });
  ok('with no database a developer can still reply (it used to fail with raw error text)', sent.code === 200 && sent.body.ok === true);
  const pub0 = await call(find('get', '/api/developer-response/:reportRef'), { params: { reportRef: ref } });
  ok('nothing is public before a person approves it', pub0.code === 200 && pub0.body.responses.length === 0);
  const pend = await call(find('get', '/api/admin/responses'), { headers: { authorization: AUTH } });
  const row = pend.body[0];
  ok('the reviewer sees which finding it answers and whether the sender\'s domain matches the developer\'s site', pend.code === 200 && row.finding_match === 1 && ['match', 'no_match', 'unknown'].includes(row.sender_check) && row.report_available === true);
  await call(find('post', '/api/admin/responses/:id/approve'), { params: { id: row.id }, headers: { authorization: AUTH } });
  const pub = await call(find('get', '/api/developer-response/:reportRef'), { params: { reportRef: ref } });
  ok('approved: shown publicly, with the domain check, and never the sender\'s email address', pub.body.responses.length === 1 && typeof pub.body.responses[0].from_developer_domain === 'boolean' && !/example\.com/i.test(JSON.stringify(pub.body)));
  const rs = await call(research, { body: { query: 'Hubtown Celeste', market: 'in', country: 'IN' } });
  ok('a reply does not change the findings', JSON.stringify(rs.body.brief.findings) === JSON.stringify(r2.body.brief.findings));

  // Markup from a stranger is removed before it is stored (B8)
  const htmlReply = await call(post, { body: { reportRef: ref, findingText: '<img src=x onerror=alert(1)>The developer was named in a case.', responseText: '<script>alert(1)</script>The case was withdrawn in 2024.', contactEmail: 'legal2@example.com' } });
  const pendHtml = (await call(find('get', '/api/admin/responses'), { headers: { authorization: AUTH } })).body.find(x => /withdrawn in 2024/.test(x.response_text));
  ok('a reply with markup is accepted and stored as plain text', htmlReply.code === 200 && pendHtml && !/<[a-zA-Z/!?]/.test(pendHtml.response_text + pendHtml.finding_text), JSON.stringify(pendHtml));
  ok('a reply that is nothing but markup is refused', (await call(post, { body: { reportRef: ref, findingText: '<b></b>', responseText: '<i></i>', contactEmail: 'legal3@example.com' } })).code === 400);

  // Disputes without a database, no raw error text
  const d = await call(find('post', '/api/dispute'), { body: { note: 'The possession date is wrong.', reportRef: ref, contact: 'buyer@example.com' } });
  const open = await call(find('get', '/api/admin/disputes'), { headers: { authorization: AUTH } });
  ok('a buyer can report an inaccuracy with no database, and the admin sees it', d.code === 200 && open.body.length === 1 && open.body[0].report_ref === ref);
  const sources = ['server.js', 'app.js', ...['modules', 'middleware', 'services'].flatMap(d => require('fs').readdirSync(require('path').join(__dirname, '..', '..', d)).map(f => d + '/' + f))].filter(f => f.endsWith('.js'));
  ok('the route and middleware sources are all scanned (' + sources.length + ' files)', sources.length > 15);
  ok('no route returns raw error detail any more', sources.every(f => !/detail: e\.message/.test(require('fs').readFileSync(require('path').join(__dirname, '..', '..', f), 'utf8'))));

  // Bot protection: a NEW research needs the browser's proof of work; an already-researched report does not
  process.env.BOT_GUARD = 'on'; process.env.BOT_POW_BITS = '10';
  const BOT = require('../../engine/botguard'), cryptoN = require('crypto');
  const solve = (token, bits) => { for (let i = 0; ; i++) { const s = i.toString(36); if (BOT.leadingZeroBits(cryptoN.createHash('sha256').update(token + ':' + s).digest()) >= bits) return s; } };
  const fresh = await call(research, { body: { query: 'Brand New Tower', market: 'in', country: 'IN' } });
  ok('guard on: a new search without proof of work is refused (428, code "challenge"), before any research runs', fresh.code === 428 && fresh.body.code === 'challenge');
  const cached = await call(research, { body: { query: 'Hubtown Celeste', market: 'in', country: 'IN' } });
  ok('guard on: an already-researched report opens with no check at all', cached.code === 200);
  const ch = await call(find('get', '/api/research/challenge'));
  ok('the challenge route issues a signed puzzle', ch.code === 200 && /\./.test(ch.body.token) && ch.body.bits === 10);
  const pow = { token: ch.body.token, solution: solve(ch.body.token, ch.body.bits) };
  const solved = await call(research, { body: { query: 'Brand New Tower', market: 'in', country: 'IN', pow } });
  ok('with a solved puzzle the new research runs', solved.code === 200 && solved.body.ok === true);
  const replay = await call(research, { body: { query: 'Another New Tower', market: 'in', country: 'IN', pow } });
  ok('the same solved puzzle cannot start a second new research', replay.code === 428 && replay.body.reason === 'used');
  // SHEL-39: the document check starts new research too, so it needs the same proof of work, and must not spend the day's allowance without it
  const doc = find('post', '/api/research/document-check'), RS = require('../../engine/research');
  const used0 = RS._daily.count;
  const d0 = await call(doc, { body: { query: 'Yet Another Tower', market: 'in', file: 'x', mediaType: 'image/png' } });
  ok('guard on: the document check refuses new research without proof of work (428), like /api/research', d0.code === 428 && d0.body.code === 'challenge');
  ok('...and the refusal did not use any of the day\'s research allowance', RS._daily.count === used0);
  const d1 = await call(doc, { body: { query: 'Hubtown Celeste', market: 'in', file: 'x', mediaType: 'image/png' } });
  ok('guard on: an already-researched report needs no check for the document check either', d1.code !== 428);
  const ch2 = await call(find('get', '/api/research/challenge'));
  const d2 = await call(doc, { body: { query: 'Yet Another Tower', market: 'in', file: 'x', mediaType: 'image/png', pow: { token: ch2.body.token, solution: solve(ch2.body.token, ch2.body.bits) } } });
  ok('with a solved puzzle the document check goes through the guard', d2.code !== 428);
  const d3 = await call(doc, { body: { query: 'Fifth New Tower', market: 'in', file: 'x', mediaType: 'image/png', pow: { token: ch2.body.token, solution: solve(ch2.body.token, ch2.body.bits) } } });
  ok('and the same puzzle cannot be used twice there either', d3.code === 428 && d3.body.reason === 'used');
  delete process.env.BOT_GUARD; delete process.env.BOT_POW_BITS;

  // Emergency pause: new research stops, researched reports still open
  process.env.RESEARCH_PAUSED = 'true';
  const p1 = await call(research, { body: { query: 'Some Other Tower', market: 'in', country: 'IN' } });
  const p2 = await call(research, { body: { query: 'Hubtown Celeste', market: 'in', country: 'IN' } });
  ok('paused: a new search is refused with a plain message; an already-researched report still opens', p1.code === 503 && /paused/.test(p1.body.error || '') && p2.code === 200);
  delete process.env.RESEARCH_PAUSED;
})();
