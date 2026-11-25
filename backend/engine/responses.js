'use strict';
/**
 * Respond or correct (constitution rules 4 and 5).
 *
 * Two doors, one panel. The RIGHT OF REPLY is for the developer or anyone named in a report: free, unconditional, published beside the
 * finding it answers, labelled, and it never changes the finding. The RIGHT OF CORRECTION is for anyone: a correction changes a finding
 * only with evidence, after the sources are re-checked, and every correction is dated and public with the original kept.
 *
 * Flow: submit -> the sender confirms by e-mail -> automatic screening -> a clean reply is published at once; a flagged one, a legal or
 * privacy notice, and every correction wait for a person or the research check. Nothing is paid for, and engagement never counts.
 * The screening here is rule-based and conservative (when in doubt it holds). An AI classifier can be added at one place: options.classify.
 */
const crypto = require('crypto');
const { senderCheck } = require('./reviews');

const ROLE_KINDS = { developer: ['reply', 'supply', 'error'], named: ['reply', 'error', 'privacy', 'legal'], reader: ['error', 'missing', 'grade', 'outdated', 'privacy', 'legal'] };
const KINDS = [...new Set(Object.values(ROLE_KINDS).flat())];
const PUBLISHED_KINDS = new Set(['reply', 'supply']);                      // shown beside the finding
const NEEDS_EVIDENCE = new Set(['supply', 'error', 'missing', 'grade', 'outdated']);
const HUMAN_KINDS = new Set(['privacy', 'legal']);                         // always a person (the grievance officer)
const MIN_BODY = 15, MAX_BODY = 2000, MAX_EVIDENCE = 3, MAX_NOTE = 600, PER_EMAIL_PER_DAY = 5, CONFIRM_DAYS = 7, MEMORY_MAX = 2000;
const KIND_TEXT = { reply: 'reply to a finding', supply: 'add a document or fact', error: 'report an error', missing: 'add missing information', grade: 'dispute how a finding is graded',
  outdated: 'report that something is out of date', privacy: 'ask for personal data to be removed', legal: 'send a legal notice' };

const { stripMarkup, oneLine } = require('../lib/plainText');
const sha = s => crypto.createHash('sha256').update(String(s)).digest('hex');
const rand = n => crypto.randomBytes(n).toString('hex');
const ALPHA = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
const newPublicRef = () => 'SKR-' + [...crypto.randomBytes(8)].map(b => ALPHA[b % ALPHA.length]).join('');
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const clean = s => stripMarkup(String(s == null ? '' : s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')).replace(/\n{3,}/g, '\n\n').trim();
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9\u0900-\u097f\u0600-\u06ff\u4e00-\u9fff]+/g, ' ').trim();

/** The findings of a report, from a live brief or a reference report (they are shaped differently). */
function findingsOf(brief) {
  if (!brief) return [];
  if (Array.isArray(brief.findings)) return brief.findings.map((f, i) => ({ id: String(f && f.id != null ? f.id : 'F' + (i + 1)), claim: String((f && f.claim) || '') }));
  if (Array.isArray(brief.sections)) return brief.sections.flatMap(s => (s.facts || []).map(f => ({ id: String(f.id), claim: String(f.claim || '') })));
  return [];
}
/** Which finding a reply answers: by id, else by its quoted text. null when it matches none. */
function matchFinding(brief, findingId, findingText) {
  const list = findingsOf(brief);
  if (findingId) { const f = list.find(x => x.id === String(findingId)); if (f) return f; }
  const t = norm(findingText); if (t.length < 12) return null;
  return list.find(f => { const c = norm(f.claim); return c && (c.includes(t) || t.includes(c)); }) || null;
}

