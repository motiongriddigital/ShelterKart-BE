'use strict';
/**
 * ShelterKart — the pages a buyer moves through, server-rendered:
 *   /start            name the property; a proof-of-work check (when the bot guard is on) and the investigation starts
 *   /r/:ref           the free preview, live while the first sweep runs, with the unlock form (contact, price, payment)
 *   /r/:ref?t=token   the full report after payment, live while the paid investigation completes, with the PDF button
 * Payment goes through the existing quote, checkout and Razorpay verification routes. All behaviour lives in one
 * external script (/assets/report-live.js), so the pages carry no inline handlers.
 */
const H = require('./dossierHtml');
const B = require('./dossierBrief');
const esc = H.esc;

const COUNTRIES = [['IN', 'India'], ['AE', 'United Arab Emirates'], ['GB', 'United Kingdom'], ['SG', 'Singapore'], ['US', 'United States'], ['CA', 'Canada'],
  ['AU', 'Australia'], ['DE', 'Germany'], ['FR', 'France'], ['HK', 'Hong Kong'], ['IE', 'Ireland'], ['NZ', 'New Zealand'], ['ES', 'Spain'], ['CH', 'Switzerland']];
const options = sel => COUNTRIES.map(([c, n]) => `<option value="${c}"${c === sel ? ' selected' : ''}>${esc(n)}</option>`).join('');

const EXTRA_CSS = `
.prog{background:var(--gold-wash);border-left:3px solid var(--gold);padding:.7rem 1rem;margin:1.2rem 0;font-size:.95rem}
.bar{display:flex;flex-wrap:wrap;gap:.8rem 1.2rem;align-items:center;justify-content:space-between;padding:1rem 0;border-bottom:1px solid var(--rule)}
.bar a.pdf{background:var(--ink);color:#fff;text-decoration:none;padding:.5rem 1rem;font-weight:600}
.ulf{display:grid;gap:.7rem;margin-top:.9rem;max-width:26rem}
.ulf label{display:grid;gap:.25rem;font-size:.88rem;color:#dfe5ee}
.ulf input,.ulf select{font:inherit;padding:.55rem .65rem;border:1px solid #c9d2df;border-radius:3px;background:#fff;color:var(--ink)}
.ulf button,.sf button{font:inherit;font-weight:600;padding:.65rem 1.2rem;border:0;cursor:pointer;background:#F2DCA8;color:var(--ink);justify-self:start}
.ulf button:disabled,.sf button:disabled{opacity:.6;cursor:wait}
.sf{display:grid;gap:.8rem;max-width:30rem;margin:1.6rem 0}
.sf label{display:grid;gap:.25rem;font-size:.9rem;color:var(--ink-2)}
.sf input,.sf select{font:inherit;padding:.6rem .7rem;border:1px solid var(--rule);border-radius:3px;background:#fff}
.sf button{background:var(--ink);color:#fff}
#sk-unlock-msg,#sk-start-msg{min-height:1.2em;margin:.2rem 0 0;font-size:.9rem}
`;
const page = (title, body, data) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title><style>${H.CSS}${EXTRA_CSS}</style></head><body><main>${body}</main>
<div id="sk" hidden${Object.entries(data || {}).map(([k, v]) => ` data-${k}="${esc(v)}"`).join('')}></div><script src="/assets/report-live.js" defer></script></body></html>`;

/** Insert extra markup into a rendered report: after <main> (a toolbar or progress line) and inside the unlock panel. */
const inject = (html, { top = '', css = EXTRA_CSS, data = {} } = {}) => html
  .replace('</style>', css + '</style>')
  .replace('<main>', '<main>' + top)
  .replace('</body>', `<div id="sk" hidden${Object.entries(data).map(([k, v]) => ` data-${k}="${esc(v)}"`).join('')}></div><script src="/assets/report-live.js" defer></script></body>`);

function startPage({ botGuard = false, country = 'IN' } = {}) {
  return page('ShelterKart: investigate a property', `
<section style="padding:3rem 0 1rem"><p class="brand" style="font-family:'Fraunces',Georgia,serif;font-size:1.25rem;color:var(--gold-deep);margin:0">ShelterKart</p>
<h1 style="font-size:2.4rem;margin:1.2rem 0 .4rem">Know who you are paying, before you pay.</h1>
<p class="meta" style="font-size:1.05rem;max-width:36rem">Name the project. We investigate the companies behind it, what the record shows against what is marketed, and the questions to put to the developer. The first findings are free.</p>
<form id="sk-start" class="sf" data-bot="${botGuard ? 'on' : 'off'}">
<label>Project name<input name="query" required minlength="3" maxlength="120" placeholder="for example, Hubtown Celeste"></label>
<label>City or area<input name="location" maxlength="120" placeholder="for example, Worli, Mumbai"></label>
<label>Country<select name="country">${options(country)}</select></label>
<button type="submit">Investigate</button><p id="sk-start-msg" role="status" aria-live="polite"></p></form>
<p class="notice">Research, not advice. ShelterKart is paid only by buyers; no developer can influence a report.</p></section>`, {});
}

/** The investigation has started but the first sweep has not finished. */
function workingPage({ ref, query }) {
  return page(`ShelterKart: investigating ${query}`, `
