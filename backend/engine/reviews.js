'use strict';
/**
 * Disputes and developer replies (blind-spot review #4). Postgres when DATABASE_URL is set, memory otherwise, so the
 * right of reply works in every mode. Errors are logged here and never returned to the public.
 */
const crypto = require('crypto');
const MEMORY_MAX = 1000;

function makeReviewStore(pool) {
  if (pool) return {
    kind: 'postgres',
    addDispute: ({ contact, note, reportRef }) => pool.query(`INSERT INTO disputes (contact, note, report_ref, status, submitted_at) VALUES ($1,$2,$3,'open',NOW())`, [contact || null, note, reportRef || null]),
    openDisputes: async () => (await pool.query(`SELECT * FROM disputes WHERE status = 'open' ORDER BY submitted_at DESC`)).rows,
    resolveDispute: id => pool.query(`UPDATE disputes SET status='resolved', resolved_at=NOW() WHERE id=$1`, [id]),
    addReply: ({ reportRef, findingText, responseText, contactEmail }) => pool.query(
      `INSERT INTO developer_responses (report_ref, finding_text, response_text, contact_email, status, submitted_at) VALUES ($1,$2,$3,$4,'pending',NOW())`,
      [reportRef, findingText, responseText, contactEmail]),
    pendingReplies: async () => (await pool.query(`SELECT * FROM developer_responses WHERE status = 'pending' ORDER BY submitted_at DESC`)).rows,
    setReply: (id, status) => pool.query(`UPDATE developer_responses SET status=$2, reviewed_at=NOW() WHERE id=$1`, [id, status]),
    approvedReplies: async ref => (await pool.query(
      `SELECT finding_text, response_text, contact_email, submitted_at FROM developer_responses WHERE report_ref = $1 AND status = 'approved' ORDER BY submitted_at DESC`, [ref])).rows,
  };
  const disputes = [], replies = [];
  const keep = arr => { while (arr.length > MEMORY_MAX) arr.shift(); };
  const now = () => new Date().toISOString();
  return {
    kind: 'memory',
    async addDispute({ contact, note, reportRef }) { disputes.push({ id: crypto.randomUUID(), contact: contact || null, note, report_ref: reportRef || null, status: 'open', submitted_at: now() }); keep(disputes); },
    async openDisputes() { return disputes.filter(d => d.status === 'open').slice().reverse(); },
    async resolveDispute(id) { const d = disputes.find(x => x.id === id); if (d) { d.status = 'resolved'; d.resolved_at = now(); } },
    async addReply({ reportRef, findingText, responseText, contactEmail }) { replies.push({ id: crypto.randomUUID(), report_ref: reportRef, finding_text: findingText, response_text: responseText, contact_email: contactEmail, status: 'pending', submitted_at: now() }); keep(replies); },
    async pendingReplies() { return replies.filter(r => r.status === 'pending').slice().reverse(); },
    async setReply(id, status) { const r = replies.find(x => x.id === id); if (r) { r.status = status; r.reviewed_at = now(); } },
    async approvedReplies(ref) { return replies.filter(r => r.report_ref === ref && r.status === 'approved').slice().reverse().map(({ finding_text, response_text, contact_email, submitted_at }) => ({ finding_text, response_text, contact_email, submitted_at })); },
  };
}

/**
 * Does the reply come from the developer's own domain? A label for the reviewer and the reader, not proof:
 * the reviewer still decides. Public-suffix-like domains ("co.in", "com.sg") never count as a match.
 */
function senderCheck(email, brief) {
  const site = brief && brief.project && brief.project.developer_site;
  if (!site) return 'unknown';
  let host = ''; try { host = new URL(/^https?:\/\//i.test(site) ? site : 'https://' + site).hostname.toLowerCase().replace(/^www\./, ''); } catch { return 'unknown'; }
  const d = String(email || '').split('@')[1] ? String(email).split('@')[1].toLowerCase() : '';
  if (!d || !host) return 'unknown';
  const suffixOnly = x => x.split('.').length < 2 || /^(co|com|org|net|gov|ac|edu)\.[a-z]{2}$/.test(x);
  if (d === host || d.endsWith('.' + host)) return 'match';
  if (host.endsWith('.' + d) && !suffixOnly(d)) return 'match';
  return 'no_match';
}

/** Which finding the reply answers: its index, or -1 when the text matches none of them. */
function findingMatch(text, brief) {
  const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9\u0900-\u097f\u0600-\u06ff\u4e00-\u9fff]+/g, ' ').trim();
  const t = norm(text); if (t.length < 12) return -1;
  return ((brief && brief.findings) || []).findIndex(f => { const c = norm(f && f.claim); return c && (c.includes(t) || t.includes(c)); });
}

module.exports = { makeReviewStore, senderCheck, findingMatch };
