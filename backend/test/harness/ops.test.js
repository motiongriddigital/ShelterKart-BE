// Search visibility, share previews, and operator alerts. The server is loaded as in the other harness tests; delivery
// is driven with fake providers and an immediate retry clock, so no e-mail or network call is made.
const path = require('path'), fs = require('fs'), assert = require('assert');
Object.assign(process.env, { ANTHROPIC_API_KEY: 'k', ACCESS_TOKEN_SECRET: 'tok-secret', GSTIN: '27ABCDE1234F1Z5', PAYMENTS_ENABLED: 'true', BOT_GUARD: 'off', PUBLIC_BASE_URL: 'https://shelterkart.test' });
for (const k of ['DATABASE_URL', 'AI_ENGINES', 'OPS_ALERT_EMAIL', 'RESEND_API_KEY', 'DELIVERY_FROM']) delete process.env[k];
const app = require(path.join(__dirname, '..', '..', 'server.js'));
const H = require(path.join(__dirname, '..', '..', 'engine', 'dossierHtml'));
const B = require(path.join(__dirname, '..', '..', 'engine', 'dossierBrief'));
const D = require(path.join(__dirname, '..', '..', 'engine', 'delivery'));
const find = (m, p) => app.routes.find(r => r.method === m && r.path === p);
function call(route) { return new Promise(resolve => {
  const res = { code: 200, status(c) { this.code = c; return this; }, set() { return this; }, type() { return this; }, json(o) { resolve({ code: this.code, json: o }); }, send(t) { resolve({ code: this.code, raw: String(t) }); } };
  const req = { body: {}, params: {}, query: {}, ip: '5.5.5.5', path: route.path, headers: {}, get: () => undefined, on() {} };
  const hs = route.handlers; let i = 0; const next = () => { const fn = hs[i++]; if (fn) fn(req, res, next); }; next(); }); }
let failures = 0; const ok = (label, c) => { if (!c) failures++; console.log((c ? '  ok   ' : '  FAIL ') + label); };
const d = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'data', 'sample-reports', 'celeste.json'), 'utf8'));

(async () => {
  // 1. search visibility
  const robots = await call(find('get', '/robots.txt'));
  ok('robots.txt keeps private reports, the API and the admin pages out of search, and names the sitemap', /Disallow: \/r\//.test(robots.raw) && /Disallow: \/api\//.test(robots.raw) && /Disallow: \/admin/.test(robots.raw) && /Sitemap: https:\/\/shelterkart\.test\/sitemap\.xml/.test(robots.raw));
  const map = await call(find('get', '/sitemap.xml'));
  const locs = [...map.raw.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
  ok('the sitemap lists the public pages and the three published samples, on the public address', locs.includes('https://shelterkart.test/pricing.html') && locs.includes('https://shelterkart.test/samples/celeste') && locs.includes('https://shelterkart.test/guide'));
  ok('the sitemap never lists private reports, the admin page, the API, or the independence page (until its claim is restored)', !locs.some(u => /\/r\/|\/api\/|admin|independence|start/.test(u)));
  // 2. report pages: private ones are not indexed; the published sample is
  const priv = H.renderDossier(d), samp = H.renderDossier(d, { indexable: true }), prev = H.renderPreview(B.previewDossier(d), {});
  ok('a paid report and a preview carry noindex; a published sample does not', /noindex,nofollow/.test(priv) && /noindex,nofollow/.test(prev) && !/noindex/.test(samp));
  ok('the share tags describe the page, with no finding in them', /og:title/.test(priv) && /og:description/.test(priv) && /twitter:card/.test(priv) && /og:image" content="https:\/\/shelterkart\.test\/share-card\.png"/.test(priv) && !/Nayan Real Estate|Charges|court|complaint/i.test(priv.match(/<head>[\s\S]*<\/head>/)[0]));
  // 3. operator alerts
  const sent = []; const fakeFetch = async (url, o) => { sent.push({ url, body: JSON.parse(o.body) }); return { ok: true, status: 200, json: async () => ({ id: 'e1' }), text: async () => '' }; };
  const off = await D.alertOperator({}, 'subject', 'text', fakeFetch);
  ok('with no operator address set, the alert is only logged and nothing is sent', off === false && sent.length === 0);
  const on = await D.alertOperator({ OPS_ALERT_EMAIL: 'ops@shelterkart.test', RESEND_API_KEY: 'k', DELIVERY_FROM: 'a@shelterkart.test' }, 'a paid report failed', 'Report SK-1 failed', fakeFetch);
  ok('with an operator address and a provider set, the alert is e-mailed to the operator', on === true && sent.length === 1 && /ops@shelterkart\.test/.test(JSON.stringify(sent[0].body)) && /ops/.test(sent[0].body.subject || JSON.stringify(sent[0].body)));
  // a report that cannot be delivered after every retry is reported once
  const reported = []; const pending = [];
  const failing = async () => { throw new Error('provider down'); };
  const del = D.createDelivery({ env: { RESEND_API_KEY: 'k', DELIVERY_FROM: 'a@shelterkart.test' }, fetchImpl: failing, onGiveUp: x => reported.push(x), setTimer: fn => { pending.push(fn); } });
  const r = del.send({ ref: 'SK-GIVEUP01', project: 'Example', email: 'buyer@example.com', link: 'https://shelterkart.test/r/x' });
  // each attempt settles before its retry is scheduled, so wait for the queue to fill between attempts
  for (let i = 0; i < 50; i++) { await new Promise(res => setImmediate(res)); if (!pending.length) { if (reported.length) break; continue; } await pending.shift()(); }
  await r.done;
  ok('a report not delivered after every retry is reported to the operator exactly once, with its reference and the channel', reported.length === 1 && reported[0].ref === 'SK-GIVEUP01' && reported[0].channel === 'email');
  // every finding carries a right-of-reply link with the report's own reference
  {
    const full = H.renderDossier(d);
    const links = (full.match(/data-reply="[^"]+"/g) || []).length, facts = (full.match(/class="f st-/g) || []).length;
    ok('every finding in a full report has a right-of-reply link, carrying its report reference', facts > 0 && links === facts && /data-ref="SK-/.test(full));
  }
  console.log(failures ? '\n' + failures + ' FAILED' : '\nall passing'); process.exit(failures ? 1 : 0);
})();