<section style="padding:3rem 0 1rem"><p class="brand" style="font-family:'Fraunces',Georgia,serif;font-size:1.25rem;color:var(--gold-deep);margin:0">ShelterKart</p>
<h1 style="font-size:2.3rem;margin:1.2rem 0 .4rem">${esc(query)}</h1>
<p class="meta">Report ${esc(ref)}</p>
<p id="sk-progress" class="prog" role="status" aria-live="polite">Several AI engines are investigating the project independently. The first findings usually appear within a few minutes, and this page updates by itself.</p>
<p class="meta">You can leave this page open, or come back to this address later.</p></section>`, { ref, live: 'on', phase: 'starting' });
}

/** The free preview, with the unlock form in place of the plain button. */
function previewPage(d, { ref, price, country = 'IN', held = false, payments = true }) {
  const html = H.renderPreview(B.previewDossier(d), { price });
  const form = held ? `<p>A person is checking this report before it can be unlocked. This usually takes less than a working day; this page updates when it is ready.</p>`
    : !payments ? `<p>Payments are not switched on yet.</p>`
      : `<form id="sk-unlock" class="ulf"><label>E-mail for the report<input name="email" type="email" autocomplete="email" required></label>
<label>WhatsApp number, optional<input name="phone" type="tel" autocomplete="tel" placeholder="+91 98200 00000"></label>
<label>Billing country<select name="country">${options(country)}</select></label>
<button type="submit">Unlock the full report</button><p id="sk-unlock-msg" role="status" aria-live="polite"></p></form>`;
  const out = html.replace(/<a class="btn" href="#unlock">Unlock the full report<\/a>/, form);
  return inject(out, { data: { ref, live: d.phase === 'preview' ? 'off' : 'on', phase: d.phase || 'preview' } });
}

/** The full report for a buyer who has paid, live until the investigation completes. */
function fullPage(d, { ref, token, pdf = true }) {
  const done = d.phase === 'complete';
  const top = `<div class="bar"><span class="meta">Report ${esc(ref)}${done ? ', complete' : ''}</span>${pdf ? `<a class="pdf" href="/r/${encodeURIComponent(ref)}/pdf?t=${encodeURIComponent(token)}">Download the PDF</a>` : '<span class="meta">Use your browser\'s print to save a PDF.</span>'}</div>
