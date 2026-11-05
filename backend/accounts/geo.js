'use strict';
/** Users by country: the country the edge network reports (never the IP address), and the per-market table for the admin map. */
const { MARKETS } = require('../engine/markets');

const NOT_A_COUNTRY = new Set(['XX', 'T1', 'ZZ']);
const MARKET_OF = (() => { const m = { UK: 'uk' }; for (const k of Object.keys(MARKETS)) m[k === 'uk' ? 'GB' : k.toUpperCase()] = k; return m; })();

/** Two letters, upper case, or null. The edge's own "unknown" and "Tor" codes are not countries. */
function cleanCountry(v) {
  const c = String(v == null ? '' : v).trim().toUpperCase();
  return /^[A-Z]{2}$/.test(c) && !NOT_A_COUNTRY.has(c) ? c : null;
}

function countryFromRequest(req, header) {
  const raw = req && typeof req.get === 'function' ? req.get(header) : req && req.headers ? req.headers[header] : null;
  return cleanCountry(Array.isArray(raw) ? raw[0] : raw);
}

const marketOf = iso => MARKET_OF[String(iso || '').toUpperCase()] || null;
const ratio = (paid, users) => (users > 0 ? Math.round(paid / users * 10000) / 10000 : 0);

/** rows: [{ country, users, newUsers }], paidRows: [{ country, paid }]. One entry per market, then users in other countries, then users with no country. */
function buildGeo(rows, paidRows) {
  const slot = () => ({ users: 0, newThisWeek: 0, paid: 0 });
  const by = {}, other = slot(), unknown = slot();
  for (const k of Object.keys(MARKETS)) by[k] = slot();
  const target = c => (c == null || c === '' ? unknown : by[marketOf(c)] || other);
  for (const r of rows || []) { const t = target(r.country); t.users += Number(r.users) || 0; t.newThisWeek += Number(r.newUsers) || 0; }
  for (const r of paidRows || []) target(r.country).paid += Number(r.paid) || 0;
  const markets = Object.keys(MARKETS).map(k => ({ code: k, name: MARKETS[k].label, iso: k === 'uk' ? 'GB' : k.toUpperCase(), ...by[k], conversion: ratio(by[k].paid, by[k].users) }));
  const totals = [...markets, other, unknown].reduce((s, m) => ({ users: s.users + m.users, newThisWeek: s.newThisWeek + m.newThisWeek, paid: s.paid + m.paid }), slot());
  return { markets, other: { ...other, conversion: ratio(other.paid, other.users) }, unknown: { ...unknown, conversion: ratio(unknown.paid, unknown.users) }, totals: { ...totals, conversion: ratio(totals.paid, totals.users) } };
}

module.exports = { cleanCountry, countryFromRequest, marketOf, buildGeo };
