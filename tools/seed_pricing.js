#!/usr/bin/env node
'use strict';
/**
 * Load the reviewed release files (backend/data/*.json) into the pricing_v2 reference tables, so every price book,
 * tax profile and country that ever applied stays auditable in the database. Safe to re-run: it upserts.
 *
 *   DATABASE_URL=postgres://... node tools/seed_pricing.js
 *
 * The server reads the same files; this is the audit copy, not a second source of truth.
 */
const path = require('path'), fs = require('fs');
const D = path.join(__dirname, '..', 'backend', 'data');
const read = f => JSON.parse(fs.readFileSync(path.join(D, f), 'utf8'));

/** @param db  anything with query(sql, params). Returns how many rows it wrote per table. */
async function seed(db) {
  const n = {}; const q = async (t, sql, p) => { await db.query(sql, p); n[t] = (n[t] || 0) + 1; };
  for (const c of read('countries.json')) await q('countries', `INSERT INTO countries (iso, name, currency, tax_profile, selectable, blocked) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (iso) DO UPDATE SET name=EXCLUDED.name, currency=EXCLUDED.currency, tax_profile=EXCLUDED.tax_profile, selectable=EXCLUDED.selectable, blocked=EXCLUDED.blocked`, [c.iso, c.name, c.currency, c.tax || null, c.selectable !== false, Boolean(c.blocked)]);
  for (const [code, c] of Object.entries(read('currencies.json'))) await q('currencies', `INSERT INTO currencies (code, minor_unit, fine) VALUES ($1,$2,$3) ON CONFLICT (code) DO UPDATE SET minor_unit=EXCLUDED.minor_unit, fine=EXCLUDED.fine`, [code, c.minor, Boolean(c.fine)]);
  for (const [id, t] of Object.entries(read('tax-profiles.json'))) await q('tax_profiles', `INSERT INTO tax_profiles (id, mode, name, rate_bps, inclusive, registration_env, thresholds, threshold_mode, verified, source) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (id) DO UPDATE SET mode=EXCLUDED.mode, name=EXCLUDED.name, rate_bps=EXCLUDED.rate_bps, inclusive=EXCLUDED.inclusive, registration_env=EXCLUDED.registration_env, thresholds=EXCLUDED.thresholds, threshold_mode=EXCLUDED.threshold_mode, verified=EXCLUDED.verified, source=EXCLUDED.source`, [id, t.mode, t.name, t.rateBps || 0, t.inclusive !== false, t.registrationEnv || null, t.thresholds ? JSON.stringify(t.thresholds) : null, t.thresholdMode || null, Boolean(t.verified), t.source || t.note || null]);
  for (const r of read('payment-routes.json')) await q('payment_routes', `INSERT INTO payment_routes (id, provider, countries, currencies, enabled, note) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO UPDATE SET provider=EXCLUDED.provider, countries=EXCLUDED.countries, currencies=EXCLUDED.currencies, enabled=EXCLUDED.enabled, note=EXCLUDED.note`, [r.id, r.provider, r.countries, r.currencies, Boolean(r.enabled), r.note || null]);
  const book = read('price-book.json');
  await q('fx_snapshots', `INSERT INTO fx_snapshots (as_of, source, per_usd) VALUES ($1,$2,$3)`, [book.fx.asOf, book.fx.source, JSON.stringify(book.fx.perUsd)]);
  await q('price_books', `INSERT INTO price_books (version, status, fx_as_of, params, guardrails) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (version) DO UPDATE SET status=EXCLUDED.status, guardrails=EXCLUDED.guardrails`, [book.version, book.status, book.fx.asOf, JSON.stringify(book.params), JSON.stringify(book.guardrails || null)]);
  for (const [cur, ladder] of Object.entries(book.ladders)) for (let i = 0; i < ladder.length; i++)
    await q('price_ladders', `INSERT INTO price_ladders (book_version, currency, rung, usd_target, amount) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (book_version, currency, rung) DO UPDATE SET amount=EXCLUDED.amount`, [book.version, cur, i + 1, book.rungsUsd[i], ladder[i]]);
  return n;
}
module.exports = { seed };
if (require.main === module) {
  const { Pool } = require(path.join(__dirname, '..', 'backend', 'node_modules', 'pg'));
  const pool = new Pool(require('../backend/lib/dbConfig').directOptions(process.env));
  seed(pool).then(n => { console.log('seeded:', JSON.stringify(n)); return pool.end(); }).catch(e => { console.error(e); process.exit(1); });
}