/** Check and normalise what the sender sent. Never trusts the browser. */
function validate(input, refOk = () => true) {
  const errors = [], i = input || {};
  const role = String(i.role || ''), kind = String(i.kind || '');
  if (!ROLE_KINDS[role]) errors.push('Choose who you are.');
  else if (!ROLE_KINDS[role].includes(kind)) errors.push('That option is not available for your role.');
  if (!refOk(String(i.reportRef || ''))) errors.push('Use the report reference shown on the report (it starts with SK-).');
  const body = clean(i.body);
  if (body.length < MIN_BODY) errors.push(`Please write at least ${MIN_BODY} characters.`);
  if (body.length > MAX_BODY) errors.push(`Please keep your message under ${MAX_BODY} characters.`);
  const email = String(i.email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 254) errors.push('Please enter a valid e-mail address.');
  const findingText = clean(i.findingText).slice(0, 2000), findingId = i.findingId ? String(i.findingId).slice(0, 40) : '';
  if (PUBLISHED_KINDS.has(kind) && !findingId && findingText.length < 12) errors.push('Say which finding you are answering.');
  const urls = [];
  for (const raw of (Array.isArray(i.evidenceUrls) ? i.evidenceUrls : []).slice(0, MAX_EVIDENCE)) {
    const s = String(raw || '').trim(); if (!s) continue;
    try { const u = new URL(s); if (!/^https?:$/.test(u.protocol) || u.username || u.password || !u.hostname.includes('.') || s.length > 500) throw new Error('bad'); urls.push(u.toString()); }
    catch { errors.push('An evidence link is not a valid web address.'); }
  }
  if (NEEDS_EVIDENCE.has(kind) && !urls.length && !errors.length) errors.push('Add a link to the source that supports this: a change needs evidence.');
  const senderName = oneLine(i.senderName).slice(0, 120);
  return { ok: !errors.length, errors, value: { reportRef: String(i.reportRef || ''), role, kind, body, email, findingId, findingText, evidenceUrls: urls, senderName } };
}

