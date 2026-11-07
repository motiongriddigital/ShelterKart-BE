'use strict';
const { getByRefAsync } = require('../engine/research');
const { senderCheck } = require('../engine/reviews');
const { REF_RE } = require('../engine/access');
const { ah } = require('../middleware/asyncHandler');
const { adminAuth } = require('../middleware/adminAuth');

module.exports = function register(app, c) {
  const { RESPONSES, REVIEWS, disputeLimiter, replyLimiter, respondLimiter, respondReadLimiter, track } = c;
  app.post('/api/responses', respondLimiter, ah(async (req, res) => {
    const b = req.body || {};
    const r = await RESPONSES.submit({ reportRef: b.reportRef, kind: b.kind, role: b.role, findingId: b.findingId, findingText: b.findingText, body: b.body,
      evidenceUrls: b.evidenceUrls, senderName: b.senderName, email: b.email, website: b.website });
    if (r.ok && !r.silent) track('respond_submit', req, { detail: r.kind });
    res.status(r.status).json(r.ok ? { ok: true, publicRef: r.publicRef, statusKey: r.statusKey || null } : { ok: false, error: r.error });
  }));
  app.post('/api/responses/confirm', respondLimiter, ah(async (req, res) => {
    const r = await RESPONSES.confirm(String((req.body || {}).token || ''));
    res.status(r.status).json(r.ok ? { ok: true, publicRef: r.publicRef, state: r.state } : { ok: false, error: r.error });
  }));
  app.get('/api/responses/status/:publicRef', respondReadLimiter, ah(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const r = await RESPONSES.statusOf(req.params.publicRef, String(req.query.key || ''));
    res.status(r.status).json(r.ok ? { ok: true, publicRef: r.publicRef, kind: r.kind, state: r.state, createdAt: r.createdAt, resolution: r.resolution } : { ok: false, error: r.error });
  }));
  // Public: the published replies and the dated corrections of one report. Never an e-mail address.
  app.get('/api/responses/:reportRef', respondReadLimiter, ah(async (req, res) => {
    if (!REF_RE.test(String(req.params.reportRef || ''))) return res.status(400).json({ ok: false, error: 'Unknown report reference.' });
    res.set('Cache-Control', 'no-store');
    res.json({ ok: true, ...(await RESPONSES.publicFor(req.params.reportRef)) });
  }));
  app.get('/api/admin/response-queue', adminAuth, ah(async (req, res) => {
    const status = String(req.query.status || 'held');
    if (!['held', 'in_review', 'needs_info'].includes(status)) return res.status(400).json({ ok: false, error: 'status must be held, in_review or needs_info' });
    res.set('Cache-Control', 'no-store'); res.json({ ok: true, status, responses: await RESPONSES.list(status) });
  }));
  app.post('/api/admin/response-queue/:id/resolve', adminAuth, ah(async (req, res) => {
    const r = await RESPONSES.resolve(req.params.id, req.body || {});
    res.status(r.status).json(r.ok ? { ok: true, publicRef: r.publicRef, outcome: r.outcome, notified: r.notified } : { ok: false, error: r.error });
  }));
  app.post('/api/dispute', disputeLimiter, ah(async (req, res) => {
    const { contact, note, reportRef } = req.body || {};
    if (!note || typeof note !== 'string') return res.status(400).json({ ok: false, error: 'Please describe what is wrong.' });
    if (note.length > 4000) return res.status(400).json({ ok: false, error: 'Please keep the description under 4,000 characters.' });
    try { await REVIEWS.addDispute({ contact: contact ? String(contact).slice(0, 200) : null, note, reportRef: REF_RE.test(String(reportRef || '')) ? reportRef : null }); res.json({ ok: true }); }
    catch (e) { console.error('[dispute] could not be saved:', e && e.message); res.status(500).json({ ok: false, error: 'Your report of an inaccuracy could not be saved. Please try again, or write to us.' }); }
  }));
  app.post('/api/developer-response', replyLimiter, ah(async (req, res) => {
    const { reportRef, findingText, responseText, contactEmail } = req.body || {};
    if ([reportRef, findingText, responseText, contactEmail].some(v => typeof v !== 'string') || !reportRef || !findingText || !responseText || !contactEmail) {
      return res.status(400).json({ ok: false, error: 'reportRef, findingText, responseText, and contactEmail are required.' });
    }
    if (String(responseText).length > 2000) return res.status(400).json({ ok: false, error: 'Response cannot exceed 2000 characters.' });
    if (String(findingText).length > 2000) return res.status(400).json({ ok: false, error: 'Please quote only the finding you are replying to.' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) return res.status(400).json({ ok: false, error: 'Please enter a valid email address.' });
    if (!REF_RE.test(String(reportRef))) return res.status(400).json({ ok: false, error: 'Please use the report reference shown on the report (it starts with SK-).' });
    // A reply must answer a report that exists. Who sent it, and which finding it answers, are checked for the reviewer below.
    const brief = await getByRefAsync(reportRef).catch(() => null);
    if (!brief) return res.status(404).json({ ok: false, error: 'No report with that reference is available. Please check the reference on the report.' });
    try {
      await REVIEWS.addReply({ reportRef, findingText: String(findingText), responseText: String(responseText), contactEmail: String(contactEmail).toLowerCase() });
      res.json({ ok: true, message: 'Submitted for review. Approved responses are published within 48 hours.' });
    } catch (e) {
      console.error('[developer-response] could not be saved:', e && e.message);
      res.status(500).json({ ok: false, error: 'Your response could not be saved. Please try again in a moment.' });
    }
  }));

  // Public: only replies a person has approved, never the sender's address. Says whether it came from the developer's own domain.
  app.get('/api/developer-response/:reportRef', ah(async (req, res) => {
    const ref = String(req.params.reportRef || '');
    if (!REF_RE.test(ref)) return res.status(400).json({ ok: false, error: 'Unknown report reference.' });
    try {
      const brief = await getByRefAsync(ref).catch(() => null);
      const rows = await REVIEWS.approvedReplies(ref);
      res.json({ responses: rows.map(r => ({ finding_text: r.finding_text, response_text: r.response_text, submitted_at: r.submitted_at, from_developer_domain: senderCheck(r.contact_email, brief) === 'match' })) });
    } catch (e) {
      console.error('[developer-response] could not be read:', e && e.message);
      res.status(500).json({ ok: false, error: 'Replies could not be loaded right now.' });
    }
  }));
};
