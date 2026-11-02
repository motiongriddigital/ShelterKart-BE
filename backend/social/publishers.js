'use strict';
/**
 * The publisher: takes ONE approved post and puts it on ONE platform. It never changes the post.
 * SAFE BY DEFAULT: unless SOCIAL_PUBLISH=live is set, every post goes to the dry-run adapter, which only records what would have been posted.
 * Live routes: Telegram and LINE directly through their official bot interfaces; everything else through a publishing service (Ayrshare),
 * whose apps are already audited for TikTok and YouTube. Errors carry whether a retry is sensible, and never carry a key or a header.
 * Ayrshare, Telegram and LINE request shapes below follow each service's public documentation and were NOT run against the live
 * services (no keys in this build): run tools/social_sandbox_check.js with a sandbox profile before switching to live.
 */
const SCHED = require('./schedule');
class PublishError extends Error { constructor(message, { retryable = false, code = 'publish_error', status = null } = {}) { super(message); this.retryable = retryable; this.code = code; this.status = status; } }
const textOf = spec => spec.body + (spec.hashtags && spec.hashtags.length ? '\n\n' + spec.hashtags.join(' ') : '');
const clip = s => String(s || '').replace(/\s+/g, ' ').slice(0, 200);
const mediaUrls = spec => (spec.media || []).filter(m => m.url).map(m => m.url);
const SECRETS = ['AYRSHARE_API_KEY', 'AYRSHARE_PROFILE_KEY', 'TELEGRAM_BOT_TOKEN', 'LINE_CHANNEL_TOKEN', 'TELEGRAM_WEBHOOK_SECRET'];
const redact = (text, env) => { let out = String(text); for (const k of SECRETS) { const v = env[k]; if (v && String(v).length >= 4) out = out.split(String(v)).join('[redacted]'); } return out; };
const retryableStatus = s => s === 408 || s === 425 || s === 429 || (s >= 500 && s < 600);

async function call(fetchImpl, url, init, label, timeoutMs = 20000) {
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null, timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
  let res; try { res = await fetchImpl(url, { ...init, ...(ctl ? { signal: ctl.signal } : {}) }); }
  catch (e) { throw new PublishError(`${label}: the request did not complete (${clip(e && e.name === 'AbortError' ? 'timed out' : e && e.message)})`, { retryable: true, code: 'network' }); }
  finally { if (timer) clearTimeout(timer); }
  let body = null; try { body = await res.json(); } catch { body = null; }
  return { res, body };
}

function dryrun() {
  const sent = [];
  return { id: 'dryrun', sent, configured: () => true, async publish(post) { sent.push({ id: post.id, platform: post.spec.platform, market: post.spec.market, at: Date.now(), text: textOf(post.spec) }); return { ok: true, remoteId: 'dry-' + post.id, provider: 'dryrun' }; } };
}

function ayrshare({ env, fetchImpl }) {
  const key = () => env.AYRSHARE_API_KEY, base = () => (env.AYRSHARE_BASE_URL || 'https://api.ayrshare.com/api').replace(/\/$/, '');
  return {
    id: 'ayrshare', configured: () => Boolean(key()),
    async publish(post) {
      const spec = post.spec, P = SCHED.PLATFORMS[spec.platform], net = P && P.ayrshare;
      if (!net) throw new PublishError(`${spec.platform} is not served by the publishing service`, { code: 'unsupported_platform' });
      const urls = mediaUrls(spec); if (P.requiresMedia && !urls.length) throw new PublishError('the post needs its image or video at a public address, and it has none', { code: 'media_not_available' });
      const body = { post: textOf(spec), platforms: [net], ...(urls.length ? { mediaUrls: urls } : {}), shortenLinks: false };
      if (P.mediaKind === 'video') body.isVideo = true;
      if (spec.platform === 'YT') body.youTubeOptions = { title: spec.title || textOf(spec).slice(0, 90), visibility: 'public', shorts: true };
      if (spec.disclosure && spec.disclosure.aiGenerated) body.aiGenerated = true;      // the service passes the platform's own AI label where the platform has one
      const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key(), ...(env.AYRSHARE_PROFILE_KEY ? { 'Profile-Key': env.AYRSHARE_PROFILE_KEY } : {}) };
      const { res, body: out } = await call(fetchImpl, base() + '/post', { method: 'POST', headers, body: JSON.stringify(body) }, 'publishing service');
      if (res.ok && out && out.status === 'success') { const ids = Array.isArray(out.postIds) ? out.postIds : []; return { ok: true, remoteId: String((ids[0] && ids[0].id) || out.id || ''), url: (ids[0] && ids[0].postUrl) || '', provider: 'ayrshare' }; }
      const msg = clip((out && (out.message || (out.errors && out.errors[0] && (out.errors[0].message || out.errors[0].code)))) || 'the service did not accept the post');
      throw new PublishError(`publishing service: ${msg}`, { retryable: retryableStatus(res.status), status: res.status, code: res.status === 429 ? 'rate_limited' : 'rejected' });
    },
  };
}

