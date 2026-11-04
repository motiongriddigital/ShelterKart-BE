'use strict';
/**
 * The audit ledger for what an operator does to legal and takedown matters: resolving a dispute, approving or rejecting a developer's
 * reply, releasing a held adverse finding, purging a source. One row per action in the existing append-only table audit_log, with who,
 * what, which object, and the reason. Without a database the rows are kept in memory. Contract: docs/api/openapi.yaml, tag Admin.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-9a-f][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const clip = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n);

function createAdminAudit({ pool = null, now = () => Date.now() } = {}) {
  const mem = [];

  async function record({ actor, action, objectType = null, objectId = null, before = null, after = null, reason = null }) {
    const row = {
      actor: clip(actor || 'admin', 80), action: clip(action, 60), objectType: objectType ? clip(objectType, 40) : null,
      objectId: objectId && UUID.test(String(objectId)) ? String(objectId) : null, before: before || null, after: after || null, reason: reason ? clip(reason, 500) : null,
    };
    if (!row.action) throw new Error('an audit row needs an action');
    if (!pool) { mem.push({ id: mem.length + 1, ...row, at: new Date(now()).toISOString() }); return; }
    await pool.query(
      `INSERT INTO audit_log (actor, action, object_type, object_id, before_state, after_state, reason) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [row.actor, row.action, row.objectType, row.objectId, row.before ? JSON.stringify(row.before) : null, row.after ? JSON.stringify(row.after) : null, row.reason]);
  }

  async function list({ limit = 50, action = null, objectType = null } = {}) {
    const n = Math.min(200, Math.max(1, Number(limit) || 50));
    if (!pool) return mem.filter(r => (!action || r.action === action) && (!objectType || r.objectType === objectType)).slice(-n).reverse();
    const r = await pool.query(
      `SELECT id, actor, action, object_type, object_id, before_state, after_state, reason, occurred_at FROM audit_log
        WHERE ($1::text IS NULL OR action = $1) AND ($2::text IS NULL OR object_type = $2) ORDER BY id DESC LIMIT $3`, [action, objectType, n]);
    return r.rows.map(x => ({ id: Number(x.id), actor: x.actor, action: x.action, objectType: x.object_type, objectId: x.object_id, before: x.before_state, after: x.after_state, reason: x.reason, at: new Date(x.occurred_at).toISOString() }));
  }

  return { record, list, _mem: mem };
}

/** The operator's username from the Basic login, for the actor column. The password is never read. */
function actorOf(req) {
  try {
    const encoded = String((req.headers && req.headers.authorization) || '').split(' ')[1] || '';
    const user = Buffer.from(encoded, 'base64').toString('utf8').split(':')[0];
    return user ? 'admin:' + clip(user, 60) : 'admin';
  } catch { return 'admin'; }
}

function mountAudit(app, { adminAuth, wrap, rateLimit, audit }) {
  const A = [rateLimit({ windowMs: 15 * 60e3, max: 300, message: { ok: false, error: 'Too many requests. Please try again later.' } }), adminAuth];
  app.get('/api/admin/audit', ...A, wrap(async (req, res) => {
    const q = req.query || {};
    const limit = q.limit === undefined || q.limit === '' ? 50 : (/^\d{1,3}$/.test(String(q.limit)) ? Number(q.limit) : NaN);
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) return res.status(400).json({ ok: false, code: 'invalid', error: 'limit must be a whole number from 1 to 200.' });
    const action = q.action ? clip(q.action, 60) : null, objectType = q.objectType ? clip(q.objectType, 40) : null;
    res.set('Cache-Control', 'no-store');
    res.json({ ok: true, rows: await audit.list({ limit, action, objectType }) });
  }));
}

module.exports = { createAdminAudit, actorOf, mountAudit, UUID };
