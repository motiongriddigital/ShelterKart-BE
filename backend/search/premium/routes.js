'use strict';
/**
 * Premium search: the thin routes. Nothing is registered unless PREMIUM_SEARCH=on, so with the flag off the server is as it was.
 *   POST /api/search/premium                  a signed-in premium reader's search (session required); the answer carries no cost and no user data
 *   GET  /api/admin/search/premium/episodes   the episode log in aggregate, and the latest lines (admin login)
 * Contract: docs/api/openapi.yaml, tags Research and Admin.
 */
function mountPremium(app, { premium, user, ah, adminAuth, limiter = (q, r, n) => n(), jsonParser = (q, r, n) => n(), stripPII = s => s, marketOfCountry = c => String(c || '').toLowerCase() }) {
  if (!premium.enabled()) return false;
  const reply = (res, status, body) => { res.set('Cache-Control', 'no-store'); res.status(status).json(body); };
  const REFUSE = { disabled: [404, 'Premium search is switched off.'], not_premium: [403, 'Premium search is open to readers who have bought a report.'], bad_query: [400, 'Name the project, in 2 to 120 characters.'],
    no_engine: [503, 'No search engine is set up right now.'], unavailable: [503, 'The search could not run just now. Please try again later.'], error: [500, 'The search stopped early. Please try again later.'] };

  app.post('/api/search/premium', limiter, jsonParser, ah(async (req, res) => {
    const u = await user(req);
    if (!u) return reply(res, 401, { ok: false, code: 'auth_required', error: 'Sign in to continue.' });
    const b = req.body || {}, country = String(b.country || '').toUpperCase().slice(0, 2);
    const out = await premium.run({ query: stripPII(String(b.query || '')).slice(0, 120), location: stripPII(String(b.location || '')).slice(0, 120), country, market: marketOfCountry(country) }, { user: u });
    if (!out.ok) { const [status, error] = REFUSE[out.code] || REFUSE.error; return reply(res, status, { ok: false, code: out.code, error }); }
    const { usage, episode, ...pub } = out;
    reply(res, 200, { ...pub, ok: true });
  }));

  app.get('/api/admin/search/premium/episodes', adminAuth, ah(async (req, res) => {
    const n = /^\d{1,3}$/.test(String((req.query || {}).limit || '')) ? Math.min(200, Math.max(1, Number(req.query.limit))) : 50;
    reply(res, 200, { ok: true, enabled: true, policy: { id: premium.policy.id, version: premium.policy.version }, summary: premium.episodes.summary(), recent: premium.episodes.read(2000).slice(-n) });
  }));
  return true;
}

module.exports = { mountPremium };
