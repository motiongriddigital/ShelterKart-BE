#!/usr/bin/env node
'use strict';
/**
 * Checks the marketing desk's platform keys WITHOUT posting anything: one read-only call per service. Run it with the real keys in the
 * environment before switching SOCIAL_PUBLISH to live. The request shapes follow each service's public documentation and have NOT been
 * confirmed against the live services from this build (no keys were available), so a failure here is information, not a bug report.
 *   node tools/social_sandbox_check.js            (prints what is configured; no network)
 *   node tools/social_sandbox_check.js --network  (adds the read-only calls)
 */
const net = process.argv.includes('--network');
const env = process.env, rows = [];
const mask = v => (v ? 'set' : 'not set');
async function call(url, init) { try { const r = await fetch(url, init); let b = null; try { b = await r.json(); } catch {} return { status: r.status, body: b }; } catch (e) { return { error: String(e.message).slice(0, 80) }; } }
(async () => {
  rows.push(['SOCIAL_ENGINE', env.SOCIAL_ENGINE === 'on' ? 'on' : 'off (the desk answers 503)']);
  rows.push(['SOCIAL_PUBLISH', env.SOCIAL_PUBLISH === 'live' ? 'LIVE: posts go out for real' : 'dry run (safe default)']);
  rows.push(['storage', env.DATABASE_URL ? 'Postgres' : env.SOCIAL_DATA_DIR ? 'files in ' + env.SOCIAL_DATA_DIR : 'MEMORY ONLY: the engine will refuse to start']);
  for (const k of ['AYRSHARE_API_KEY', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHANNEL_ID', 'TELEGRAM_APPROVER_CHAT_ID', 'TELEGRAM_APPROVER_USER_ID', 'TELEGRAM_WEBHOOK_SECRET', 'LINE_CHANNEL_TOKEN', 'SOCIAL_APPROVAL_PIN', 'PUBLIC_BASE_URL']) rows.push([k, mask(env[k])]);
  if (net) {
    if (env.AYRSHARE_API_KEY) { const r = await call((env.AYRSHARE_BASE_URL || 'https://api.ayrshare.com/api').replace(/\/$/, '') + '/user', { headers: { Authorization: 'Bearer ' + env.AYRSHARE_API_KEY, ...(env.AYRSHARE_PROFILE_KEY ? { 'Profile-Key': env.AYRSHARE_PROFILE_KEY } : {}) } }); rows.push(['publishing service: key accepted', r.error ? 'no answer: ' + r.error : r.status === 200 ? 'yes' : 'HTTP ' + r.status]); if (r.body && Array.isArray(r.body.activeSocialAccounts)) rows.push(['publishing service: linked accounts', r.body.activeSocialAccounts.join(', ') || 'none']); }
    if (env.TELEGRAM_BOT_TOKEN) { const r = await call(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getMe`); rows.push(['Telegram: bot token accepted', r.error ? 'no answer: ' + r.error : r.body && r.body.ok ? 'yes (@' + r.body.result.username + ')' : 'HTTP ' + r.status]); }
    if (env.LINE_CHANNEL_TOKEN) { const r = await call('https://api.line.me/v2/bot/info', { headers: { Authorization: 'Bearer ' + env.LINE_CHANNEL_TOKEN } }); rows.push(['LINE: channel token accepted', r.error ? 'no answer: ' + r.error : r.status === 200 ? 'yes' : 'HTTP ' + r.status]); }
  }
  const w = Math.max(...rows.map(r => r[0].length)); for (const [k, v] of rows) console.log(k.padEnd(w + 2) + v);
  console.log('\nNothing was posted. Nothing is verified for X, Instagram, Facebook, LinkedIn, YouTube, TikTok or Threads until a sandbox profile has posted once.');
})();
