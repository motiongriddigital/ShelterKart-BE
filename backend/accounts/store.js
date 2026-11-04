'use strict';
/** Accounts: storage. Postgres when a pool is given, memory otherwise. The two share one interface and the same tests. */
const crypto = require('crypto');

const iso = d => (d instanceof Date ? d : new Date(d));

function userFromRow(r) {
  if (!r) return null;
  return {
    id: r.id, email: r.email, emailVerifiedAt: r.email_verified_at, displayName: r.display_name, country: r.country, language: r.language,
    phone: r.phone, phoneConsentAt: r.phone_consent_at, termsVersion: r.terms_version, privacyVersion: r.privacy_version,
    termsAcceptedAt: r.terms_accepted_at, createdAt: r.created_at, lastLoginAt: r.last_login_at, disabledAt: r.disabled_at, deletedAt: r.deleted_at,
  };
}

function banFromRow(r) {
  if (!r) return null;
  return { id: r.id, kind: r.kind, target: r.target, reason: r.reason, createdAt: new Date(r.created_at), expiresAt: r.expires_at ? new Date(r.expires_at) : null, createdBy: r.created_by, liftedAt: r.lifted_at ? new Date(r.lifted_at) : null, liftedBy: r.lifted_by };
}

const USER_COLS = 'id, email, email_verified_at, display_name, country, language, phone, phone_consent_at, terms_version, privacy_version, terms_accepted_at, created_at, last_login_at, disabled_at, deleted_at';
const PATCH_COLS = { displayName: 'display_name', country: 'country', language: 'language', phone: 'phone', phoneConsentAt: 'phone_consent_at' };

