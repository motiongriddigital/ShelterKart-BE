'use strict';
/**
 * ShelterKart - running investigations, saved in Postgres (JOB_STORE=postgres). The same record the file store keeps, one row per report reference,
 * plus a lease: a job that is working belongs to the instance that runs it until its lease runs out, and the instance renews the lease while it works.
 * So a second instance (a rolling deploy, or a scale-out) neither fails nor re-runs a job another instance still holds, and a job whose instance died
 * is taken over once its lease has run out. Writes are queued and coalesced (the newest record of a reference wins), so the caller never waits.
 */
const crypto = require('crypto');

const ACTIVE = `(status IN ('sweeping','completing') OR (paid AND status NOT IN ('done','failed')))`;
const isActive = rec => rec.status === 'sweeping' || rec.status === 'completing' || (Boolean(rec.paid) && rec.status !== 'done' && rec.status !== 'failed');

function createPgJobStore({ pool, instanceId = crypto.randomUUID(), leaseMs = 60000, log = console } = {}) {
  const lease = Math.max(1, leaseMs / 1000);
  const pending = new Map();
  let running = null;

  async function write(rec) {
    const holds = isActive(rec);
    const r = await pool.query(
      `INSERT INTO live_jobs (ref, status, paid, payload, owner, lease_until, created_at, updated_at)
       VALUES ($1, $2, $3, $4::jsonb, $5, CASE WHEN $6::boolean THEN now() + make_interval(secs => $7::float8) END, to_timestamp($8::float8 / 1000), now())
       ON CONFLICT (ref) DO UPDATE SET status = EXCLUDED.status, paid = live_jobs.paid OR EXCLUDED.paid, payload = EXCLUDED.payload,
         owner = EXCLUDED.owner, lease_until = EXCLUDED.lease_until, updated_at = now()
       WHERE live_jobs.owner IS NULL OR live_jobs.owner = $9 OR live_jobs.lease_until < now()`,
      [rec.ref, String(rec.status || ''), Boolean(rec.paid), JSON.stringify(rec), holds ? instanceId : null, holds, lease, Number(rec.createdAt) || Date.now(), instanceId]);
    if (!r.rowCount) log.error('[jobs] ' + rec.ref + ' is held by another instance; this save was not written');
  }
  function kick() {
    if (running) return;
    running = (async () => {
      try {
        while (pending.size) {
          const [ref, rec] = pending.entries().next().value; pending.delete(ref);
          try { await write(rec); } catch (e) { log.error('[jobs] could not save ' + ref + ':', e && e.message); }
        }
      } finally { running = null; }
    })();
  }
  async function flush() { while (running) await running; if (pending.size) { kick(); await flush(); } }

  return {
    kind: 'postgres',
    instanceId,
    leaseMs,
    save(rec) { if (!rec || !rec.ref) return; pending.set(rec.ref, rec); kick(); },
    flush,
    async remove(ref) {
      pending.delete(ref);
      await pool.query(`DELETE FROM live_jobs WHERE ref = $1 AND (owner IS NULL OR owner = $2 OR lease_until < now())`, [ref, instanceId]);
    },
    /** At start: the jobs this instance may work on (claimed, with a fresh lease), the saved ones nobody is working on, and how many another instance still holds. */
    async loadAll() {
      const claimed = await pool.query(
        `UPDATE live_jobs SET owner = $1, lease_until = now() + make_interval(secs => $2::float8)
          WHERE ${ACTIVE} AND (owner IS NULL OR owner = $1 OR lease_until < now()) RETURNING payload || jsonb_build_object('paid', paid) AS payload`, [instanceId, lease]);
      const idle = await pool.query(`SELECT payload || jsonb_build_object('paid', paid) AS payload FROM live_jobs WHERE NOT ${ACTIVE}`);
      const elsewhere = await pool.query(`SELECT COUNT(*)::int AS n FROM live_jobs WHERE ${ACTIVE} AND owner <> $1 AND lease_until >= now()`, [instanceId]);
      return { mine: claimed.rows.map(r => r.payload), idle: idle.rows.map(r => r.payload), elsewhere: Number(elsewhere.rows[0].n) };
    },
    /** Working jobs whose instance is gone (nobody holds them, or the lease ran out), claimed for this instance. Run on a timer, so a crash is noticed without a restart. */
    async claimExpired() {
      const r = await pool.query(
        `UPDATE live_jobs SET owner = $1, lease_until = now() + make_interval(secs => $2::float8)
          WHERE ${ACTIVE} AND owner IS DISTINCT FROM $1 AND (owner IS NULL OR lease_until < now()) RETURNING payload || jsonb_build_object('paid', paid) AS payload`, [instanceId, lease]);
      return r.rows.map(x => x.payload);
    },
    /** Take one job whose lease has run out (or that nobody holds), as a payment for it has arrived on this instance. Null when another instance holds it or there is none. */
    async claim(ref) {
      const r = await pool.query(
        `UPDATE live_jobs SET owner = $2, lease_until = now() + make_interval(secs => $3::float8)
          WHERE ref = $1 AND (owner IS NULL OR owner = $2 OR lease_until < now()) RETURNING payload || jsonb_build_object('paid', paid) AS payload`, [ref, instanceId, lease]);
      return r.rows[0] ? r.rows[0].payload : null;
    },
    /** What is known of a job without holding it. */
    async peek(ref) {
      const r = await pool.query(`SELECT status, paid, owner, (owner IS NOT NULL AND lease_until >= now()) AS held, payload FROM live_jobs WHERE ref = $1`, [ref]);
      const x = r.rows[0]; if (!x) return null;
      return { status: x.status, paid: x.paid, owner: x.owner, held: Boolean(x.held), heldByMe: x.owner === instanceId, payload: x.payload };
    },
    /** Renew the lease of the jobs this instance is working on; returns the references that are no longer its own. */
    async heartbeat(refs) {
      if (!refs.length) return [];
      const r = await pool.query(`UPDATE live_jobs SET lease_until = now() + make_interval(secs => $2::float8) WHERE owner = $1 AND ref = ANY($3::text[]) RETURNING ref`, [instanceId, lease, refs]);
      const kept = new Set(r.rows.map(x => x.ref));
      return refs.filter(ref => !kept.has(ref));
    },
    /** A payment that arrived on another instance for a job this one holds: write down that it is paid, with who paid, for the holder to pick up. */
    async markPaid(ref, { purchaseId, email }) {
      const r = await pool.query(
        `UPDATE live_jobs SET paid = TRUE, updated_at = now(), pay_remote = jsonb_build_object('purchaseId', $2::text, 'email', $3::text)
          WHERE ref = $1 RETURNING ref`, [ref, purchaseId || null, email || null]);
      return Boolean(r.rows[0]);
    },
    /** Jobs this instance holds that another instance has been told are paid. */
    async remotePaid() {
      const r = await pool.query(`SELECT ref, pay_remote FROM live_jobs WHERE owner = $1 AND pay_remote IS NOT NULL`, [instanceId]);
      return r.rows.map(x => ({ ref: x.ref, purchaseId: x.pay_remote.purchaseId || null, email: x.pay_remote.email || null }));
    },
    /** The holder has acted on a remote payment note. */
    async ackPaid(ref) { await pool.query(`UPDATE live_jobs SET pay_remote = NULL WHERE ref = $1 AND owner = $2`, [ref, instanceId]); },
  };
}

module.exports = { createPgJobStore, isActive };
