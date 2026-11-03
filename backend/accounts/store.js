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
    async lastCodeAt(emailLower) {
      const r = one(await pool.query(`SELECT created_at FROM auth_codes WHERE email_lower=$1 ORDER BY created_at DESC LIMIT 1`, [emailLower]));
      return r ? new Date(r.created_at) : null;
    },
    async countCodesSince(emailLower, since) {
      const r = one(await pool.query(`SELECT COUNT(*)::int AS n FROM auth_codes WHERE email_lower=$1 AND created_at >= $2`, [emailLower, iso(since)]));
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
      await pool.query(
        `UPDATE users SET email='deleted-'||id::text||'@deleted.invalid', display_name=NULL, country=NULL, language=NULL, phone=NULL, phone_consent_at=NULL,
                          terms_version=NULL, privacy_version=NULL, terms_accepted_at=NULL, deleted_at=$2 WHERE id=$1`, [userId, iso(now)]);
    },
    async purge(now) {
      const a = await pool.query(`DELETE FROM auth_codes WHERE created_at < $1`, [new Date(iso(now).getTime() - 24 * 3600 * 1000)]);
      const s = await pool.query(`DELETE FROM sessions WHERE expires_at < $1 OR revoked_at < $2`, [iso(now), new Date(iso(now).getTime() - 7 * 24 * 3600 * 1000)]);
      return { codes: a.rowCount || 0, sessions: s.rowCount || 0 };
    },
    async audit(actor, action, userId, reason) {
      await pool.query(`INSERT INTO audit_log (actor, action, object_type, object_id, reason) VALUES ($1,$2,'user',$3,$4)`, [actor, action, userId || null, reason || null]);
    },
  };
}

function makeMemoryStore() {
  const users = new Map(), codes = [], sessions = new Map(), opened = new Map(), auditLog = [];
  const live = () => [...users.values()].filter(u => !u.deletedAt);
  const copy = u => (u ? { ...u } : null);
  return {
    kind: 'memory',
    _users: users, _codes: codes, _sessions: sessions, _audit: auditLog,
    async createCode({ emailLower, codeHash, expiresAt, ipHash, now = new Date() }) {
      for (const c of codes) if (c.emailLower === emailLower && !c.consumedAt) c.consumedAt = now;
      codes.push({ id: crypto.randomUUID(), emailLower, codeHash, attempts: 0, expiresAt: iso(expiresAt), consumedAt: null, ipHash: ipHash || null, createdAt: now });
    },
    async lastCodeAt(emailLower) { const l = codes.filter(c => c.emailLower === emailLower).map(c => c.createdAt.getTime()); return l.length ? new Date(Math.max(...l)) : null; },
    async countCodesSince(emailLower, since) { return codes.filter(c => c.emailLower === emailLower && c.createdAt >= iso(since)).length; },
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
      Object.assign(u, { email: `deleted-${u.id}@deleted.invalid`, displayName: null, country: null, language: null, phone: null, phoneConsentAt: null, termsVersion: null, privacyVersion: null, termsAcceptedAt: null, deletedAt: iso(now) });
    },
    async purge(now) {
      const n = iso(now).getTime(); let c = 0, s = 0;
      for (let i = codes.length - 1; i >= 0; i--) if (codes[i].createdAt.getTime() < n - 24 * 3600 * 1000) { codes.splice(i, 1); c++; }
      for (const [h, x] of sessions) if (x.expiresAt.getTime() < n || (x.revokedAt && x.revokedAt.getTime() < n - 7 * 24 * 3600 * 1000)) { sessions.delete(h); s++; }
      return { codes: c, sessions: s };
    },
    async audit(actor, action, userId, reason) { auditLog.push({ actor, action, userId: userId || null, reason: reason || null, at: new Date() }); },
  };
}

function makeAccountStore(pool) { return pool ? makePgStore(pool) : makeMemoryStore(); }

module.exports = { makeAccountStore, makePgStore, makeMemoryStore };
