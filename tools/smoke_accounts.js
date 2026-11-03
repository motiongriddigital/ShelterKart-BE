'use strict';
const base = process.argv[2] || 'http://localhost:3001';
let failed = 0;
const ok = (label, c) => { if (!c) failed++; console.log((c ? '  ok   ' : '  FAIL ') + label); };
const jar = { cookie: '' };
async function call(method, path, body) {
  const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(jar.cookie ? { Cookie: jar.cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
  const set = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
  if (set.length) jar.cookie = set[0].split(';')[0];
  let json = null; try { json = await r.json(); } catch { json = null; }
  return { status: r.status, json, headers: r.headers, set };
}
(async () => {
  const email = 'smoke-' + Date.now() + '@example.com';
  ok('a guarded route refuses a visitor with no session (401 auth_required)', (await call('POST', '/api/research/quote', {})).json.code === 'auth_required');
  ok('the search may start without a session (the wall is on the results)', (await call('POST', '/api/investigate', { query: 'xx' })).status !== 401);
  ok('a public route works with no session', (await call('GET', '/api/markets')).status === 200);
  ok('a bad e-mail address is refused', (await call('POST', '/api/auth/request-code', { email: 'nope' })).json.code === 'invalid_email');
  const rc = await call('POST', '/api/auth/request-code', { email });
  ok('a code is requested (202) and the dev echo returns it', rc.status === 202 && /^\d{6}$/.test(String(rc.json.devCode)));
  ok('asking again at once is held back (cooldown)', (await call('POST', '/api/auth/request-code', { email })).json.code === 'cooldown');
  ok('a wrong code is refused with the tries left', (await call('POST', '/api/auth/verify-code', { email, code: rc.json.devCode === '000000' ? '111111' : '000000', termsAccepted: true })).json.attemptsLeft === 4);
  const noConsent = await call('POST', '/api/auth/verify-code', { email, code: rc.json.devCode });
  ok('a new address must accept the terms; the code is kept', noConsent.json.code === 'consent_required');
  const vc = await call('POST', '/api/auth/verify-code', { email, code: rc.json.devCode, termsAccepted: true });
  ok('the right code signs in and sets an HttpOnly, SameSite=Lax cookie', vc.status === 200 && vc.json.isNewUser === true && /HttpOnly/.test(vc.set[0]) && /SameSite=Lax/.test(vc.set[0]));
  const me = await call('GET', '/api/me');
  ok('/api/me returns the user', me.status === 200 && me.json.user.email === email);
  ok('/api/me/reports answers with a list', Array.isArray((await call('GET', '/api/me/reports')).json.reports));
  ok('the profile can be updated', (await call('PATCH', '/api/me', { displayName: 'Smoke', country: 'in' })).json.user.country === 'IN');
  const guarded = await call('POST', '/api/research/quote', {});
  ok('a guarded route now lets the signed-in user through (not 401)', guarded.status !== 401);
  const page = await fetch(base + '/r/SK-AAAAAAAAAAAA', { redirect: 'manual', headers: { Cookie: '' } });
  ok('the report page sends a visitor without a cookie to /signin', page.status === 302 && /^\/signin\?next=/.test(page.headers.get('location') || ''));
  const saved = jar.cookie;
  ok('sign out ends the session', (await call('POST', '/api/auth/logout', {})).status === 200);
  jar.cookie = saved;
  ok('the old cookie is refused after sign-out', (await call('GET', '/api/me')).status === 401);
  const rc2 = await (async () => { const g = await fetch(base + '/api/health'); return g.status; })();
  ok('the server is still healthy', rc2 === 200);
  console.log(failed ? '\n' + failed + ' FAILED' : '\nall passing against ' + base);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