function makePgStore(pool) {
  const one = r => r.rows[0] || null;
  return {
    kind: 'postgres',
    async createCode({ emailLower, codeHash, expiresAt, ipHash }) {
      await pool.query(`UPDATE auth_codes SET consumed_at=now() WHERE email_lower=$1 AND consumed_at IS NULL`, [emailLower]);
      await pool.query(`INSERT INTO auth_codes (email_lower, code_hash, expires_at, ip_hash) VALUES ($1,$2,$3,$4)`, [emailLower, codeHash, iso(expiresAt), ipHash || null]);
    },
    async lastCodeAt(emailLower, ipHash) {
      const r = one(await pool.query(`SELECT created_at FROM auth_codes WHERE email_lower=$1 AND ($2::text IS NULL OR ip_hash=$2) ORDER BY created_at DESC LIMIT 1`, [emailLower, ipHash || null]));
      return r ? new Date(r.created_at) : null;
    },
    async lastCodeState(emailLower, now) {
      const r = one(await pool.query(`SELECT created_at, (consumed_at IS NULL AND expires_at > $2) AS open FROM auth_codes WHERE email_lower=$1 ORDER BY created_at DESC LIMIT 1`, [emailLower, iso(now)]));
      return r ? { createdAt: new Date(r.created_at), open: Boolean(r.open) } : null;
    },
    async countCodesSince(emailLower, since, ipHash) {
      const r = one(await pool.query(`SELECT COUNT(*)::int AS n FROM auth_codes WHERE email_lower=$1 AND created_at >= $2 AND ($3::text IS NULL OR ip_hash=$3)`, [emailLower, iso(since), ipHash || null]));
      return r ? Number(r.n) : 0;
    },
    async latestOpenCode(emailLower, now) {
      const r = one(await pool.query(`SELECT id, code_hash, attempts FROM auth_codes WHERE email_lower=$1 AND consumed_at IS NULL AND expires_at > $2 ORDER BY created_at DESC LIMIT 1`, [emailLower, iso(now)]));
      return r ? { id: r.id, codeHash: r.code_hash, attempts: Number(r.attempts) } : null;
    },
    async bumpAttempts(id) {
      const r = one(await pool.query(`UPDATE auth_codes SET attempts=attempts+1 WHERE id=$1 RETURNING attempts`, [id]));
      return r ? Number(r.attempts) : 0;
    },
    async consumeCode(id) { await pool.query(`UPDATE auth_codes SET consumed_at=now() WHERE id=$1 AND consumed_at IS NULL`, [id]); },
    async findUserByEmail(emailLower) {
      return userFromRow(one(await pool.query(`SELECT ${USER_COLS} FROM users WHERE lower(email)=$1 AND deleted_at IS NULL`, [emailLower])));
    },
    async userById(id) { return userFromRow(one(await pool.query(`SELECT ${USER_COLS} FROM users WHERE id=$1 AND deleted_at IS NULL`, [id]))); },
    async createUser({ email, language, country, termsVersion, privacyVersion, now }) {
      return userFromRow(one(await pool.query(
        `INSERT INTO users (email, language, country, terms_version, privacy_version, terms_accepted_at) VALUES ($1,$2,$3,$4,$5,$6) RETURNING ${USER_COLS}`,
        [email, language || null, country || null, termsVersion, privacyVersion, iso(now)])));
    },
    async markLogin(userId, now) {
      await pool.query(`UPDATE users SET email_verified_at=COALESCE(email_verified_at,$2), last_login_at=$2 WHERE id=$1`, [userId, iso(now)]);
    },
    async updateUser(userId, patch) {
      const sets = [], vals = [userId];
      for (const [k, col] of Object.entries(PATCH_COLS)) if (k in patch) { vals.push(patch[k] instanceof Date ? iso(patch[k]) : patch[k]); sets.push(`${col}=$${vals.length}`); }
      if (!sets.length) return this.userById(userId);
      return userFromRow(one(await pool.query(`UPDATE users SET ${sets.join(', ')} WHERE id=$1 AND deleted_at IS NULL RETURNING ${USER_COLS}`, vals)));
    },
    async createSession({ tokenHash, userId, expiresAt, ipHash, userAgent, now }) {
      await pool.query(`INSERT INTO sessions (token_hash, user_id, created_at, last_seen_at, expires_at, ip_hash, user_agent) VALUES ($1,$2,$3,$3,$4,$5,$6)`,
        [tokenHash, userId, iso(now), iso(expiresAt), ipHash || null, userAgent || null]);
    },
    async sessionByHash(tokenHash, now) {
      const r = one(await pool.query(
        `SELECT s.created_at AS s_created, s.last_seen_at AS s_seen, s.expires_at AS s_expires, ${USER_COLS.split(', ').map(c => 'u.' + c).join(', ')}
           FROM sessions s JOIN users u ON u.id = s.user_id
          WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at > $2 AND u.deleted_at IS NULL`, [tokenHash, iso(now)]));
      return r ? { createdAt: new Date(r.s_created), lastSeenAt: new Date(r.s_seen), expiresAt: new Date(r.s_expires), user: userFromRow(r) } : null;
    },
    async slideSession(tokenHash, expiresAt, now) { await pool.query(`UPDATE sessions SET last_seen_at=$3, expires_at=$2 WHERE token_hash=$1`, [tokenHash, iso(expiresAt), iso(now)]); },
    async revokeSession(tokenHash) { await pool.query(`UPDATE sessions SET revoked_at=now() WHERE token_hash=$1 AND revoked_at IS NULL`, [tokenHash]); },
    async revokeAllFor(userId) { await pool.query(`UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL`, [userId]); },
    async listSessions(userId) {
      return (await pool.query(`SELECT created_at, last_seen_at, expires_at FROM sessions WHERE user_id=$1 AND revoked_at IS NULL AND expires_at > now() ORDER BY created_at DESC`, [userId]))
        .rows.map(r => ({ createdAt: new Date(r.created_at), lastSeenAt: new Date(r.last_seen_at), expiresAt: new Date(r.expires_at) }));
    },
    async recordOpen(userId, ref, now) {
      await pool.query(`INSERT INTO user_reports (user_id, report_ref, first_opened_at, last_opened_at) VALUES ($1,$2,$3,$3)
                        ON CONFLICT (user_id, report_ref) DO UPDATE SET last_opened_at=EXCLUDED.last_opened_at`, [userId, ref, iso(now)]);
    },
    async listOpened(userId, limit) {
      return (await pool.query(`SELECT report_ref, first_opened_at, last_opened_at FROM user_reports WHERE user_id=$1 ORDER BY last_opened_at DESC LIMIT $2`, [userId, limit]))
        .rows.map(r => ({ ref: r.report_ref, firstOpenedAt: new Date(r.first_opened_at), lastOpenedAt: new Date(r.last_opened_at) }));
    },
    async scrubUser(userId, now) {
      const u = one(await pool.query(`SELECT lower(email) AS e FROM users WHERE id=$1`, [userId]));
      await pool.query(`DELETE FROM sessions WHERE user_id=$1`, [userId]);
      await pool.query(`DELETE FROM user_reports WHERE user_id=$1`, [userId]);
      if (u) await pool.query(`DELETE FROM auth_codes WHERE email_lower=$1`, [u.e]);
      if (u) await pool.query(`DELETE FROM auth_events WHERE email_lower=$1 OR user_id=$2`, [u.e, userId]); else await pool.query(`DELETE FROM auth_events WHERE user_id=$1`, [userId]);
      await pool.query(
        `UPDATE users SET email='deleted-'||id::text||'@deleted.invalid', display_name=NULL, country=NULL, language=NULL, phone=NULL, phone_consent_at=NULL,
                          terms_version=NULL, privacy_version=NULL, terms_accepted_at=NULL, deleted_at=$2 WHERE id=$1`, [userId, iso(now)]);
    },
    async purge(now) {
      const a = await pool.query(`DELETE FROM auth_codes WHERE created_at < $1`, [new Date(iso(now).getTime() - 24 * 3600 * 1000)]);
      const s = await pool.query(`DELETE FROM sessions WHERE expires_at < $1 OR revoked_at < $2`, [iso(now), new Date(iso(now).getTime() - 7 * 24 * 3600 * 1000)]);
      const e = await pool.query(`DELETE FROM auth_events WHERE at < $1`, [new Date(iso(now).getTime() - 90 * 24 * 3600 * 1000)]);
      return { codes: a.rowCount || 0, sessions: s.rowCount || 0, events: e.rowCount || 0 };
    },
    async recordEvent({ emailLower, userId, ipHash, kind, detail, at }) {
      await pool.query(`INSERT INTO auth_events (at, email_lower, user_id, ip_hash, kind, detail) VALUES ($1,$2,$3,$4,$5,$6)`,
        [iso(at || new Date()), emailLower || null, userId || null, ipHash || null, kind, detail || null]);
    },
    async eventsFor({ emailLower, userId, limit }) {
      return (await pool.query(`SELECT at, kind, detail, ip_hash FROM auth_events WHERE ($1::text IS NOT NULL AND email_lower=$1) OR ($2::uuid IS NOT NULL AND user_id=$2) ORDER BY at DESC, id DESC LIMIT $3`, [emailLower || null, userId || null, limit]))
        .rows.map(r => ({ at: new Date(r.at), kind: r.kind, detail: r.detail, ipHash: r.ip_hash }));
    },
    async eventCounts({ emailLower, userId, since }) {
      const out = {};
      for (const r of (await pool.query(`SELECT kind, COUNT(*)::int AS n FROM auth_events WHERE at >= $3 AND (($1::text IS NOT NULL AND email_lower=$1) OR ($2::uuid IS NOT NULL AND user_id=$2)) GROUP BY kind`, [emailLower || null, userId || null, iso(since)])).rows) out[r.kind] = Number(r.n);
      return out;
    },
    async eventSummary(since) {
      const out = {};
      for (const r of (await pool.query(`SELECT kind, COUNT(*)::int AS n FROM auth_events WHERE at >= $1 GROUP BY kind`, [iso(since)])).rows) out[r.kind] = Number(r.n);
      return out;
    },
    async geoCounts(since) {
      return (await pool.query(`SELECT upper(country) AS country, COUNT(*)::int AS users, COUNT(*) FILTER (WHERE created_at >= $1)::int AS new_users FROM users WHERE deleted_at IS NULL GROUP BY 1`, [iso(since)]))
        .rows.map(r => ({ country: r.country, users: Number(r.users), newUsers: Number(r.new_users) }));
    },
    async geoPaid() {
      return (await pool.query(`SELECT upper(u.country) AS country, COUNT(DISTINCT u.id)::int AS paid FROM users u JOIN report_purchases p ON p.user_id = u.id AND p.status = 'paid' WHERE u.deleted_at IS NULL GROUP BY 1`))
        .rows.map(r => ({ country: r.country, paid: Number(r.paid) }));
    },
    async listUsersAdmin({ q, limit, offset }) {
      const like = q ? '%' + q.toLowerCase().replace(/[%_]/g, '') + '%' : null;
      return (await pool.query(
        `SELECT ${USER_COLS.split(', ').map(c => 'u.' + c).join(', ')},
                (SELECT COUNT(*)::int FROM sessions s WHERE s.user_id=u.id AND s.revoked_at IS NULL AND s.expires_at > now()) AS active_sessions
           FROM users u WHERE u.deleted_at IS NULL AND ($1::text IS NULL OR lower(u.email) LIKE $1 OR lower(COALESCE(u.display_name,'')) LIKE $1)
          ORDER BY COALESCE(u.last_login_at, u.created_at) DESC LIMIT $2 OFFSET $3`, [like, limit, offset]))
        .rows.map(r => ({ ...userFromRow(r), activeSessions: Number(r.active_sessions) }));
    },
    async setDisabled(userId, disabledAt) { await pool.query(`UPDATE users SET disabled_at=$2 WHERE id=$1 AND deleted_at IS NULL`, [userId, disabledAt ? iso(disabledAt) : null]); },
    async sessionsFull(userId) {
      return (await pool.query(`SELECT token_hash, user_id, created_at, last_seen_at, expires_at, ip_hash, user_agent FROM sessions WHERE ($1::uuid IS NULL OR user_id=$1) AND revoked_at IS NULL AND expires_at > now() ORDER BY last_seen_at DESC LIMIT $2`, [userId || null, userId ? 100 : 500]))
        .rows.map(r => ({ id: r.token_hash.slice(0, 16), userId: r.user_id, createdAt: new Date(r.created_at), lastSeenAt: new Date(r.last_seen_at), expiresAt: new Date(r.expires_at), ipHash: r.ip_hash, userAgent: r.user_agent }));
    },
    async revokeByPrefix(prefix) {
      const r = one(await pool.query(`UPDATE sessions SET revoked_at=now() WHERE token_hash LIKE $1 AND revoked_at IS NULL RETURNING user_id, ip_hash`, [prefix + '%']));
      return r ? { userId: r.user_id, ipHash: r.ip_hash } : null;
    },
    async sessionByPrefix(prefix) {
      const r = one(await pool.query(`SELECT user_id, ip_hash FROM sessions WHERE token_hash LIKE $1 AND revoked_at IS NULL LIMIT 1`, [prefix + '%']));
      return r ? { userId: r.user_id, ipHash: r.ip_hash } : null;
    },
    async addBan({ kind, target, reason, expiresAt, by }) {
      return banFromRow(one(await pool.query(`INSERT INTO bans (kind, target, reason, expires_at, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING *`, [kind, target, reason, expiresAt ? iso(expiresAt) : null, by])));
    },
    async liftBan(id, by) {
      return banFromRow(one(await pool.query(`UPDATE bans SET lifted_at=now(), lifted_by=$2 WHERE id=$1 AND lifted_at IS NULL RETURNING *`, [id, by])));
    },
    async listBans({ activeOnly, now }) {
      return (await pool.query(`SELECT * FROM bans WHERE ($1::boolean IS NOT TRUE OR (lifted_at IS NULL AND (expires_at IS NULL OR expires_at > $2))) ORDER BY created_at DESC LIMIT 500`, [Boolean(activeOnly), iso(now || new Date())])).rows.map(banFromRow);
    },
    async audit(actor, action, userId, reason) {
      await pool.query(`INSERT INTO audit_log (actor, action, object_type, object_id, reason) VALUES ($1,$2,'user',$3,$4)`, [actor, action, userId || null, reason || null]);
    },
  };
}

