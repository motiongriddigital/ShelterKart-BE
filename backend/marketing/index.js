'use strict';
/**
 * The marketing dashboard's routes (admin only) and the small store for what only the founder can enter: ad spend, cost
 * ceilings, exchange rates, the measured AI cost, counsel's decisions, legal notices, AI-answer checks, hours of effort,
 * targets (only after the baseline exists) and the current phase. Those inputs are kept in the social desk's durable store
 * (one 'meta' document) when it is available, so no migration is needed; otherwise in memory, and the screen says so.
 * Everything else is read from what the platform already records: analytics events, refunds, replies and corrections, and
 * the desk's posts and incidents.
 */
const fs = require('fs'), path = require('path');
const D = require('./dashboard');
const MARKETS = (() => { try { return require('../social/schedule').WHEEL.markets.map(m => ({ code: m.code, name: m.name })); } catch { return []; } })();
const CODES = new Set(MARKETS.map(m => m.code));
const DOC = 'marketing';
const EMPTY = () => ({ spend: [], citations: [], settings: { phase: 0, ceilings: { IN: { amount: 700, currency: 'INR', provisional: true, note: 'Strategy: about 40% of the first order\'s contribution at the Base AI cost. Provisional until the AI cost is measured.' } }, fx: {}, paidMarkets: [], counselHousingAd: {}, legalNotices: [], effortHours: {}, targets: {} } });

function makeState(socialStore) {
  let mem = null;
  const get = () => { if (socialStore && socialStore.meta) { const d = socialStore.meta.get(DOC); if (d) return d; const fresh = EMPTY(); socialStore.meta.put(DOC, fresh); return fresh; } return (mem = mem || EMPTY()); };
  const save = s => { if (socialStore && socialStore.meta) socialStore.meta.put(DOC, s); else mem = s; return s; };
  return { get, save, durable: Boolean(socialStore && socialStore.meta) };
}

const bad = (res, error) => res.status(400).json({ ok: false, error });
const num = v => (typeof v === 'number' ? v : Number(v));
const isMonday = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s)) && D.mondayOf(s) === s;
const isMonth = s => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(s));
const isCur = s => /^[A-Z]{3}$/.test(String(s));
const txt = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);

