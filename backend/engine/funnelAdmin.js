'use strict';
/** Admin route for free versus premium: where visitors and new users stop on the way to a paid report. Everything outside is passed in. Contract: docs/api/openapi.yaml, tag Admin. */

const DEFINITION = 'Free: signed in and has not paid for a report. Premium: has paid for at least one report that was not refunded. There is no membership.';
const pct = (n, d) => (d ? Math.round(1000 * n / d) / 10 : null);

/** stages: [{label, count, unit?}] in order. Adds the share of the previous and of the first stage, and the number lost at each step. */
function chain(stages) {
  const out = stages.map((s, i) => {
    const prev = i ? stages[i - 1].count : null;
    return { ...s, ofPrevious: i ? pct(s.count, prev) : null, ofFirst: i ? pct(s.count, stages[0].count) : null, lost: i ? Math.max(0, prev - s.count) : null };
  });
  let worst = null;
  for (let i = 1; i < out.length; i++) {
    if (!out[i - 1].count || out[i].lost == null) continue;
    const share = out[i].lost / out[i - 1].count;
    if (!worst || share > worst.share) worst = { share, from: out[i - 1].label, to: out[i].label, lost: out[i].lost };
  }
  return { stages: out, largestDrop: worst && worst.lost ? { from: worst.from, to: worst.to, lost: worst.lost, percent: Math.round(worst.share * 1000) / 10 } : null };
}

/** analytics: the aggregate (funnel, signin_funnel). cohort and classes: rows from the source, or null without a database. */
function buildFunnel({ analytics, cohort, classes }) {
  const f = (analytics && analytics.funnel) || [], s = (analytics && analytics.signin_funnel) || [];
  const pick = (list, label) => (list.find(x => x.label === label) || { count: 0 }).count;
  const visitors = chain([
    { label: 'Visited', count: pick(f, 'Visited'), unit: 'visitor-days' },
    { label: 'Searched', count: pick(f, 'Searched'), unit: 'visitor-days' },
    { label: 'Sign-in wall shown', count: pick(s, 'Wall shown'), unit: 'events' },
    { label: 'Code requested', count: pick(s, 'Code requested'), unit: 'events' },
    { label: 'Signed in', count: pick(s, 'Signed in'), unit: 'events' },
  ]);
  const out = { definition: DEFINITION, visitors };
  if (cohort) {
    const n = x => Number(x) || 0, unit = 'new users';
    out.newUsers = {
      ...chain([
        { label: 'Signed up', count: n(cohort.users), unit }, { label: 'Opened a report', count: n(cohort.opened), unit },
        { label: 'Started checkout', count: n(cohort.checkout), unit }, { label: 'Paid', count: n(cohort.paid), unit }, { label: 'Paid again', count: n(cohort.repeat), unit },
      ]),
      abandonedCheckout: Math.max(0, n(cohort.checkout) - n(cohort.paid)),
      medianHoursToFirstPayment: cohort.median_hours == null ? null : Math.round(Number(cohort.median_hours) * 10) / 10,
    };
  }
  if (classes) {
    const n = x => Number(x) || 0, users = n(classes.users), premium = n(classes.premium);
    out.classes = {
      users, free: users - premium, premium, premiumShare: pct(premium, users),
      active30d: { free: n(classes.active) - n(classes.active_premium), premium: n(classes.active_premium) },
    };
  }
  return out;
}

/** The Postgres source: counts only, never an address or a name. */
function pgSource(pool) {
  return {
    async cohort(since) {
      const r = await pool.query(
        `WITH c AS (
           SELECT u.id, u.created_at,
                  EXISTS (SELECT 1 FROM user_reports r WHERE r.user_id = u.id) AS opened,
                  EXISTS (SELECT 1 FROM report_purchases p WHERE p.user_id = u.id) AS checkout,
                  (SELECT COUNT(*) FROM report_purchases p WHERE p.user_id = u.id AND p.status IN ('paid', 'refunded')) AS paid,
                  (SELECT MIN(COALESCE(p.paid_at, p.created_at)) FROM report_purchases p WHERE p.user_id = u.id AND p.status IN ('paid', 'refunded')) AS first_paid
             FROM users u WHERE u.created_at >= $1 AND u.deleted_at IS NULL)
         SELECT COUNT(*) AS users,
                COUNT(*) FILTER (WHERE opened OR checkout OR paid > 0) AS opened,
                COUNT(*) FILTER (WHERE checkout OR paid > 0) AS checkout,
                COUNT(*) FILTER (WHERE paid > 0) AS paid,
                COUNT(*) FILTER (WHERE paid > 1) AS repeat,
                percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM first_paid - created_at) / 3600.0) FILTER (WHERE paid > 0) AS median_hours
           FROM c`, [since]);
      return r.rows[0];
    },
    async classes(activeSince) {
      const r = await pool.query(
        `SELECT COUNT(*) AS users, COUNT(*) FILTER (WHERE premium) AS premium, COUNT(*) FILTER (WHERE last_login_at >= $1) AS active,
                COUNT(*) FILTER (WHERE premium AND last_login_at >= $1) AS active_premium
           FROM (SELECT u.last_login_at, EXISTS (SELECT 1 FROM report_purchases p WHERE p.user_id = u.id AND p.status = 'paid') AS premium
                   FROM users u WHERE u.deleted_at IS NULL) x`, [activeSince]);
      return r.rows[0];
    },
  };
}

function mountFunnelAdmin(app, { adminAuth, wrap, rateLimit, source, analytics, now = () => Date.now() }) {
  const A = [rateLimit({ windowMs: 15 * 60e3, max: 300, message: { ok: false, error: 'Too many requests. Please try again later.' } }), adminAuth];
  app.get('/api/admin/funnel/users', ...A, wrap(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const raw = (req.query || {}).days, days = raw === undefined || raw === '' ? 30 : (/^\d{1,4}$/.test(String(raw)) ? Number(raw) : NaN);
    if (!Number.isInteger(days) || days < 1 || days > 400) return res.status(400).json({ ok: false, code: 'invalid', error: 'days must be a whole number from 1 to 400.' });
    const t = now(), since = new Date(Date.UTC(new Date(t).getUTCFullYear(), new Date(t).getUTCMonth(), new Date(t).getUTCDate()) - (days - 1) * 86400000).toISOString();
    const [a, cohort, classes] = await Promise.all([analytics(days), source ? source.cohort(since) : null, source ? source.classes(new Date(t - 30 * 86400000).toISOString()) : null]);
    res.json({ ok: true, stored: Boolean(source), days, ...buildFunnel({ analytics: a, cohort, classes }) });
  }));
}

module.exports = { mountFunnelAdmin, pgSource, buildFunnel, chain, DEFINITION };
