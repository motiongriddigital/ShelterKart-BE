'use strict';
/**
 * The search service: the candidate routes, the shadow comparison, and keeping the index.
 *
 * SEARCH_V2 decides what buyers see:
 *   shadow (default)  the old search runs as before; the new one runs silently beside every research request, and the comparison is
 *                     kept for the admin (GET /api/admin/search/shadow). Nothing changes on screen.
 *   on                the page asks /api/search/candidates first, shows up to five candidates and starts research only on the one the
 *                     buyer confirms. Switch this on only after reading the shadow comparison, and with the founder's approval of the screen.
 *   off               neither runs.
 * The index is kept in SEARCH_DATA_DIR (or SOCIAL_DATA_DIR) as search-index.json, seeded from data/search/projects.json, and grows
 * from every project ShelterKart researches. Without a directory it lives in memory and is rebuilt from research after a restart.
 */
const fs = require('fs'), path = require('path');
const { ProjectIndex } = require('./index');
const { fold } = require('./normalize');

function createSearch({ env = process.env, log = console, seedFile = path.join(__dirname, '..', 'data', 'search', 'projects.json') } = {}) {
  const mode = () => (['off', 'shadow', 'on'].includes(String(env.SEARCH_V2 || '').toLowerCase()) ? String(env.SEARCH_V2).toLowerCase() : 'shadow');
  const dir = env.SEARCH_DATA_DIR || env.SOCIAL_DATA_DIR || '', file = dir ? path.join(dir, 'search-index.json') : '';
  const index = new ProjectIndex();
  try { if (fs.existsSync(seedFile)) index.load(JSON.parse(fs.readFileSync(seedFile, 'utf8'))); } catch (e) { log.error('[search] seed file unreadable: ' + e.message); }
  try { if (file && fs.existsSync(file)) index.load(JSON.parse(fs.readFileSync(file, 'utf8'))); } catch (e) { log.error('[search] index file unreadable: ' + e.message); }
  let timer = null;
  index.onChange = () => { if (!file || timer) return; timer = setTimeout(() => { timer = null; try { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(file + '.tmp', JSON.stringify(index.toJSON())); fs.renameSync(file + '.tmp', file); } catch (e) { log.error('[search] could not save the index: ' + e.message); } }, 2000); if (timer.unref) timer.unref(); };

  // The shadow comparison: what the new search would have offered, beside what the old search did. `brief` is the project the old search
  // served, when known; for the live investigator, `reused` says whether an earlier investigation was served instead of a fresh one.
  const shadow = { compared: 0, counts: { agree: 0, differ: 0, new_found_old_researched_fresh: 0, neither: 0, new_none_old_found: 0, old_reused: 0 }, recent: [] };
  function compare({ query, location, market, brief = null, reused = false, route = 'research' }) {
    if (mode() === 'off') return null;
    let r; try { r = index.match({ query, location, market }); } catch { return null; }
    const top = r.candidates[0], known = brief && brief.project && brief.project.name ? fold(brief.project.name) : null;
    const old = brief ? (brief.matchedAs ? 'alias' : brief.cached ? 'cache' : 'fresh') : reused ? 'reused' : 'fresh';
    const kind = old === 'fresh' ? (top ? (known && fold(top.name) === known ? 'agree' : 'new_found_old_researched_fresh') : 'neither')
      : !known ? (top ? 'old_reused' : 'new_none_old_found') : !top ? 'new_none_old_found' : fold(top.name) === known ? 'agree' : 'differ';
    shadow.compared++; shadow.counts[kind]++;
    shadow.recent.unshift({ at: new Date().toISOString(), route, market, query: String(query || '').slice(0, 120), location: String(location || '').slice(0, 80), old, oldProject: brief && brief.project ? brief.project.name || '' : '',
      newTop: top ? top.name : null, newConfidence: r.confidence, newWhy: top ? top.why.code : null, kind });
    shadow.recent.length = Math.min(shadow.recent.length, 200);
    return kind;
  }
  /** After research: compare in the shadow, then make the researched project findable. */
  function afterResearch({ query, location, market, brief }) {
    const kind = compare({ query, location, market, brief });
    try { if (mode() !== 'off' && brief) index.addBrief(brief, market); } catch {}
    return kind;
  }
  /** The live investigator: compare when a search arrives; add the project once its first pass has identified it. */
  const observeInvestigate = ({ query, location, market, reused }) => compare({ query, location, market, reused, route: 'investigate' });
  function afterInvestigation(brief, market) { try { if (mode() !== 'off' && brief) return index.addBrief(brief, market); } catch {} return null; }
  /** The investigator speaks in ISO country codes (GB); the site's markets use their own two-letter codes (uk). */
  const marketOfCountry = c => { const x = String(c || '').toLowerCase(); return x === 'gb' ? 'uk' : x; };

  function mount(app, { adminAuth, ah, jsonParser, limiter = (q, r, n) => n(), stripPII = s => s, markets = {} }) {
    const okMarket = m => typeof m === 'string' && Object.prototype.hasOwnProperty.call(markets, m.toLowerCase());
    app.get('/api/search/config', (req, res) => { res.set('Cache-Control', 'no-store'); res.json({ mode: mode() }); });
    app.post('/api/search/candidates', limiter, jsonParser, ah(async (req, res) => {
      if (mode() === 'off') return res.status(404).json({ ok: false, error: 'The new search is switched off.' });
      const b = req.body || {}, market = String(b.market || '').toLowerCase();
      if (!okMarket(market)) return res.status(400).json({ ok: false, error: 'Choose a market.' });
      const query = stripPII(String(b.query || '')).slice(0, 120), location = stripPII(String(b.location || '')).slice(0, 80);
      if (query.trim().length < 2 && !b.remember) return res.status(400).json({ ok: false, error: 'Type at least two letters of a project, developer, area or registration number.' });
      const r = b.remember && typeof b.remember === 'object'
        ? index.remember({ market, developer: stripPII(String(b.remember.developer || '')).slice(0, 80), locality: stripPII(String(b.remember.locality || '')).slice(0, 80), year: Number(b.remember.year) || '', config: String(b.remember.config || '').slice(0, 10), name: query })
        : index.match({ query, location, market });
      res.set('Cache-Control', 'no-store'); res.json({ ...r, indexSize: index.size });
    }));
    app.get('/api/admin/search/shadow', adminAuth, (req, res) => { res.set('Cache-Control', 'no-store'); res.json({ ok: true, mode: mode(), indexSize: index.size, durable: Boolean(file), ...shadow }); });
    app.post('/api/admin/search/projects', adminAuth, jsonParser, ah(async (req, res) => {
      const list = Array.isArray(req.body) ? req.body : Array.isArray(req.body && req.body.projects) ? req.body.projects : null;
      if (!list || list.length > 5000) return res.status(400).json({ ok: false, error: 'Send a list of up to 5,000 projects.' });
      let added = 0; const refused = [];
      for (const p of list) { try { index.add(p); added++; } catch (e) { refused.push({ id: p && p.id || null, problems: e.problems || [e.message] }); } }
      res.json({ ok: true, added, refused: refused.slice(0, 50), indexSize: index.size });
    }));
  }
  return { index, mode, compare, afterResearch, observeInvestigate, afterInvestigation, marketOfCountry, shadow, mount, file };
}

module.exports = { createSearch };