/** Conservative, rule-based screening. Returns reasons; none means clean. Only what is PUBLISHED needs the strict checks. */
function screen({ kind, body, evidenceUrls = [] }) {
  const t = String(body || ''), why = new Set();
  if (/(?:kill|murder|bomb|burn (?:down|you)|rape|acid attack)\b|\bi will (?:destroy|ruin|find) you\b|\byou will (?:pay|regret)\b/i.test(t)) why.add('threat');
  if (/\b(fuck\w*|bastard|bitch|asshole|chutiya|madarchod|bhenchod)\b/i.test(t)) why.add('abuse');
  if (/(.)\1{9,}/.test(t)) why.add('spam');
  const letters = t.replace(/[^A-Za-z]/g, ''); if (letters.length >= 20 && letters.replace(/[^A-Z]/g, '').length / letters.length > 0.7) why.add('shouting');
  if (!PUBLISHED_KINDS.has(kind)) return [...why];
  if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(t) || /\b[A-Z]{5}\d{4}[A-Z]\b/.test(t) || /\b\d{4}\s?\d{4}\s?\d{4}\b/.test(t) || (t.match(/\d/g) || []).length >= 10 && /(?:\+?\d[\d\s().-]{8,}\d)/.test(t)) why.add('personal_data');
  if (/\b(fraud(?:ster)?|scam(?:mer)?|cheat(?:ed|er|ing)?|criminal|thief|stole|steal|bribe[sd]?|corrupt\w*|extort\w*|blackmail\w*|forg(?:ed|ery))\b/i.test(t)) why.add('accusation');
  if (/\b(in exchange|or else|we will sue|legal action|legal notice|defamation|lawyer'?s? notice)\b|\b(pay|payment|fee|money)\b.{0,40}\b(remove|delete|change|soften)\b/i.test(t)) why.add('pressure_or_legal');
  if ((t.match(/https?:\/\//gi) || []).length > 2 || evidenceUrls.length > 3) why.add('links');
  return [...why];
}

/** In-memory and Postgres storage with one interface (the same pattern as the review store). */
function makeResponseStore(pool) {
  if (pool) {
    const row = r => r.rows[0] || null;
    return {
      kind: 'postgres',
      async create(r) { return row(await pool.query(
        `INSERT INTO responses (public_ref, report_ref, kind, role, finding_id, finding_text, body, evidence_urls, sender_name, email, verification, status, screen_reasons, token_hash, status_key_hash)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'awaiting_confirmation',$12,$13,$14) RETURNING *`,
        [r.public_ref, r.report_ref, r.kind, r.role, r.finding_id || null, r.finding_text || null, r.body, r.evidence_urls || [], r.sender_name || null, r.email, r.verification, r.screen_reasons || [], r.token_hash, r.status_key_hash])); },
      async byTokenHash(h) { return row(await pool.query(`SELECT * FROM responses WHERE token_hash=$1 AND created_at > NOW() - INTERVAL '${CONFIRM_DAYS} days' LIMIT 1`, [h])); },
      async byPublicRef(ref) { return row(await pool.query(`SELECT * FROM responses WHERE public_ref=$1 LIMIT 1`, [ref])); },
      async byId(id) { return row(await pool.query(`SELECT * FROM responses WHERE id=$1 LIMIT 1`, [id])); },
      async setStatus(id, p) { return row(await pool.query(
        `UPDATE responses SET status=$2, screen_reasons=COALESCE($3, screen_reasons), confirmed_at=COALESCE($4, confirmed_at), published_at=COALESCE($5, published_at),
           resolved_at=COALESCE($6, resolved_at), resolution_note=COALESCE($7, resolution_note) WHERE id=$1 RETURNING *`,
        [id, p.status, p.screen_reasons || null, p.confirmed_at || null, p.published_at || null, p.resolved_at || null, p.resolution_note || null])); },
      async recentByEmail(email, sinceMs) { const r = await pool.query(`SELECT COUNT(*)::int AS n FROM responses WHERE email=$1 AND created_at > $2`, [email, new Date(sinceMs)]); return r.rows[0].n; },
      async published(ref) { return (await pool.query(`SELECT public_ref, kind, finding_id, finding_text, body, verification, published_at FROM responses WHERE report_ref=$1 AND status='published' AND kind IN ('reply','supply') ORDER BY published_at DESC LIMIT 200`, [ref])).rows; },
      async corrections(ref) { return (await pool.query(`SELECT public_ref, kind, finding_id, finding_text, resolution_note, resolved_at FROM responses WHERE report_ref=$1 AND status='corrected' ORDER BY resolved_at DESC LIMIT 200`, [ref])).rows; },
      async list(status) { return (await pool.query(`SELECT id, public_ref, report_ref, kind, role, finding_id, finding_text, body, evidence_urls, sender_name, email, verification, status, screen_reasons, created_at FROM responses WHERE status=$1 ORDER BY created_at ASC LIMIT 200`, [status])).rows; },
      async addWatcher(ref, email) { await pool.query(`INSERT INTO report_watchers (report_ref, email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [ref, email]); },
      async watchers(ref) { return (await pool.query(`SELECT email FROM report_watchers WHERE report_ref=$1 LIMIT 5000`, [ref])).rows.map(r => r.email); },
    };
  }
  const rows = [], watchers = new Map(); const iso = ms => new Date(ms).toISOString();
  return {
    kind: 'memory',
    async create(r) { const x = { id: crypto.randomUUID(), status: 'awaiting_confirmation', created_at: iso(Date.now()), confirmed_at: null, published_at: null, resolved_at: null, resolution_note: null, ...r }; rows.push(x); while (rows.length > MEMORY_MAX) rows.shift(); return { ...x }; },
    async byTokenHash(h) { const x = rows.find(r => r.token_hash === h && Date.now() - Date.parse(r.created_at) < CONFIRM_DAYS * 864e5); return x ? { ...x } : null; },
    async byPublicRef(ref) { const x = rows.find(r => r.public_ref === ref); return x ? { ...x } : null; },
    async byId(id) { const x = rows.find(r => r.id === id); return x ? { ...x } : null; },
    async setStatus(id, p) { const x = rows.find(r => r.id === id); if (!x) return null; x.status = p.status; for (const k of ['screen_reasons', 'confirmed_at', 'published_at', 'resolved_at', 'resolution_note']) if (p[k] != null) x[k] = p[k]; return { ...x }; },
    async recentByEmail(email, sinceMs) { return rows.filter(r => r.email === email && Date.parse(r.created_at) > sinceMs).length; },
    async published(ref) { return rows.filter(r => r.report_ref === ref && r.status === 'published' && PUBLISHED_KINDS.has(r.kind)).sort((a, b) => b.published_at.localeCompare(a.published_at)).map(({ public_ref, kind, finding_id, finding_text, body, verification, published_at }) => ({ public_ref, kind, finding_id, finding_text, body, verification, published_at })); },
    async corrections(ref) { return rows.filter(r => r.report_ref === ref && r.status === 'corrected').sort((a, b) => b.resolved_at.localeCompare(a.resolved_at)).map(({ public_ref, kind, finding_id, finding_text, resolution_note, resolved_at }) => ({ public_ref, kind, finding_id, finding_text, resolution_note, resolved_at })); },
    async list(status) { return rows.filter(r => r.status === status).map(r => ({ ...r })); },
    async addWatcher(ref, email) { if (!watchers.has(ref)) watchers.set(ref, new Set()); watchers.get(ref).add(email); },
    async watchers(ref) { return [...(watchers.get(ref) || [])]; },
  };
}

/** The behaviour, with every outside thing passed in so it can be tested: storage, the report lookup, e-mail, the operator alert, the clock. */
function makeResponses({ store, getBrief, sendMail, alert = async () => {}, siteBase = () => '', refOk = () => true, now = () => Date.now(), classify = null }) {
  const base = () => String(siteBase() || '').replace(/\/+$/, '');
  const mail = async (to, subject, text) => { try { return Boolean(await sendMail({ to, subject, text })); } catch { return false; } };
  const statusLink = (ref, key) => `${base()}/?sk_respond_status=${encodeURIComponent(ref)}&k=${encodeURIComponent(key)}`;

  async function submit(input) {
    if (input && input.website) return { ok: true, status: 200, publicRef: newPublicRef(), silent: true };       // the honeypot: a person never fills it in
    const v = validate(input, refOk); if (!v.ok) return { ok: false, status: 400, error: v.errors[0], errors: v.errors };
    const x = v.value, brief = await getBrief(x.reportRef);
    if (!brief) return { ok: false, status: 404, error: 'No report with that reference is available. Please check the reference on the report.' };
    if (await store.recentByEmail(x.email, now() - 864e5) >= PER_EMAIL_PER_DAY) return { ok: false, status: 429, error: 'Too many submissions from this address today. Please try again tomorrow.' };
    const matched = matchFinding(brief, x.findingId, x.findingText);
    const reasons = PUBLISHED_KINDS.has(x.kind) && !matched ? ['finding_not_found'] : [];
    const verification = x.role !== 'reader' && senderCheck(x.email, brief) === 'match' ? 'domain_match' : 'unverified';
    const confirm = rand(24), key = rand(16), publicRef = newPublicRef();
    const rec = await store.create({ public_ref: publicRef, report_ref: x.reportRef, kind: x.kind, role: x.role, finding_id: matched ? matched.id : x.findingId, finding_text: matched ? matched.claim : x.findingText,
      body: x.body, evidence_urls: x.evidenceUrls, sender_name: x.senderName, email: x.email, verification, screen_reasons: reasons, token_hash: sha(confirm), status_key_hash: sha(key) });
    const sent = await mail(x.email, `Confirm your response to a ShelterKart report (${publicRef})`,
      `You asked to ${KIND_TEXT[x.kind]} on report ${x.reportRef}.\n\nConfirm it with this link (valid for ${CONFIRM_DAYS} days):\n${base()}/?sk_respond_confirm=${confirm}\n\nYour reference: ${publicRef}\nCheck its status at any time: ${statusLink(publicRef, key)}\n\nIf you did not send this, ignore this e-mail and nothing will happen.\n\nShelterKart`);
    if (!sent) { await store.setStatus(rec.id, { status: 'declined', resolution_note: 'The confirmation e-mail could not be sent.', resolved_at: iso(now()) }); await alert('A response could not be confirmed', `The confirmation e-mail for ${publicRef} could not be sent. Check the e-mail provider.`); return { ok: false, status: 503, error: 'We could not send the confirmation e-mail. Please try again in a few minutes.' }; }
    return { ok: true, status: 200, publicRef, statusKey: key, kind: x.kind };
  }

  async function confirm(token) {
    const row = token && /^[0-9a-f]{20,}$/i.test(String(token)) ? await store.byTokenHash(sha(token)) : null;
    if (!row) return { ok: false, status: 404, error: 'This confirmation link is not valid, or it has expired. Send your response again.' };
    if (row.status !== 'awaiting_confirmation') return { ok: true, status: 200, publicRef: row.public_ref, state: row.status, already: true };
    let reasons = [...new Set([...(row.screen_reasons || []), ...screen({ kind: row.kind, body: row.body, evidenceUrls: row.evidence_urls || [] })])];
    if (classify) { try { const c = await classify({ kind: row.kind, body: row.body }); if (c && c.flag) reasons = [...new Set([...reasons, ...(c.reasons && c.reasons.length ? c.reasons : ['classifier'])])]; } catch { reasons.push('classifier_unavailable'); } }
    if (HUMAN_KINDS.has(row.kind)) reasons.push('needs_a_person');
    const at = iso(now()); let state;
    if (reasons.length) state = 'held'; else if (PUBLISHED_KINDS.has(row.kind)) state = 'published'; else state = 'in_review';
    await store.setStatus(row.id, { status: state, screen_reasons: reasons, confirmed_at: at, published_at: state === 'published' ? at : null });
    if (state === 'held') await alert('A response needs a person', `${row.public_ref} (${row.kind}, report ${row.report_ref}) is held: ${reasons.join(', ')}.`);
    if (state === 'published') await mail(row.email, `Your response is published (${row.public_ref})`, `Your reply on report ${row.report_ref} is now published beside the finding it answers. It does not change the finding.\n\nShelterKart`);
    return { ok: true, status: 200, publicRef: row.public_ref, state };
  }

  async function statusOf(publicRef, key) {
    const row = /^SKR-[A-Z0-9]{8}$/.test(String(publicRef || '')) ? await store.byPublicRef(publicRef) : null;
    const a = Buffer.from(sha(key || '')), b = Buffer.from(row ? row.status_key_hash : sha('x'));
    if (!row || !crypto.timingSafeEqual(a, b)) return { ok: false, status: 404, error: 'No response found for that reference and key.' };
    const done = ['corrected', 'not_changed', 'needs_info', 'declined'].includes(row.status);
    return { ok: true, status: 200, publicRef: row.public_ref, kind: row.kind, state: row.status, createdAt: row.created_at, resolution: done || row.status === 'published' ? (row.resolution_note || null) : null };
  }

  async function publicFor(reportRef) {
    const [replies, corrections] = await Promise.all([store.published(reportRef), store.corrections(reportRef)]);
    return { replies: replies.map(r => ({ publicRef: r.public_ref, kind: r.kind, findingId: r.finding_id || null, findingText: r.finding_text || '', body: r.body, verified: r.verification === 'domain_match', publishedAt: r.published_at })),
      corrections: corrections.map(c => ({ publicRef: c.public_ref, findingId: c.finding_id || null, findingText: c.finding_text || '', note: c.resolution_note || '', correctedAt: c.resolved_at })),
      counts: { replies: replies.length, corrections: corrections.length } };
  }

  async function resolve(id, { outcome, note } = {}) {
    const row = await store.byId(id); if (!row) return { ok: false, status: 404, error: 'No such response.' };
    if (!['held', 'in_review', 'needs_info'].includes(row.status)) return { ok: false, status: 409, error: `A response that is ${row.status} cannot be resolved.` };
    const n = clean(note).slice(0, MAX_NOTE), at = iso(now());
    if (!['published', 'declined', 'corrected', 'not_changed', 'needs_info'].includes(outcome)) return { ok: false, status: 400, error: 'Unknown outcome.' };
    if (outcome === 'published' && !PUBLISHED_KINDS.has(row.kind)) return { ok: false, status: 400, error: 'Only a reply or a supplied fact is published.' };
    if (outcome === 'corrected' && (PUBLISHED_KINDS.has(row.kind) || HUMAN_KINDS.has(row.kind) || n.length < 15)) return { ok: false, status: 400, error: 'A correction needs a plain-language note of what changed (at least 15 characters).' };
    if (outcome !== 'published' && outcome !== 'corrected' && !n) return { ok: false, status: 400, error: 'Say why, so the sender can be told.' };
    await store.setStatus(row.id, { status: outcome, resolved_at: at, published_at: outcome === 'published' ? at : null, resolution_note: n || null });
    let notified = 0;
    if (outcome === 'corrected') {
      for (const to of await store.watchers(row.report_ref)) { if (await mail(to, `A finding in your ShelterKart report was corrected (${row.report_ref})`, `A finding in report ${row.report_ref} was corrected on ${at.slice(0, 10)}.\n\nWhat changed: ${n}\n\nThe original wording stays visible beside the correction in the report. Open your report from the link we sent you, or restore your purchase at ${base()}.\n\nShelterKart`)) notified++; }
    }
    const word = { published: 'published', declined: 'declined', corrected: 'corrected', not_changed: 'checked and left unchanged', needs_info: 'in need of more information' }[outcome];
    await mail(row.email, `Your response ${row.public_ref}: ${word}`, `Your response ${row.public_ref} on report ${row.report_ref} was ${word}.${n ? '\n\n' + n : ''}\n\nShelterKart`);
    return { ok: true, status: 200, publicRef: row.public_ref, outcome, notified };
  }

  return { submit, confirm, statusOf, publicFor, resolve, list: status => store.list(status), watch: async (ref, email) => { const e = String(email || '').trim().toLowerCase(); if (EMAIL_RE.test(e)) await store.addWatcher(ref, e); } };
}
const iso = ms => new Date(ms).toISOString();

module.exports = { makeResponses, makeResponseStore, validate, screen, matchFinding, findingsOf, ROLE_KINDS, KINDS, PUBLISHED_KINDS, NEEDS_EVIDENCE, HUMAN_KINDS, sha, newPublicRef };