${done ? '' : '<p id="sk-progress" class="prog" role="status" aria-live="polite">The investigation is still following leads. New findings and questions appear here as they arrive, and we e-mail you when it is complete.</p>'}`;
  return inject(H.renderDossier(d), { top, data: { ref, token, live: done ? 'off' : 'on', phase: d.phase || 'working' } });
}

/** A public reference report: the full report, marked as a sample, with a way to start one's own. */
function samplePage(d, { id, pdf = true }) {
  const top = `<div class="bar"><span class="meta">Sample report, built from published research to ${esc(d.asOf || '')}. Your own report is researched when you ask for it.</span><span style="display:flex;gap:.6rem;flex-wrap:wrap">${pdf ? `<a class="pdf" href="/samples/${encodeURIComponent(id)}/pdf">Download the PDF</a>` : ''}<a class="pdf" style="background:#F2DCA8;color:var(--ink)" href="/start">Investigate a property</a></span></div>`;
  return inject(H.renderDossier(d, { indexable: true }), { top, data: {} });
}

/** The one script behind every page: start, live updates, unlock and payment. */
const SCRIPT = `(function () {
  var el = document.getElementById('sk'); if (!el) return;
  var ref = el.getAttribute('data-ref') || '', token = el.getAttribute('data-token') || '', phase0 = el.getAttribute('data-phase') || '';
  function $(id) { return document.getElementById(id); }
  function post(url, body) { return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { j.status = r.status; return j; }); }); }
  if (ref && el.getAttribute('data-live') === 'on' && window.EventSource) {
    var es = new EventSource('/api/investigate/' + encodeURIComponent(ref) + '/events' + (token ? '?t=' + encodeURIComponent(token) : ''));
    var reloading = false;
    function reload() { if (reloading) return; reloading = true; setTimeout(function () { location.reload(); }, 1200); }
    es.addEventListener('progress', function (e) { try { var d = JSON.parse(e.data); if ($('sk-progress') && d.message) $('sk-progress').textContent = d.message; } catch (x) {} });
    es.addEventListener('update', function (e) { try { var d = JSON.parse(e.data); if (d.phase && d.phase !== phase0) reload(); } catch (x) {} });
    es.addEventListener('done', function () { es.close(); reload(); });
  }
  function zeros(h) { var z = 0; for (var i = 0; i < h.length; i++) { if (h[i] === 0) { z += 8; continue; } z += Math.clz32(h[i]) - 24; break; } return z; }
  function solve(tok, bits) { var enc = new TextEncoder(), n = 0;
    function step() { var s = n.toString(36); return crypto.subtle.digest('SHA-256', enc.encode(tok + ':' + s)).then(function (h) { if (zeros(new Uint8Array(h)) >= bits) return s; n++; return step(); }); }
    return step(); }
  var sf = $('sk-start');
  if (sf) sf.addEventListener('submit', function (e) {
    e.preventDefault(); var msg = $('sk-start-msg'), btn = sf.querySelector('button'); btn.disabled = true; msg.textContent = 'Starting the investigation';
    var body = { query: sf.query.value.trim(), location: sf.location.value.trim(), country: sf.country.value };
    var go = function (pow) { if (pow) body.pow = pow; return post('/api/investigate', body).then(function (r) {
      if (!r.ok) { msg.textContent = r.error || 'The investigation could not start. Please try again.'; btn.disabled = false; return; }
      location.href = '/r/' + encodeURIComponent(r.ref); }); };
    (sf.getAttribute('data-bot') === 'on'
      ? fetch('/api/research/challenge').then(function (r) { return r.json(); }).then(function (c) { msg.textContent = 'A quick check that you are not a robot'; return solve(c.token, c.bits).then(function (s) { return go({ token: c.token, solution: s }); }); })
      : go()).catch(function () { msg.textContent = 'The investigation could not start. Please try again.'; btn.disabled = false; });
  });
  function loadRzp() { return new Promise(function (ok, no) { if (window.Razorpay) return ok(); var s = document.createElement('script'); s.src = 'https://checkout.razorpay.com/v1/checkout.js'; s.onload = ok; s.onerror = function () { no(new Error('The payment window could not load. Please try again.')); }; document.head.appendChild(s); }); }
  var uf = $('sk-unlock');
  if (uf) uf.addEventListener('submit', function (e) {
    e.preventDefault(); var msg = $('sk-unlock-msg'), btn = uf.querySelector('button'); btn.disabled = true; msg.textContent = 'Checking the price';
    var fail = function (m) { msg.textContent = m || 'Something went wrong. Please try again.'; btn.disabled = false; };
    var quote, co, key = ('k' + Date.now().toString(36) + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)).slice(0, 40);
    post('/api/investigate/' + encodeURIComponent(ref) + '/contact', { email: uf.email.value, phone: uf.phone.value })
      .then(function (c) { if (!c.ok) throw new Error(c.error); return post('/api/research/quote', { ref: ref, billingCountry: uf.country.value }); })
      .then(function (q) { if (!q.ok) throw new Error(q.error); quote = q.quote; msg.textContent = 'Price: ' + quote.currency + ' ' + quote.gross + '. Opening the payment window';
        return post('/api/research/checkout', { ref: ref, idempotencyKey: key, quoteId: quote.id, billingCountry: uf.country.value }); })
      .then(function (c) { if (!c.ok) throw new Error(c.error); co = c; return loadRzp(); })
      .then(function () { new window.Razorpay({ key: co.razorpay.keyId, order_id: co.razorpay.orderId, amount: co.razorpay.amountSubunits, currency: co.currency, name: 'ShelterKart',
        description: 'Due-diligence report ' + ref, prefill: { email: uf.email.value, contact: uf.phone.value },
        handler: function (resp) { msg.textContent = 'Confirming your payment';
          post('/api/research/razorpay/verify', { ref: ref, purchaseId: co.purchaseId, razorpay_payment_id: resp.razorpay_payment_id, razorpay_signature: resp.razorpay_signature })
            .then(function (v) { if (v.ok && v.token) location.href = '/r/' + encodeURIComponent(ref) + '?t=' + encodeURIComponent(v.token); else fail(v.error || 'We could not confirm the payment. If you were charged, write to us with your receipt.'); }); },
        modal: { ondismiss: function () { fail('Payment cancelled. You have not been charged.'); } } }).open(); })
      .catch(function (err) { fail(err && err.message); });
  });
})();`;

module.exports = { startPage, workingPage, previewPage, fullPage, samplePage, SCRIPT, COUNTRIES };
