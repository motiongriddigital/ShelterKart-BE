'use strict';
/**
 * The chat bot for the founder: alerts, the daily digest, veto, pause, resume, status. It does NOT approve. Approval happens on the web
 * page (which works on a phone), because a one-tap approval in a chat skips the reading that the weekly pack is built to require,
 * and the known-bad post in every pack exists to catch exactly that. Only the configured chat and user are answered; everyone else
 * gets silence, so the bot reveals nothing. The webhook must carry the secret token or it is refused.
 */
const crypto = require('crypto');
const same = (a, b) => { const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || '')); return x.length > 0 && x.length === y.length && crypto.timingSafeEqual(x, y); };
const esc = s => String(s == null ? '' : s).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));

function makeBot({ desk, env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const token = () => env.TELEGRAM_BOT_TOKEN, chat = () => String(env.TELEGRAM_APPROVER_CHAT_ID || ''), user = () => String(env.TELEGRAM_APPROVER_USER_ID || ''), secret = () => env.TELEGRAM_WEBHOOK_SECRET || '';
  const base = () => (env.PUBLIC_BASE_URL || '').replace(/\/$/, ''), padmin = () => (base() ? base() + '/admin/social' : '');
  const configured = () => Boolean(token() && chat() && user() && secret());
  async function api(method, payload) {
    if (!token()) return { ok: false, skipped: 'no token' };
    try { const r = await fetchImpl(`https://api.telegram.org/bot${token()}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); let b = null; try { b = await r.json(); } catch {} return { ok: Boolean(r.ok && b && b.ok), status: r.status }; }
    catch { return { ok: false, error: 'network' }; }
  }
  const send = (text, extra = {}) => api('sendMessage', { chat_id: chat(), text: String(text).slice(0, 4000), parse_mode: 'HTML', disable_web_page_preview: true, ...extra });
  const buttons = rows => ({ reply_markup: { inline_keyboard: rows } });
  const linkRow = () => (padmin() ? [[{ text: 'Open the desk', url: padmin() }]] : []);

  /** The pack is ready: tell the founder, and point to the page where it is read and approved. */
  const notifyPack = pack => send(`<b>The weekly pack is ready</b>\nWeek of ${esc(pack.week)}: ${pack.summary.approvable} posts to read and approve.\nHeld for you: ${pack.summary.held.length}. Blocked by the checker: ${pack.summary.blocked.length}. Gaps in the knowledge base: ${pack.summary.gaps.length}.\nApproval is done on the page, where the sample and the checks can be read.`, buttons([...linkRow(), [{ text: 'Pause everything', callback_data: 'pg' }]]));
  const notifyAlert = (subject, text) => send(`<b>${esc(subject)}</b>\n${esc(text)}`, buttons([...linkRow(), [{ text: 'Pause everything', callback_data: 'pg' }]]));
  function digestText(hours = 24) {
    const d = desk.digest(hours), lines = d.items.slice(0, 40).map(i => `${esc(i.localTime)} ${esc(i.marketName)}, ${esc(i.platform)}  <code>${esc(i.id)}</code>`);
    return `<b>Next ${hours} hours: ${d.count} posts</b>\n` + (lines.join('\n') || 'Nothing is scheduled.') + (d.count > 40 ? `\n…and ${d.count - 40} more` : '') + '\n\nTo stop one: /veto &lt;id&gt;';
  }
  const notifyDigest = (hours = 24) => send(digestText(hours), buttons([...linkRow(), [{ text: 'Pause everything', callback_data: 'pg' }]]));
  function statusText() { const s = desk.status(); return `<b>Desk status</b>\nMode: ${esc(s.mode)}\nApproved and waiting: ${s.approvedAhead} (${s.bufferDays} days ahead)\nPaused: ${s.pauses.length ? s.pauses.map(p => esc(p.scope + (p.key ? ' ' + p.key : ''))).join(', ') : 'nothing'}\nAudit log: ${s.audit.ok ? 'intact' : 'BROKEN'}`; }

  /** One incoming update. `headers` carries the webhook secret. Returns { ok, action }, and answers only the founder. */
  async function handleUpdate(update, headers = {}) {
    if (!configured() || !same(headers['x-telegram-bot-api-secret-token'], secret())) return { ok: false, code: 'forbidden' };
    const msg = update && (update.message || (update.callback_query && update.callback_query.message)), from = update && ((update.message && update.message.from) || (update.callback_query && update.callback_query.from));
    if (!from || String(from.id) !== user() || !msg || String(msg.chat && msg.chat.id) !== chat()) return { ok: true, action: 'ignored' };      // silence for everyone else
    if (update.callback_query) {
      const d = update.callback_query.data; await api('answerCallbackQuery', { callback_query_id: update.callback_query.id });
      if (d === 'pg') { desk.pause('global', null, 'paused from the chat bot', { by: 'founder' }); await send('Everything is paused. Send /resume to release it.'); return { ok: true, action: 'pause' }; }
      return { ok: true, action: 'ignored' };
    }
    const text = String(update.message.text || '').trim(), [cmd, ...rest] = text.split(/\s+/), arg = rest.join(' ');
    switch ((cmd || '').toLowerCase().replace(/@\w+$/, '')) {
      case '/status': await send(statusText()); return { ok: true, action: 'status' };
      case '/queue': await send(digestText(24)); return { ok: true, action: 'queue' };
      case '/pause': desk.pause('global', null, 'paused from the chat bot', { by: 'founder' }); await send('Everything is paused. Send /resume to release it.'); return { ok: true, action: 'pause' };
      case '/resume': { const ok = desk.resume('global', null, { by: 'founder' }); await send(ok ? 'Released. Posting carries on.' : 'There was no global pause.'); return { ok: true, action: 'resume' }; }
      case '/veto': { const id = rest[0]; if (!id) { await send('Send /veto and the post id, for example /veto GB-2026-10-30-IG'); return { ok: true, action: 'help' }; } const r = desk.veto({ id }, { by: 'founder', reason: rest.slice(1).join(' ') || 'vetoed from the chat bot' }); await send(r.vetoed ? `Vetoed ${esc(id)}. It will not be published.` : `Nothing to veto for ${esc(id)}: it may already be published or not exist.`); return { ok: true, action: 'veto', vetoed: r.vetoed }; }
      case '/start': case '/help': await send('Commands: /status, /queue, /veto &lt;id&gt;, /pause, /resume. Approval is done on the desk page.'); return { ok: true, action: 'help' };
      default: void arg; return { ok: true, action: 'ignored' };
    }
  }
  return { configured, notifyPack, notifyAlert, notifyDigest, handleUpdate, digestText, statusText };
}
module.exports = { makeBot };
