'use strict';
/**
 * Accounts: the admin side. Users, their sessions and sign-in activity, and bans (an account or an IP address).
 * Every route is behind the operator login (adminAuth). Contract: docs/api/openapi.yaml, tag Admin.
 * An IP address is only ever shown as a short peppered hash; the raw address is never stored with a session.
 */

const { buildGeo } = require('./geo');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SESSION_ID = /^[0-9a-f]{16}$/;
const iso = d => (d ? new Date(d).toISOString() : null);
const short = h => (h ? String(h).slice(0, 12) : null);
const DAY = 24 * 3600 * 1000;

function summaryOf(n = {}) {
  return {
    codesRequested: n.code_requested || 0,
    signIns: n.login_ok || 0,
    wrongCodes: n.code_wrong || 0,
    locked: n.code_locked || 0,
    expiredCodes: n.code_expired || 0,
    cooldownHits: n.cooldown || 0,
    rateLimited: (n.rate_limited_email || 0) + (n.ip_rate_limited || 0),
    blocked: (n.login_blocked_ip || 0) + (n.login_blocked_account || 0) + (n.login_blocked_disabled || 0),
  };
}

function mountAdmin(app, ctx) {
  const { store, adminAuth, wrap, fail, audit, at, now, S, purchasesOf, reportsOf, dropBanCache, activeBans, rateLimit } = ctx;
  const A = [rateLimit({ windowMs: 15 * 60e3, max: 300, message: { ok: false, error: 'Too many requests. Please try again later.' } }), adminAuth];
  const json = (res, body) => { res.set('Cache-Control', 'no-store'); res.json({ ok: true, ...body }); };
  const bad = (res, error) => fail(res, 400, 'invalid', error);
  const idOf = (req, res) => { const id = String(req.params.id || ''); if (!UUID.test(id)) { fail(res, 400, 'invalid', 'Invalid identifier.'); return null; } return id; };

  const userRow = u => ({ id: u.id, email: u.email, displayName: u.displayName || null, country: u.country || null, language: u.language || null,
    createdAt: iso(u.createdAt), lastLoginAt: iso(u.lastLoginAt), disabled: Boolean(u.disabledAt), activeSessions: u.activeSessions == null ? undefined : u.activeSessions });
  const sessionRow = s => ({ id: s.id, userId: s.userId, createdAt: iso(s.createdAt), lastSeenAt: iso(s.lastSeenAt), expiresAt: iso(s.expiresAt), ip: short(s.ipHash), userAgent: s.userAgent || null });
  const banRow = b => ({ id: b.id, kind: b.kind, target: b.target.startsWith('hash:') ? 'hash:' + short(b.target.slice(5)) : b.target, reason: b.reason, createdAt: iso(b.createdAt), expiresAt: iso(b.expiresAt),
    createdBy: b.createdBy, liftedAt: iso(b.liftedAt), liftedBy: b.liftedBy || null, active: !b.liftedAt && (!b.expiresAt || new Date(b.expiresAt) > at()) });

  app.get('/api/admin/users', ...A, wrap(async (req, res) => {
    const q = String((req.query || {}).q || '').trim().slice(0, 80), limit = Math.min(100, Math.max(1, parseInt((req.query || {}).limit, 10) || 50)), offset = Math.max(0, parseInt((req.query || {}).offset, 10) || 0);
    json(res, { users: (await store.listUsersAdmin({ q: q || null, limit, offset })).map(userRow), limit, offset });
  }));

  app.get('/api/admin/users/:id', ...A, wrap(async (req, res) => {
    const id = idOf(req, res); if (!id) return;
    const u = await store.userById(id);
    if (!u) return fail(res, 404, 'not_found', 'No such user.');
    const email = u.email.toLowerCase(), t = now();
    const [sessions, purchases, reports, c24, c7, c30, events, bans] = await Promise.all([
      store.sessionsFull(id), purchasesOf(id), reportsOf(u, 50),
      store.eventCounts({ emailLower: email, userId: id, since: new Date(t - DAY) }), store.eventCounts({ emailLower: email, userId: id, since: new Date(t - 7 * DAY) }),
      store.eventCounts({ emailLower: email, userId: id, since: new Date(t - 30 * DAY) }), store.eventsFor({ emailLower: email, userId: id, limit: 50 }), activeBans(),
    ]);
    json(res, {
      user: { ...userRow(u), termsVersion: u.termsVersion || null, privacyVersion: u.privacyVersion || null, termsAcceptedAt: iso(u.termsAcceptedAt) },
      banned: bans.some(b => b.kind === 'account' && b.target === email),
      sessions: sessions.map(sessionRow),
      purchases: purchases.map(p => ({ ref: p.ref, amount: Number(p.amount), currency: p.currency, status: p.status, createdAt: iso(p.createdAt) })),
      reports,
      signIn: { last24h: summaryOf(c24), last7d: summaryOf(c7), last30d: summaryOf(c30), events: events.map(e => ({ at: iso(e.at), kind: e.kind, detail: e.detail, ip: short(e.ipHash) })) },
    });
  }));

  const setDisabled = disabled => wrap(async (req, res) => {
    const id = idOf(req, res); if (!id) return;
    const u = await store.userById(id);
    if (!u) return fail(res, 404, 'not_found', 'No such user.');
    await store.setDisabled(id, disabled ? at() : null);
    if (disabled) await store.revokeAllFor(id);
    await audit('admin', disabled ? 'admin.user_disable' : 'admin.user_enable', id, String((req.body || {}).reason || '').slice(0, 300) || null);
    json(res, { id, disabled });
  });
  app.post('/api/admin/users/:id/disable', ...A, setDisabled(true));
  app.post('/api/admin/users/:id/enable', ...A, setDisabled(false));

  app.post('/api/admin/users/:id/sessions/revoke', ...A, wrap(async (req, res) => {
    const id = idOf(req, res); if (!id) return;
    if (!(await store.userById(id))) return fail(res, 404, 'not_found', 'No such user.');
    await store.revokeAllFor(id);
    await audit('admin', 'admin.sessions_revoke', id, 'all sessions');
    json(res, { id });
  }));

  app.get('/api/admin/sessions', ...A, wrap(async (req, res) => {
    const list = await store.sessionsFull(null), byId = new Map();
    for (const s of list) if (!byId.has(s.userId)) byId.set(s.userId, await store.userById(s.userId));
    json(res, { sessions: list.map(s => ({ ...sessionRow(s), email: (byId.get(s.userId) || {}).email || null })) });
  }));

  app.post('/api/admin/sessions/:id/revoke', ...A, wrap(async (req, res) => {
    const id = String(req.params.id || '');
    if (!SESSION_ID.test(id)) return bad(res, 'Invalid identifier.');
    const s = await store.revokeByPrefix(id);
    if (!s) return fail(res, 404, 'not_found', 'No such active session.');
    await audit('admin', 'admin.session_revoke', s.userId, id);
    json(res, { id });
  }));

  async function addBan(req, res, { kind, target, reason, days, by = 'admin' }) {
    const clean = S.cleanBanTarget(kind, target);
    if (!clean) return bad(res, kind === 'ip' ? 'Enter an IPv4 address or a range from /8 to /32, such as 185.220.101.0/24.' : 'Enter the account e-mail address.');
    const why = String(reason == null ? '' : reason).replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
    if (why.length < 8 || why.length > 500) return bad(res, 'Say why, in 8 to 500 characters. It is kept in the audit trail.');
    const d = days == null || days === '' || Number(days) === 0 ? null : Number(days);
    if (d !== null && (!Number.isInteger(d) || d < 1 || d > 3650)) return bad(res, 'Choose a number of days from 1 to 3650, or leave it empty for no end.');
    if (kind === 'ip' && !clean.startsWith('hash:') && S.ipMatches(clean, String(req.ip || '').replace(/^::ffff:/, ''), null)) return fail(res, 400, 'self_ban', 'That would block the address you are using now.');
    if ((await activeBans()).some(b => b.kind === kind && b.target === clean)) return fail(res, 409, 'exists', 'That is already banned.');
    const ban = await store.addBan({ kind, target: clean, reason: why, expiresAt: d ? new Date(now() + d * DAY) : null, by });
    if (kind === 'account') { const u = await store.findUserByEmail(clean); if (u) await store.revokeAllFor(u.id); }
    dropBanCache();
    await audit(by, 'admin.ban_add', null, `${kind} ${clean}: ${why}`.slice(0, 500));
    return ban;
  }

  app.post('/api/admin/sessions/:id/ban-ip', ...A, wrap(async (req, res) => {
    const id = String(req.params.id || '');
    if (!SESSION_ID.test(id)) return bad(res, 'Invalid identifier.');
    const s = await store.sessionByPrefix(id);
    if (!s || !s.ipHash) return fail(res, 404, 'not_found', 'No such active session.');
    const b = req.body || {}, ban = await addBan(req, res, { kind: 'ip', target: 'hash:' + s.ipHash, reason: b.reason, days: b.days });
    if (!ban) return;
    await store.revokeByPrefix(id);
    json(res, { ban: banRow(ban) });
  }));

  app.get('/api/admin/bans', ...A, wrap(async (req, res) => {
    const all = String((req.query || {}).status || 'active') === 'all';
    json(res, { bans: (await store.listBans({ activeOnly: !all, now: at() })).map(banRow) });
  }));

  app.post('/api/admin/bans', ...A, wrap(async (req, res) => {
    const b = req.body || {};
    if (b.kind !== 'ip' && b.kind !== 'account') return bad(res, 'kind must be ip or account.');
    const ban = await addBan(req, res, { kind: b.kind, target: b.target, reason: b.reason, days: b.days });
    if (ban) json(res, { ban: banRow(ban) });
  }));

  app.post('/api/admin/bans/:id/lift', ...A, wrap(async (req, res) => {
    const id = idOf(req, res); if (!id) return;
    const ban = await store.liftBan(id, 'admin');
    if (!ban) return fail(res, 404, 'not_found', 'No such active ban.');
    dropBanCache();
    await audit('admin', 'admin.ban_lift', null, `${ban.kind} ${ban.target}`.slice(0, 300));
    json(res, { ban: banRow(ban) });
  }));

  app.get('/api/admin/geo/users', ...A, wrap(async (req, res) => {
    const [rows, paid] = await Promise.all([store.geoCounts(new Date(now() - 7 * DAY)), store.geoPaid()]);
    json(res, buildGeo(rows, paid));
  }));

  app.get('/api/admin/auth/summary', ...A, wrap(async (req, res) => {
    const hours = Math.min(24 * 90, Math.max(1, parseInt((req.query || {}).hours, 10) || 24));
    json(res, { hours, summary: summaryOf(await store.eventSummary(new Date(now() - hours * 3600e3))) });
  }));
}

module.exports = { mountAdmin, summaryOf };
