'use strict';
/**
 * ShelterKart — delivering a report: an e-mail and a WhatsApp message with the link to the report and its PDF.
 *
 * Providers (configured by settings, any subset):
 *   E-mail     Resend (RESEND_API_KEY) or Postmark (POSTMARK_SERVER_TOKEN); sender DELIVERY_FROM.
 *   WhatsApp   Meta's WhatsApp Cloud API (WHATSAPP_TOKEN, WHATSAPP_PHONE_ID). A business may only start a conversation
 *              with an approved template (WHATSAPP_TEMPLATE, language WHATSAPP_TEMPLATE_LANG) whose body takes two
 *              parameters: the project name and the report link.
 * Each message is retried with backoff (1, 5 and 30 minutes by default); every attempt is recorded for the dashboard.
 * Nothing here ever blocks a buyer's page or a payment: delivery runs in the background.
 */
const PUBLIC = env => String(env.PUBLIC_BASE_URL || env.SITE_URL || '').replace(/\/+$/, '');
const DELAYS = [60e3, 5 * 60e3, 30 * 60e3];

function messageOf({ project, link, pdfLink }) {
  const subject = `Your ShelterKart report: ${project}`;
  const text = `Your ShelterKart due-diligence report on ${project} is ready.\n\nRead it and download the PDF: ${link}\n${pdfLink ? `PDF: ${pdfLink}\n` : ''}\nThe questions are grouped by the team at the developer who should answer them. Keep this link: the page is refreshed if we find something new.\n\nResearch, not advice. ShelterKart is paid only by buyers.`;
  const html = `<p>Your ShelterKart due-diligence report on <b>${esc(project)}</b> is ready.</p><p><a href="${esc(link)}">Read the report and download the PDF</a></p><p>The questions are grouped by the team at the developer who should answer them. Keep this link: the page is refreshed if we find something new.</p><p style="color:#52657F;font-size:13px">Research, not advice. ShelterKart is paid only by buyers.</p>`;
  return { subject, text, html };
}
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const EMAIL = {
  resend: {
    configured: env => Boolean(env.RESEND_API_KEY && env.DELIVERY_FROM),
    async send({ to, msg }, { env, fetchImpl }) {
      const r = await fetchImpl('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: env.DELIVERY_FROM, to: [to], subject: msg.subject, html: msg.html, text: msg.text }) });
      if (!r.ok) throw new Error(`Resend answered ${r.status}`);
      const j = await r.json().catch(() => ({})); return { id: j.id || '' };
    },
  },
  postmark: {
    configured: env => Boolean(env.POSTMARK_SERVER_TOKEN && env.DELIVERY_FROM),
    async send({ to, msg }, { env, fetchImpl }) {
      const r = await fetchImpl('https://api.postmarkapp.com/email', { method: 'POST', headers: { 'X-Postmark-Server-Token': env.POSTMARK_SERVER_TOKEN, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ From: env.DELIVERY_FROM, To: to, Subject: msg.subject, HtmlBody: msg.html, TextBody: msg.text, MessageStream: env.POSTMARK_STREAM || 'outbound' }) });
      if (!r.ok) throw new Error(`Postmark answered ${r.status}`);
      const j = await r.json().catch(() => ({})); return { id: j.MessageID || '' };
    },
  },
};
const WHATSAPP = {
  configured: env => Boolean(env.WHATSAPP_TOKEN && env.WHATSAPP_PHONE_ID && env.WHATSAPP_TEMPLATE),
  async send({ to, project, link }, { env, fetchImpl }) {
    const v = env.WHATSAPP_API_VERSION || 'v21.0';
    const r = await fetchImpl(`https://graph.facebook.com/${v}/${encodeURIComponent(env.WHATSAPP_PHONE_ID)}/messages`, { method: 'POST',
      headers: { Authorization: `Bearer ${env.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to: to.replace(/^\+/, ''), type: 'template',
        template: { name: env.WHATSAPP_TEMPLATE, language: { code: env.WHATSAPP_TEMPLATE_LANG || 'en' },
          components: [{ type: 'body', parameters: [{ type: 'text', text: String(project).slice(0, 60) }, { type: 'text', text: link }] }] } }) });
    if (!r.ok) throw new Error(`WhatsApp answered ${r.status}`);
    const j = await r.json().catch(() => ({})); return { id: (j.messages && j.messages[0] && j.messages[0].id) || '' };
  },
};

function emailProvider(env) {
  const want = String(env.DELIVERY_EMAIL_PROVIDER || '').toLowerCase();
  if (want && EMAIL[want] && EMAIL[want].configured(env)) return want;
  return Object.keys(EMAIL).find(k => EMAIL[k].configured(env)) || null;
}

/**
 * The delivery service. send() queues one report for one buyer and returns at once; attempts run in the background.
 * Injected clock and timer make the retries testable.
 */
function createDelivery({ env = process.env, fetchImpl = globalThis.fetch, onGiveUp = () => {}, setTimer = (fn, ms) => { const t = setTimeout(fn, ms); if (t && t.unref) t.unref(); return t; }, delays = DELAYS } = {}) {
  const log = [];   // every attempt: { ref, channel, to (masked), ok, error, at, attempt }
  const failed = new Map();   // 'ref|channel' -> a delivery that gave up and is waiting for an operator: { job, ch, error, attempts, at, busy }
  const mask = (ch, to) => (ch === 'email' ? to.replace(/^(.).*(@.*)$/, '$1•••$2') : to.replace(/^(\+\d{2}).*(\d{3})$/, '$1•••$2'));
  function attempt(job, ch, n, manual = false) {
    const key = job.ref + '|' + ch;
    const run = async () => {
      try {
        let out;
        if (ch === 'email') out = await EMAIL[job.emailProvider].send({ to: job.email, msg: job.msg }, { env, fetchImpl });
        else out = await WHATSAPP.send({ to: job.phone, project: job.project, link: job.link }, { env, fetchImpl });
        log.push({ ref: job.ref, channel: ch, to: mask(ch, ch === 'email' ? job.email : job.phone), ok: true, id: out.id, attempt: n + 1, at: new Date().toISOString() });
        failed.delete(key);
      } catch (e) {
        log.push({ ref: job.ref, channel: ch, to: mask(ch, ch === 'email' ? job.email : job.phone), ok: false, error: String((e && e.message) || e).slice(0, 120), attempt: n + 1, at: new Date().toISOString() });
        const error = String((e && e.message) || e).slice(0, 160);
        if (manual) { const f = failed.get(key); if (f) { f.attempts += 1; f.error = error; f.at = new Date().toISOString(); } }
        else if (n < delays.length) setTimer(() => attempt(job, ch, n + 1), delays[n]);
        else {
          failed.set(key, { job, ch, error, attempts: n + 1, at: new Date().toISOString(), busy: false });
          try { onGiveUp({ ref: job.ref, channel: ch, error }); } catch { /* alerting must never break delivery */ }
        }
      }
    };
    return run();
  }
  return {
    /** Queue a report for a buyer. Returns which channels were queued and why any were not. */
    send({ ref, project, email, phone, link, pdfLink }) {
      const job = { ref, project, email, phone, link, pdfLink, msg: messageOf({ project, link, pdfLink }), emailProvider: emailProvider(env) };
      const queued = [], skipped = [], runs = [];
      if (email) { if (job.emailProvider) { queued.push('email'); runs.push(attempt(job, 'email', 0)); } else skipped.push({ channel: 'email', reason: 'no e-mail provider is set up' }); }
      if (phone) { if (WHATSAPP.configured(env)) { queued.push('whatsapp'); runs.push(attempt(job, 'whatsapp', 0)); } else skipped.push({ channel: 'whatsapp', reason: 'WhatsApp is not set up' }); }
      for (const s of skipped) log.push({ ref, channel: s.channel, ok: false, error: s.reason, attempt: 0, at: new Date().toISOString() });
      return { queued, skipped, done: Promise.all(runs) };
    },
    /** Deliveries that gave up after every automatic retry. Masked address only; kept in memory, so a restart forgets them. */
    failed() { return [...failed.values()].map(f => ({ ref: f.job.ref, channel: f.ch, to: mask(f.ch, f.ch === 'email' ? f.job.email : f.job.phone), error: f.error, attempts: f.attempts, at: f.at })); },
    /** One more attempt by hand, once: a second call while it runs is refused, and a failure does not alert again. */
    retry(ref, ch) {
      const f = failed.get(ref + '|' + ch);
      if (!f) return { ok: false, code: 'not_failed' };
      if (f.busy) return { ok: false, code: 'busy' };
      f.busy = true;
      const done = attempt(f.job, ch, 0, true).finally(() => { f.busy = false; });
      return { ok: true, done };
    },
    status() { return { email: emailProvider(env), whatsapp: WHATSAPP.configured(env), recent: log.slice(-50) }; },
    log,
  };
}

/** The link a buyer receives: the report page with its access token, on the public site. */
const reportLink = (env, ref, token) => `${PUBLIC(env)}/r/${encodeURIComponent(ref)}?t=${encodeURIComponent(token)}`;

/**
 * Tell the operator (OPS_ALERT_EMAIL) when something needs a person. Uses the configured e-mail provider. Always writes to
 * the server log as well. Resolves to whether an e-mail was sent. Never throws.
 */
async function alertOperator(env, subject, text, fetchImpl = globalThis.fetch) {
  console.error('[ops] ' + subject + ' ' + text);
  const to = env.OPS_ALERT_EMAIL, provider = emailProvider(env);
  if (!to || !provider) return false;
  try { await EMAIL[provider].send({ to, msg: { subject: '[ShelterKart ops] ' + subject, text, html: '<pre>' + String(text).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]) + '</pre>' } }, { env, fetchImpl }); return true; }
  catch (e) { console.error('[ops] could not send the alert:', e && e.message); return false; }
}

/** Send one plain e-mail with the configured provider. Resolves to whether it was sent; never throws. */
async function sendEmail(env, { to, subject, text }, fetchImpl = globalThis.fetch) {
  const provider = emailProvider(env); if (!provider || !to) return false;
  const html = '<pre style="font-family:inherit;white-space:pre-wrap">' + String(text).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]) + '</pre>';
  try { await EMAIL[provider].send({ to, msg: { subject, text, html } }, { env, fetchImpl }); return true; }
  catch (e) { console.error('[email] could not send:', e && e.message); return false; }
}

module.exports = { createDelivery, reportLink, messageOf, emailProvider, alertOperator, sendEmail };