function makeMemoryStore() {
  const users = new Map(), codes = [], sessions = new Map(), opened = new Map(), auditLog = [], events = [], bans = [];
  const live = () => [...users.values()].filter(u => !u.deletedAt);
  const copy = u => (u ? { ...u } : null);
  return {
    kind: 'memory',
    _users: users, _codes: codes, _sessions: sessions, _audit: auditLog, _events: events, _bans: bans,
    async createCode({ emailLower, codeHash, expiresAt, ipHash, now = new Date() }) {
      for (const c of codes) if (c.emailLower === emailLower && !c.consumedAt) c.consumedAt = now;
      codes.push({ id: crypto.randomUUID(), emailLower, codeHash, attempts: 0, expiresAt: iso(expiresAt), consumedAt: null, ipHash: ipHash || null, createdAt: now });
    },
    async lastCodeAt(emailLower, ipHash) { const l = codes.filter(c => c.emailLower === emailLower && (!ipHash || c.ipHash === ipHash)).map(c => c.createdAt.getTime()); return l.length ? new Date(Math.max(...l)) : null; },
    async lastCodeState(emailLower, now) {
      const c = codes.filter(x => x.emailLower === emailLower).sort((a, b) => b.createdAt - a.createdAt)[0];
      return c ? { createdAt: c.createdAt, open: !c.consumedAt && c.expiresAt > iso(now) } : null;
    },
    async countCodesSince(emailLower, since, ipHash) { return codes.filter(c => c.emailLower === emailLower && c.createdAt >= iso(since) && (!ipHash || c.ipHash === ipHash)).length; },
    async latestOpenCode(emailLower, now) {
      const l = codes.filter(c => c.emailLower === emailLower && !c.consumedAt && c.expiresAt > iso(now)).sort((a, b) => b.createdAt - a.createdAt)[0];
      return l ? { id: l.id, codeHash: l.codeHash, attempts: l.attempts } : null;
    },
    async bumpAttempts(id) { const c = codes.find(x => x.id === id); if (!c) return 0; c.attempts++; return c.attempts; },
    async consumeCode(id) { const c = codes.find(x => x.id === id); if (c && !c.consumedAt) c.consumedAt = new Date(); },
    async findUserByEmail(emailLower) { return copy(live().find(u => u.email.toLowerCase() === emailLower)); },
    async userById(id) { const u = users.get(id); return u && !u.deletedAt ? copy(u) : null; },
    async createUser({ email, language, country, termsVersion, privacyVersion, now }) {
      const u = { id: crypto.randomUUID(), email, emailVerifiedAt: null, displayName: null, country: country || null, language: language || null, phone: null, phoneConsentAt: null,
        termsVersion, privacyVersion, termsAcceptedAt: iso(now), createdAt: iso(now), lastLoginAt: null, disabledAt: null, deletedAt: null };
      users.set(u.id, u); return copy(u);
    },
    async markLogin(userId, now) { const u = users.get(userId); if (u) { u.emailVerifiedAt = u.emailVerifiedAt || iso(now); u.lastLoginAt = iso(now); } },
    async updateUser(userId, patch) {
      const u = users.get(userId); if (!u || u.deletedAt) return null;
      for (const k of Object.keys(PATCH_COLS)) if (k in patch) u[k] = patch[k];
      return copy(u);
    },
    async createSession({ tokenHash, userId, expiresAt, ipHash, userAgent, now }) {
      sessions.set(tokenHash, { tokenHash, userId, createdAt: iso(now), lastSeenAt: iso(now), expiresAt: iso(expiresAt), revokedAt: null, ipHash: ipHash || null, userAgent: userAgent || null });
    },
    async sessionByHash(tokenHash, now) {
      const s = sessions.get(tokenHash); if (!s || s.revokedAt || s.expiresAt <= iso(now)) return null;
      const u = users.get(s.userId); if (!u || u.deletedAt) return null;
      return { createdAt: s.createdAt, lastSeenAt: s.lastSeenAt, expiresAt: s.expiresAt, user: copy(u) };
    },
    async slideSession(tokenHash, expiresAt, now) { const s = sessions.get(tokenHash); if (s) { s.expiresAt = iso(expiresAt); s.lastSeenAt = iso(now); } },
    async revokeSession(tokenHash) { const s = sessions.get(tokenHash); if (s && !s.revokedAt) s.revokedAt = new Date(); },
    async revokeAllFor(userId) { for (const s of sessions.values()) if (s.userId === userId && !s.revokedAt) s.revokedAt = new Date(); },
    async listSessions(userId) {
      return [...sessions.values()].filter(s => s.userId === userId && !s.revokedAt && s.expiresAt > new Date()).sort((a, b) => b.createdAt - a.createdAt)
        .map(s => ({ createdAt: s.createdAt, lastSeenAt: s.lastSeenAt, expiresAt: s.expiresAt }));
    },
    async recordOpen(userId, ref, now) {
      const k = userId + '|' + ref, o = opened.get(k);
      if (o) o.lastOpenedAt = iso(now); else opened.set(k, { userId, ref, firstOpenedAt: iso(now), lastOpenedAt: iso(now) });
    },
    async listOpened(userId, limit) {
      return [...opened.values()].filter(o => o.userId === userId).sort((a, b) => b.lastOpenedAt - a.lastOpenedAt).slice(0, limit)
        .map(o => ({ ref: o.ref, firstOpenedAt: o.firstOpenedAt, lastOpenedAt: o.lastOpenedAt }));
    },
    async scrubUser(userId, now) {
      const u = users.get(userId); if (!u) return;
      for (const [h, s] of sessions) if (s.userId === userId) sessions.delete(h);
      for (const k of [...opened.keys()]) if (k.startsWith(userId + '|')) opened.delete(k);
      for (let i = codes.length - 1; i >= 0; i--) if (codes[i].emailLower === u.email.toLowerCase()) codes.splice(i, 1);
      for (let i = events.length - 1; i >= 0; i--) if (events[i].userId === userId || events[i].emailLower === u.email.toLowerCase()) events.splice(i, 1);
      Object.assign(u, { email: `deleted-${u.id}@deleted.invalid`, displayName: null, country: null, language: null, phone: null, phoneConsentAt: null, termsVersion: null, privacyVersion: null, termsAcceptedAt: null, deletedAt: iso(now) });
    },
    async purge(now) {
      const n = iso(now).getTime(); let c = 0, s = 0;
      for (let i = codes.length - 1; i >= 0; i--) if (codes[i].createdAt.getTime() < n - 24 * 3600 * 1000) { codes.splice(i, 1); c++; }
      for (const [h, x] of sessions) if (x.expiresAt.getTime() < n || (x.revokedAt && x.revokedAt.getTime() < n - 7 * 24 * 3600 * 1000)) { sessions.delete(h); s++; }
      let ev = 0;
      for (let i = events.length - 1; i >= 0; i--) if (events[i].at.getTime() < n - 90 * 24 * 3600 * 1000) { events.splice(i, 1); ev++; }
      return { codes: c, sessions: s, events: ev };
    },
    async recordEvent({ emailLower, userId, ipHash, kind, detail, at }) { events.push({ at: iso(at || new Date()), emailLower: emailLower || null, userId: userId || null, ipHash: ipHash || null, kind, detail: detail || null }); },
    async eventsFor({ emailLower, userId, limit }) {
      return events.map((e, i) => ({ e, i })).filter(({ e }) => (emailLower && e.emailLower === emailLower) || (userId && e.userId === userId))
        .sort((a, b) => (b.e.at - a.e.at) || (b.i - a.i)).slice(0, limit).map(({ e }) => ({ at: e.at, kind: e.kind, detail: e.detail, ipHash: e.ipHash }));
    },
    async eventCounts({ emailLower, userId, since }) {
      const out = {};
      for (const e of events) if (e.at >= iso(since) && ((emailLower && e.emailLower === emailLower) || (userId && e.userId === userId))) out[e.kind] = (out[e.kind] || 0) + 1;
      return out;
    },
    async eventSummary(since) { const out = {}; for (const e of events) if (e.at >= iso(since)) out[e.kind] = (out[e.kind] || 0) + 1; return out; },
    async geoCounts(since) {
      const by = new Map();
      for (const u of live()) { const k = u.country ? String(u.country).toUpperCase() : null, r = by.get(k) || { country: k, users: 0, newUsers: 0 }; r.users++; if (new Date(u.createdAt) >= since) r.newUsers++; by.set(k, r); }
      return [...by.values()];
    },
    async geoPaid() { return []; },
    async listUsersAdmin({ q, limit, offset }) {
      const t = q ? q.toLowerCase() : null;
      return live().filter(u => !t || u.email.toLowerCase().includes(t) || (u.displayName || '').toLowerCase().includes(t))
        .sort((a, b) => new Date(b.lastLoginAt || b.createdAt) - new Date(a.lastLoginAt || a.createdAt)).slice(offset, offset + limit)
        .map(u => ({ ...u, activeSessions: [...sessions.values()].filter(s => s.userId === u.id && !s.revokedAt && s.expiresAt > new Date()).length }));
    },
    async setDisabled(userId, disabledAt) { const u = users.get(userId); if (u && !u.deletedAt) u.disabledAt = disabledAt ? iso(disabledAt) : null; },
    async sessionsFull(userId) {
      return [...sessions.values()].filter(s => (!userId || s.userId === userId) && !s.revokedAt && s.expiresAt > new Date()).sort((a, b) => b.lastSeenAt - a.lastSeenAt).slice(0, userId ? 100 : 500)
        .map(s => ({ id: s.tokenHash.slice(0, 16), userId: s.userId, createdAt: s.createdAt, lastSeenAt: s.lastSeenAt, expiresAt: s.expiresAt, ipHash: s.ipHash, userAgent: s.userAgent }));
    },
    async revokeByPrefix(prefix) {
      const s = [...sessions.values()].find(x => x.tokenHash.startsWith(prefix) && !x.revokedAt);
      if (!s) return null; s.revokedAt = new Date(); return { userId: s.userId, ipHash: s.ipHash };
    },
    async sessionByPrefix(prefix) { const s = [...sessions.values()].find(x => x.tokenHash.startsWith(prefix) && !x.revokedAt); return s ? { userId: s.userId, ipHash: s.ipHash } : null; },
    async addBan({ kind, target, reason, expiresAt, by }) {
      const b = { id: crypto.randomUUID(), kind, target, reason, createdAt: new Date(), expiresAt: expiresAt ? iso(expiresAt) : null, createdBy: by, liftedAt: null, liftedBy: null };
      bans.push(b); return { ...b };
    },
    async liftBan(id, by) { const b = bans.find(x => x.id === id && !x.liftedAt); if (!b) return null; b.liftedAt = new Date(); b.liftedBy = by; return { ...b }; },
    async listBans({ activeOnly, now }) {
      const n = iso(now || new Date());
      return bans.filter(b => !activeOnly || (!b.liftedAt && (!b.expiresAt || b.expiresAt > n))).sort((a, b) => b.createdAt - a.createdAt).slice(0, 500).map(b => ({ ...b }));
    },
    async audit(actor, action, userId, reason) { auditLog.push({ actor, action, userId: userId || null, reason: reason || null, at: new Date() }); },
  };
}

function makeAccountStore(pool) { return pool ? makePgStore(pool) : makeMemoryStore(); }

module.exports = { makeAccountStore, makePgStore, makeMemoryStore };
