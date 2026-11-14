'use strict';
/**
 * ShelterKart -- webhook de-duplication that survives a failure.
 *
 * A provider retries a webhook until it gets a 2xx. A redelivery of an event that was already settled must do nothing, but a
 * redelivery of one that was RECEIVED and never finished (the database blinked, the process died mid-way) must be processed
 * again. So an event is claimed, not merely recorded:
 *
 *   new event                                    claimed
 *   same event, still 'received' after a while   claimed again (the first attempt did not finish)
 *   same event, processed, ignored or failed     not claimed (a final answer was already given)
 *   same event, 'received' a moment ago          not claimed (another delivery is working on it)
 *
 * Settling a purchase is itself idempotent (only a pending purchase becomes paid), so a second attempt cannot double-book.
 */
const PROVIDERS = new Set(['razorpay', 'mor']);
const FINAL = new Set(['processed', 'ignored', 'failed']);

const retrySeconds = env => { const n = Number(env && env.PAYMENT_EVENT_RETRY_SECONDS); return Number.isFinite(n) && n >= 0 ? n : 20; };

/** @returns {Promise<{claimed:boolean, id:(string|number|null)}>} */
async function claimEvent(db, provider, eventId, payloadHash, env = process.env) {
  if (!PROVIDERS.has(provider)) throw new Error('unknown payment provider');
  const r = await db.query(
    `INSERT INTO payment_events (provider, event_id, payload_hash, signature_ok, process_status)
     VALUES ('${provider}', $1, $2, true, 'received')
     ON CONFLICT (provider, event_id) DO UPDATE SET received_at = NOW(), payload_hash = EXCLUDED.payload_hash
       WHERE payment_events.process_status = 'received' AND payment_events.received_at < NOW() - make_interval(secs => $3)
     RETURNING id`,
    [String(eventId), payloadHash, retrySeconds(env)]);
  return r.rows.length ? { claimed: true, id: r.rows[0].id } : { claimed: false, id: null };
}

/** The same claim for the older signed route, where the provider name comes from a header: it is a parameter here, never part of the SQL. */
async function claimExternalEvent(db, provider, eventId, payloadHash, env = process.env) {
  const r = await db.query(
    `INSERT INTO payment_events (provider, event_id, payload_hash, signature_ok, process_status)
     VALUES ($1, $2, $3, true, 'received')
     ON CONFLICT (provider, event_id) DO UPDATE SET received_at = NOW(), payload_hash = EXCLUDED.payload_hash
       WHERE payment_events.process_status = 'received' AND payment_events.received_at < NOW() - make_interval(secs => $4)
     RETURNING id`,
    [String(provider), String(eventId), payloadHash, retrySeconds(env)]);
  return r.rows.length ? { claimed: true, id: r.rows[0].id } : { claimed: false, id: null };
}

/** Record how the event ended. Only a final status stops a later redelivery. */
async function finishEvent(db, id, status) {
  if (!FINAL.has(status)) throw new Error('not a final status');
  await db.query(`UPDATE payment_events SET process_status=$2, processed_at=NOW() WHERE id=$1`, [id, status]);
}

module.exports = { claimEvent, claimExternalEvent, finishEvent, retrySeconds, FINAL };
