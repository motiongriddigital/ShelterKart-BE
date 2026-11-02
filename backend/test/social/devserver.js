'use strict';
/**
 * A local demo of the marketing desk: the real desk, routes and page, with the TEST-ONLY knowledge base, no login, a dry-run publisher,
 * and a fixed clock. For trying the screen and for the browser check; it is never part of the server.
 *   node backend/test/social/devserver.js            (then open the printed address)
 */
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path');
const { createSocial } = require('../../social'), F = require('./fixtures');
function miniApp() {
  const routes = []; const add = m => (p, ...h) => routes.push({ m, p, h });
  return { get: add('GET'), post: add('POST'), routes, async handle(req, res) {
    const u = new URL(req.url, 'http://x'), query = Object.fromEntries(u.searchParams); let raw = ''; for await (const c of req) raw += c; let body = {}; try { body = raw ? JSON.parse(raw) : {}; } catch {}
    for (const r of routes) {
      if (r.m !== req.method) continue; const names = [], re = new RegExp('^' + r.p.replace(/:([a-z]+)/g, (_, n) => { names.push(n); return '([^/]+)'; }) + '$'), m = re.exec(u.pathname); if (!m) continue;
      const rq = { method: req.method, path: u.pathname, query, body, headers: req.headers, params: Object.fromEntries(names.map((n, i) => [n, decodeURIComponent(m[i + 1])])) };
      const out = { code: 200, h: {}, done: false, set(k, v) { if (typeof k === 'object') Object.assign(this.h, k); else this.h[k] = v; return this; }, status(c) { this.code = c; return this; }, json(o) { this.h['Content-Type'] = 'application/json'; this.send(JSON.stringify(o)); return this; }, send(x) { if (!this.done) { res.writeHead(this.code, this.h); res.end(x); this.done = true; } return this; }, end() { return this.send(''); }, type() { return this; } };
      let i = 0; const next = async () => { const h = r.h[i++]; if (!h || out.done) return; await h(rq, out, next); if (!out.done && i < r.h.length) await next(); }; await next(); return true;
    }
    return false;
  } };
}
(async () => {
  const NOW = Date.parse(process.env.DEMO_NOW || '2026-10-25T12:00:00Z'), env = { SOCIAL_ENGINE: 'on', SOCIAL_ALLOW_MEMORY: 'true', SOCIAL_APPROVAL_PIN: '1234', SOCIAL_LANG_READY: 'hi,ar,fr,es,de,pl,ja,zh-Hant', SOCIAL_EPOCH_MONDAY: '2026-10-26', PUBLIC_BASE_URL: 'http://127.0.0.1', SOCIAL_MEDIA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'demo-media-')) };
  const PAGE = '<html><head><title>Registering a project | Test Authority</title></head><body><main><h1>Registering a project</h1><p>The promoter must register the project with the state authority before advertising or selling any unit.</p><p>The registration number must be shown in every advertisement for the project.</p><p>Projects of more than five hundred square metres or eight units must register with the authority.</p></main></body></html>';
  const GOOD = { statement: 'A promoter must register a project with the state authority before advertising or selling any unit.', quote: 'The promoter must register the project with the state authority before advertising or selling any unit.' };
  const keeperFetch = async url => (url === 'https://rera.example.gov/register' ? { ok: true, status: 200, url, headers: { get: k => (k.toLowerCase() === 'content-type' ? 'text/html' : '') }, text: async () => PAGE } : { ok: false, status: 404, url, headers: { get: () => '' }, text: async () => '' });
  const keeperEngines = { modelFor: r => ({ provider: r === 'adviser' ? 'alpha' : 'beta' }), async run(role) { return { text: role === 'adviser' ? JSON.stringify({ statements: [GOOD] }) : JSON.stringify({ supported: true, why: 'stated on the page' }) }; } };
  const social = await createSocial({ env, now: () => NOW, judge: async () => ({ pass: true, issues: [] }), renderer: null, keeperEngines, keeperFetch, log: { log() {}, error: e => console.error(e) } });
  for (const it of F.buildKb(() => '2026-10-25').all()) social.kb.put(it);
  const app = miniApp(); social.mount(app, { adminAuth: (q, r, n) => n(), ah: fn => fn, jsonParser: (q, r, n) => n(), pageFile: path.join(__dirname, '..', '..', '..', 'admin-social.html') });
  const server = http.createServer(async (req, res) => { try { if (req.url === '/' ) { res.writeHead(302, { Location: '/admin/social' }); return res.end(); } if (!(await app.handle(req, res))) { res.writeHead(404); res.end('not found'); } } catch (e) { console.error(e); res.writeHead(500); res.end('error'); } });
  server.listen(Number(process.env.PORT) || 0, '127.0.0.1', () => console.log('READY http://127.0.0.1:' + server.address().port + '/admin/social'));
})();