function telegram({ env, fetchImpl }) {
  const token = () => env.TELEGRAM_BOT_TOKEN, chat = () => env.TELEGRAM_CHANNEL_ID;
  return {
    id: 'telegram', configured: () => Boolean(token() && chat()),
    async publish(post) {
      const spec = post.spec, urls = mediaUrls(spec), text = textOf(spec), photo = urls[0];
      const method = photo ? 'sendPhoto' : 'sendMessage', payload = photo ? { chat_id: chat(), photo, caption: text.slice(0, 1024) } : { chat_id: chat(), text, disable_web_page_preview: false };
      if (SCHED.PLATFORMS[spec.platform].requiresMedia && !photo) throw new PublishError('the card is not available at a public address', { code: 'media_not_available' });
      const { res, body } = await call(fetchImpl, `https://api.telegram.org/bot${token()}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }, 'Telegram');
      if (res.ok && body && body.ok) return { ok: true, remoteId: String(body.result && body.result.message_id), provider: 'telegram' };
      throw new PublishError('Telegram: ' + clip(body && body.description || 'not accepted'), { retryable: retryableStatus(res.status), status: res.status, code: res.status === 429 ? 'rate_limited' : 'rejected' });
    },
  };
}

function line({ env, fetchImpl }) {
  const token = () => env.LINE_CHANNEL_TOKEN;
  return {
    id: 'line', configured: () => Boolean(token()),
    async publish(post) {
      const spec = post.spec, urls = mediaUrls(spec), messages = [];
      if (urls[0]) messages.push({ type: 'image', originalContentUrl: urls[0], previewImageUrl: urls[0] });
      else if (SCHED.PLATFORMS[spec.platform].requiresMedia) throw new PublishError('the card is not available at a public address', { code: 'media_not_available' });
      messages.push({ type: 'text', text: textOf(spec).slice(0, 5000) });
      const { res, body } = await call(fetchImpl, 'https://api.line.me/v2/bot/message/broadcast', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token() }, body: JSON.stringify({ messages }) }, 'LINE');
      if (res.ok) return { ok: true, remoteId: 'line-' + post.id, provider: 'line' };
      throw new PublishError('LINE: ' + clip(body && body.message || 'not accepted'), { retryable: retryableStatus(res.status), status: res.status, code: res.status === 429 ? 'rate_limited' : 'rejected' });
    },
  };
}

function makePublisher({ env = process.env, fetchImpl = globalThis.fetch, routes } = {}) {
  const live = env.SOCIAL_PUBLISH === 'live', dry = dryrun(), adapters = { ayrshare: ayrshare({ env, fetchImpl }), telegram: telegram({ env, fetchImpl }), line: line({ env, fetchImpl }) };
  const route = routes || { TG: 'telegram', LN: 'line', default: 'ayrshare' }, pick = platform => adapters[route[platform] || route.default];
  return {
    mode: live ? 'live' : 'dryrun', dry,
    async publish(post) {
      if (!live) return dry.publish(post);
      const a = pick(post.spec.platform); if (!a) throw new PublishError('no route for ' + post.spec.platform, { code: 'no_route' });
      if (!a.configured()) throw new PublishError(`${a.id} is not set up (no key)`, { code: 'not_configured' });
      try { return await a.publish(post); }
      catch (e) { if (e instanceof PublishError) e.message = redact(e.message, env); throw e; }       // a service may echo a key back: it must never reach the audit log
    },
    /** What is set up, never the keys themselves. */
    status: () => ({ mode: live ? 'live' : 'dryrun', routes: Object.fromEntries(Object.keys(SCHED.PLATFORMS).map(p => { const a = pick(p); return [p, a ? { adapter: a.id, configured: a.configured() } : null]; })) }),
  };
}
module.exports = { makePublisher, PublishError, dryrun, ayrshare, telegram, line, textOf };
