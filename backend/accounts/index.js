'use strict';
/**
 * User accounts: sign-in by e-mail code, cookie sessions, the signed-in user's reports, export and deletion.
 * Every outside thing is passed in. Off unless ACCOUNTS_ENABLED=on, and then every guarded route needs a session.
 * Design: docs/accounts/TDD.md. Contract: docs/api/openapi.yaml, tag Accounts.
 */
const S = require('./secrets');
const { settings, validate } = require('./config');
const { makeAccountStore } = require('./store');

const DAY = 24 * 3600 * 1000;
const LANG_RE = /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/;
const clip = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, n);

const publicUser = u => (u ? {
  id: u.id, email: u.email, displayName: u.displayName || null, country: u.country || null, language: u.language || null,
  phone: u.phone || null, createdAt: u.createdAt ? new Date(u.createdAt).toISOString() : null,
} : null);

function createAccounts(deps = {}) {
  const env = deps.env || process.env, cfg = settings(env), enabled = cfg.enabled;
  const store = deps.store || makeAccountStore(null);
  const now = deps.now || (() => Date.now());
  const at = () => new Date(now());
  const mail = deps.mail || (async () => false);
  const alert = deps.alert || (async () => {});
  const bot = deps.bot || { enabled: () => false, verify: () => ({ ok: true }) };
  const purchasesOf = deps.purchasesOf || (async () => []);
  const entitledFn = deps.entitled || (async () => false);
  const briefInfo = deps.briefInfo || (async () => null);
  const rateLimit = deps.rateLimit || (() => (req, res, next) => next());
  const problems = validate(env, { hasDatabase: store.kind === 'postgres', mailConfigured: Boolean(deps.mailConfigured) });

  const fail = (res, status, code, error, extra = {}) => res.status(status).json({ ok: false, code, error, ...extra });
  const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
  const tokenOf = req => {
    const header = (req.headers && req.headers.cookie) || (req.get && req.get('cookie')) || '';
    const t = S.parseCookies(header)[S.cookieName(cfg.secure)];
    return t && S.TOKEN_RE.test(t) ? t : '';
  };
  const setCookie = (res, token, maxAgeSeconds) => res.append('Set-Cookie', S.sessionCookie(token, { secure: cfg.secure, maxAgeSeconds }));
  const clearCookie = res => res.append('Set-Cookie', S.clearedCookie(cfg.secure));
  const audit = (actor, action, userId, reason) => Promise.resolve(store.audit(actor, action, userId, reason)).catch(e => console.error('[accounts] audit failed:', e && e.message));

  async function user(req) {
    if (!enabled) return null;
    if (req.accountUser !== undefined) return req.accountUser;
    req.accountUser = null;
    const token = tokenOf(req);
    if (!token) return null;
    const hash = S.hashToken(token), found = await store.sessionByHash(hash, at());
    if (!found || found.user.disabledAt) return null;
    const t = now();
    if (t - new Date(found.lastSeenAt).getTime() > DAY) {
      const until = Math.min(t + cfg.sessionDays * DAY, new Date(found.createdAt).getTime() + cfg.sessionMaxDays * DAY);
      await store.slideSession(hash, new Date(until), at());
    }
    req.accountSession = hash;
    req.accountUser = found.user;
    return found.user;
  }

  const guard = wrap(async (req, res, next) => {
    if (!enabled) return next();
    if (await user(req)) return next();
    return fail(res, 401, 'auth_required', 'Sign in to continue.');
  });

  const guardStart = cfg.searchGate === 'start' ? guard : (req, res, next) => next();

  const guardPage = wrap(async (req, res, next) => {
    if (!enabled) return next();
    if (await user(req)) return next();
    res.redirect(302, '/signin?next=' + encodeURIComponent(S.safeNext(req.originalUrl || req.url || '/')));
  });

  const entitled = async (req, ref) => {
    const u = await user(req);
    return Boolean(u) && Boolean(await entitledFn(u.id, ref));
  };
  const touch = (req, ref) => {
    if (!enabled) return;
    user(req).then(u => (u ? store.recordOpen(u.id, ref, at()) : null)).catch(() => {});
  };

  async function reportsOf(u, limit = 100) {
    const opened = await store.listOpened(u.id, limit), bought = await purchasesOf(u.id);
    const byRef = new Map();
    for (const o of opened) byRef.set(o.ref, { ref: o.ref, firstOpenedAt: o.firstOpenedAt, lastOpenedAt: o.lastOpenedAt, paid: false, purchasedAt: null, amount: null, currency: null });
    for (const p of bought) {
      if (p.status !== 'paid') continue;
      const row = byRef.get(p.ref) || { ref: p.ref, firstOpenedAt: p.createdAt, lastOpenedAt: p.createdAt, paid: false, purchasedAt: null, amount: null, currency: null };
      Object.assign(row, { paid: true, purchasedAt: p.createdAt, amount: Number(p.amount), currency: p.currency });
      byRef.set(p.ref, row);
    }
    const rows = [...byRef.values()].sort((a, b) => new Date(b.lastOpenedAt) - new Date(a.lastOpenedAt)).slice(0, limit);
    for (const r of rows) {
      let info = null; try { info = await briefInfo(r.ref); } catch { info = null; }
      r.projectName = (info && info.projectName) || null; r.market = (info && info.market) || null;
      for (const k of ['firstOpenedAt', 'lastOpenedAt', 'purchasedAt']) r[k] = r[k] ? new Date(r[k]).toISOString() : null;
    }
    return rows;
  }

  function mount(app) {
    if (!enabled) return;
    const limCode = rateLimit({ windowMs: 3600e3, max: 20, message: { ok: false, code: 'rate_limited', error: 'Too many requests. Please try again later.' } });
    const limVerify = rateLimit({ windowMs: 3600e3, max: 30, message: { ok: false, code: 'rate_limited', error: 'Too many requests. Please try again later.' } });
    const limMe = rateLimit({ windowMs: 3600e3, max: 120, message: { ok: false, code: 'rate_limited', error: 'Too many requests. Please try again later.' } });

    app.post('/api/auth/request-code', limCode, wrap(async (req, res) => {
      const b = req.body || {}, email = S.normEmail(b.email);
      if (!email) return fail(res, 400, 'invalid_email', 'Enter a valid e-mail address.');
      if (bot.enabled(env)) {
        const v = bot.verify(b.pow, env);
        if (!v.ok) return fail(res, 428, 'challenge', 'Please complete the quick check and try again.');
      }
      const t = now(), last = await store.lastCodeAt(email);
      if (last && t - last.getTime() < 60000) return fail(res, 429, 'cooldown', 'Please wait a minute before asking for another code.', { retryAfter: Math.ceil((60000 - (t - last.getTime())) / 1000) });
      if (await store.countCodesSince(email, new Date(t - 3600e3)) >= 5) return fail(res, 429, 'rate_limited', 'Too many codes were requested for this address. Please try again later.', { retryAfter: 3600 });
      const code = S.newCode();
      await store.createCode({ emailLower: email, codeHash: S.hashCode(cfg.pepper, email, code), expiresAt: new Date(t + cfg.codeMinutes * 60000), ipHash: S.hashIp(cfg.pepper, req.ip), now: at() });
      const sent = await mail({ to: email, subject: 'Your ShelterKart sign-in code',
        text: `Your ShelterKart sign-in code is ${code}\n\nIt works for ${cfg.codeMinutes} minutes. If you did not ask for it, ignore this e-mail: nobody can sign in without the code.` }).catch(() => false);
      if (!sent) { console.error('[accounts] the sign-in code could not be sent'); alert('sign-in codes are not being sent', 'The e-mail provider refused or is not configured.').catch(() => {}); }
      const out = { ok: true, cooldownSeconds: 60, codeLength: 6 };
      if (cfg.devEcho && !cfg.production) out.devCode = code;
      res.status(202).json(out);
    }));

    app.post('/api/auth/verify-code', limVerify, wrap(async (req, res) => {
      const b = req.body || {}, email = S.normEmail(b.email), code = String(b.code == null ? '' : b.code).trim();
      if (!email || !/^\d{6}$/.test(code)) return fail(res, 400, 'invalid_code', 'That code is not right. Check the latest e-mail and try again.');
      const open = await store.latestOpenCode(email, at());
      if (!open) return fail(res, 400, 'invalid_code', 'That code is not right or has expired. Ask for a new one.');
      const tries = await store.bumpAttempts(open.id);
      if (tries > cfg.codeAttempts) {
        await store.consumeCode(open.id);
        await audit('anonymous', 'auth.login_failed', null, 'too many wrong codes');
        return fail(res, 429, 'too_many_attempts', 'Too many wrong codes. Ask for a new one.');
      }
      if (!S.sameHash(open.codeHash, S.hashCode(cfg.pepper, email, code)))
        return fail(res, 400, 'invalid_code', 'That code is not right. Check the latest e-mail and try again.', { attemptsLeft: Math.max(0, cfg.codeAttempts - tries) });
      let u = await store.findUserByEmail(email), isNewUser = false;
      if (!u) {
        if (b.termsAccepted !== true) return fail(res, 400, 'consent_required', 'Please accept the terms and the privacy notice to create your account.');
        u = await store.createUser({ email, language: LANG_RE.test(String(b.language || '')) ? String(b.language) : null, country: null, termsVersion: cfg.termsVersion, privacyVersion: cfg.privacyVersion, now: at() });
        isNewUser = true;
      }
      if (u.disabledAt) return fail(res, 403, 'account_disabled', 'This account is disabled. Write to us if you think that is a mistake.');
      await store.consumeCode(open.id);
      await store.markLogin(u.id, at());
      const token = S.newToken(), t = now();
      await store.createSession({ tokenHash: S.hashToken(token), userId: u.id, expiresAt: new Date(t + cfg.sessionDays * DAY), ipHash: S.hashIp(cfg.pepper, req.ip), userAgent: clip(req.get && req.get('user-agent'), 200), now: at() });
      setCookie(res, token, cfg.sessionDays * DAY / 1000);
      await audit('user:' + u.id, 'auth.login', u.id, isNewUser ? 'new account' : null);
      res.json({ ok: true, isNewUser, user: publicUser({ ...u, lastLoginAt: at() }) });
    }));

    app.post('/api/auth/logout', limMe, guard, wrap(async (req, res) => {
      const u = await user(req);
      if (req.accountSession) await store.revokeSession(req.accountSession);
      clearCookie(res);
      await audit('user:' + u.id, 'auth.logout', u.id, null);
      res.json({ ok: true });
    }));

    app.post('/api/auth/logout-all', limMe, guard, wrap(async (req, res) => {
      const u = await user(req);
      await store.revokeAllFor(u.id);
      clearCookie(res);
      await audit('user:' + u.id, 'auth.logout', u.id, 'all sessions');
      res.json({ ok: true });
    }));

    app.get('/api/me', limMe, guard, wrap(async (req, res) => {
      res.set('Cache-Control', 'no-store');
      res.json({ ok: true, user: publicUser(await user(req)) });
    }));

    app.patch('/api/me', limMe, guard, wrap(async (req, res) => {
      const u = await user(req), b = req.body || {}, patch = {};
      if ('displayName' in b) patch.displayName = clip(b.displayName, 80) || null;
      if ('country' in b) {
        const c = String(b.country || '').trim().toUpperCase();
        if (c && !/^[A-Z]{2}$/.test(c)) return fail(res, 400, 'invalid_country', 'Use a two-letter country code.');
        patch.country = c || null;
      }
      if ('language' in b) {
        const l = String(b.language || '').trim();
        if (l && !LANG_RE.test(l)) return fail(res, 400, 'invalid_language', 'That language is not available.');
        patch.language = l || null;
      }
      if ('phone' in b) {
        const raw = String(b.phone || '').trim();
        if (!raw) { patch.phone = null; patch.phoneConsentAt = null; }
        else {
          const digits = raw.replace(/[\s().-]/g, ''), ok = /^\+?\d{7,15}$/.test(digits);
          if (!ok) return fail(res, 400, 'invalid_phone', 'Enter the phone number with its country code.');
          if (b.whatsappConsent !== true) return fail(res, 400, 'consent_required', 'Tick the box to allow messages on WhatsApp.');
          patch.phone = digits.startsWith('+') ? digits : '+' + digits; patch.phoneConsentAt = at();
        }
      }
      const next = await store.updateUser(u.id, patch);
      res.json({ ok: true, user: publicUser(next) });
    }));

    app.get('/api/me/reports', limMe, guard, wrap(async (req, res) => {
      const u = await user(req);
      res.set('Cache-Control', 'no-store');
      res.json({ ok: true, reports: await reportsOf(u) });
    }));

    app.get('/api/me/export', limMe, guard, wrap(async (req, res) => {
      const u = await user(req);
      const purchases = (await purchasesOf(u.id)).map(p => ({ ref: p.ref, amount: Number(p.amount), currency: p.currency, status: p.status, createdAt: p.createdAt ? new Date(p.createdAt).toISOString() : null }));
      await audit('user:' + u.id, 'account.export', u.id, null);
      res.set({ 'Cache-Control': 'no-store', 'Content-Disposition': 'attachment; filename="shelterkart-my-data.json"' });
      res.json({ ok: true, exportedAt: at().toISOString(), user: publicUser(u), consents: { termsVersion: u.termsVersion || null, privacyVersion: u.privacyVersion || null, termsAcceptedAt: u.termsAcceptedAt ? new Date(u.termsAcceptedAt).toISOString() : null, phoneConsentAt: u.phoneConsentAt ? new Date(u.phoneConsentAt).toISOString() : null },
        sessions: (await store.listSessions(u.id)).map(s => ({ createdAt: s.createdAt.toISOString(), lastSeenAt: s.lastSeenAt.toISOString(), expiresAt: s.expiresAt.toISOString() })),
        reports: await reportsOf(u, 1000), purchases });
    }));

    app.delete('/api/me', limMe, guard, wrap(async (req, res) => {
      const u = await user(req);
      if (!req.body || req.body.confirm !== 'DELETE') return fail(res, 400, 'confirm_required', 'Type DELETE to confirm.');
      await audit('user:' + u.id, 'account.delete', u.id, null);
      await store.scrubUser(u.id, at());
      clearCookie(res);
      res.json({ ok: true });
    }));
  }

  const cleanup = () => store.purge(at());

  return { enabled, settings: cfg, problems, store, user, guard, guardStart, guardPage, entitled, touch, mount, cleanup, publicUser };
}

module.exports = { createAccounts, publicUser };