function mount(app, { adminAuth, ah, jsonParser, loadRows, pool = null, social = null, now = () => Date.now(), pageFile = path.join(__dirname, '..', '..', 'admin-marketing.html') }) {
  const state = makeState(social && social.store);
  const A = [adminAuth];
  const q = async (sql, args = []) => { if (!pool) return null; try { return (await pool.query(sql, args)).rows; } catch { return null; } };

  async function data(sinceIso) {
    const [rows, refundRows, responses] = await Promise.all([
      loadRows(sinceIso).catch(() => []),
      q('SELECT created_at, amount, currency FROM refunds WHERE created_at >= $1', [sinceIso]),
      q('SELECT kind, status, report_ref, created_at, resolved_at FROM responses WHERE created_at >= $1 OR resolved_at IS NULL', [sinceIso]),
    ]);
    const st = social && social.store;
    return { rows: rows || [], refundRows, responses, posts: st ? st.posts.all() : [], incidents: st ? st.incidents.all() : [] };
  }

  app.get('/admin/marketing', adminAuth, (req, res) => { res.set({ 'Cache-Control': 'no-store', 'Content-Type': 'text/html; charset=utf-8' }); try { res.send(fs.readFileSync(pageFile, 'utf8')); } catch { res.status(500).send('The marketing dashboard page is missing.'); } });

  app.get('/api/admin/marketing/dashboard', ...A, ah(async (req, res) => {
    const week = req.query.week && isMonday(req.query.week) ? req.query.week : D.mondayOf(now());
    const since = new Date(Date.parse(week + 'T00:00:00Z') - 400 * 864e5).toISOString();   // the analytics retention window
    const s = state.get(), d = await data(since);
    const out = D.build({ ...d, now: now(), week, markets: MARKETS, settings: s.settings, spend: s.spend, citations: s.citations });
    res.set('Cache-Control', 'no-store'); res.json({ ok: true, durable: state.durable, ...out, inputs: { spend: s.spend.slice(-50), citations: s.citations.slice(-50), settings: s.settings } });
  }));

  app.post('/api/admin/marketing/spend', ...A, jsonParser, ah(async (req, res) => {
    const b = req.body || {}, amount = num(b.amount);
    if (!CODES.has(b.market)) return bad(res, 'Choose a market.');
    if (!isMonday(b.week)) return bad(res, 'The week is the Monday it starts on, as YYYY-MM-DD.');
    if (!Number.isFinite(amount) || amount < 0 || amount > 1e9) return bad(res, 'The amount must be a number of zero or more.');
    if (!isCur(b.currency)) return bad(res, 'The currency is a three-letter code, such as INR.');
    const s = state.get(); s.spend.push({ id: 'sp-' + Date.now().toString(36), market: b.market, week: b.week, channel: txt(b.channel, 40) || 'unspecified', amount, currency: b.currency, note: txt(b.note, 200), at: new Date(now()).toISOString() });
    state.save(s); res.json({ ok: true, spend: s.spend.slice(-1)[0] });
  }));

  app.post('/api/admin/marketing/citation', ...A, jsonParser, ah(async (req, res) => {
    const b = req.body || {};
    if (!isMonth(b.month)) return bad(res, 'The month is YYYY-MM.');
    if (b.market && b.market !== '*' && !CODES.has(b.market)) return bad(res, 'Choose a market, or leave it blank.');
    if (!txt(b.query, 200) || !txt(b.engine, 40)) return bad(res, 'Give the question asked and the AI service asked.');
    const s = state.get(); s.citations.push({ id: 'ci-' + Date.now().toString(36), month: b.month, market: b.market || '*', query: txt(b.query, 200), engine: txt(b.engine, 40), cited: b.cited === true || b.cited === 'true', where: txt(b.where, 200) });
    state.save(s); res.json({ ok: true, citation: s.citations.slice(-1)[0] });
  }));

  app.post('/api/admin/marketing/effort', ...A, jsonParser, ah(async (req, res) => {
    const b = req.body || {}, h = num(b.hours);
    if (!isMonth(b.month) || !CODES.has(b.market)) return bad(res, 'Give a month (YYYY-MM) and a market.');
    if (!Number.isFinite(h) || h < 0 || h > 744) return bad(res, 'Hours must be between 0 and 744.');
    const s = state.get(); ((s.settings.effortHours[b.month] = s.settings.effortHours[b.month] || {}))[b.market] = h;
    state.save(s); res.json({ ok: true });
  }));

  app.post('/api/admin/marketing/settings', ...A, jsonParser, ah(async (req, res) => {
    const b = req.body || {}, s = state.get(), st = s.settings;
    if (b.phase != null) { const p = num(b.phase); if (![0, 1, 2].includes(p)) return bad(res, 'The phase is 0, 1 or 2.'); st.phase = p; }
    if (b.aiCostMeasuredUsd !== undefined) { if (b.aiCostMeasuredUsd === null) st.aiCostMeasuredUsd = null; else { const v = num(b.aiCostMeasuredUsd); if (!Number.isFinite(v) || v <= 0 || v > 1000) return bad(res, 'The measured AI cost is in US dollars per paid report.'); st.aiCostMeasuredUsd = v; } }
    if (b.ceiling) { const c = b.ceiling, a = num(c.amount); if (!CODES.has(c.market) || !Number.isFinite(a) || a <= 0 || !isCur(c.currency)) return bad(res, 'A ceiling needs a market, an amount above zero and a currency.'); st.ceilings[c.market] = { amount: a, currency: c.currency, provisional: c.provisional !== false, note: txt(c.note, 200) }; }
    if (b.fx) { for (const [cur, v] of Object.entries(b.fx)) { const r = num(v); if (!isCur(cur) || !Number.isFinite(r) || r <= 0) return bad(res, 'An exchange rate is a currency code and the rupees per unit.'); st.fx[cur] = r; } }
    if (b.paidMarkets) { if (!Array.isArray(b.paidMarkets) || b.paidMarkets.some(m => !CODES.has(m))) return bad(res, 'Paid markets is a list of market codes.'); st.paidMarkets = [...new Set(b.paidMarkets)]; }
    if (b.counsel) { if (!CODES.has(b.counsel.market)) return bad(res, 'Choose the market counsel decided on.'); st.counselHousingAd[b.counsel.market] = b.counsel.decided ? { decided: true, note: txt(b.counsel.note, 200), at: new Date(now()).toISOString() } : undefined; if (!b.counsel.decided) delete st.counselHousingAd[b.counsel.market]; }
    if (b.legalNotice) { const n = b.legalNotice; if (n.close) { const x = st.legalNotices.find(y => y.id === n.close); if (!x) return bad(res, 'No such notice.'); x.closed = true; x.closedAt = new Date(now()).toISOString(); } else { if (!txt(n.note, 200)) return bad(res, 'Describe the notice.'); st.legalNotices.push({ id: 'ln-' + Date.now().toString(36), note: txt(n.note, 200), market: CODES.has(n.market) ? n.market : '', at: new Date(now()).toISOString(), closed: false }); } }
    state.save(s); res.json({ ok: true, settings: st });
  }));

  app.post('/api/admin/marketing/targets', ...A, jsonParser, ah(async (req, res) => {
    const b = req.body || {};
    if (!CODES.has(b.market)) return bad(res, 'Choose a market.');
    const since = new Date(now() - 400 * 864e5).toISOString(), base = D.baseline((await loadRows(since).catch(() => [])) || [], b.market);
    if (base.status !== 'ready') return res.status(409).json({ ok: false, error: `Targets stay blank until two weeks of baseline exist (${base.days || 0} of 14 days so far).` });
    const t = {}; for (const k of ['visits', 'previewsPer100', 'sharesPer100', 'checkRequests', 'paid']) if (b.targets && b.targets[k] != null) { const v = num(b.targets[k]); if (!Number.isFinite(v) || v < 0) return bad(res, 'Targets are numbers of zero or more.'); t[k] = v; }
    const s = state.get(); s.settings.targets[b.market] = t; state.save(s); res.json({ ok: true, targets: t });
  }));

  return { state };
}

module.exports = { mount, MARKETS, makeState };
