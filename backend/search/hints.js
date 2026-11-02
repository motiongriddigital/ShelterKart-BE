'use strict';
/**
 * ShelterKart search: the words in a query that are hints, not names.
 *
 * "2bhk sea view flat in worli by vasant possession 2027 under 3 crore" names no project, but it says a lot: a configuration,
 * a view, a locality, a developer, a year, a budget. hints() lifts those out so the name words left over are matched as a
 * name, and the hints only BOOST a candidate that fits them. A hint never removes a candidate: one wrong word must never hide
 * the right project.
 */
const { tokens } = require('./normalize');

const STOP = new Set(['the', 'a', 'an', 'of', 'in', 'at', 'by', 'for', 'and', 'or', 'to', 'from', 'with', 'near', 'opposite', 'behind', 'next', 'on', 'is', 'my', 'me',
  'project', 'projects', 'property', 'properties', 'flat', 'flats', 'apartment', 'apartments', 'home', 'homes', 'house', 'new', 'best', 'good', 'top', 'buy', 'buying',
  'sale', 'price', 'prices', 'review', 'reviews', 'details', 'info', 'about', 'check', 'rera', 'registered', 'registration', 'number', 'no', 'id', 'please', 'want',
  'looking', 'search', 'find', 'show', 'which', 'what', 'is', 'it', 'safe', 'genuine', 'ka', 'ki', 'ke', 'mein', 'me', 'wala', 'wali', 'hai', 'kya', 'builder', 'builders',
  'developer', 'developers', 'residential', 'housing', 'society', 'scheme', 'under', 'below', 'above', 'upto', 'within', 'around', 'approx', 'budget', 'cheap', 'luxury', 'affordable']);
const CONFIG = /^(\d)(bhk|rk|bed|beds|bedroom|bedrooms|br)$/;
const STATUS = [['under construction', 'under_construction'], ['uc', 'under_construction'], ['ready to move', 'ready'], ['ready', 'ready'], ['rtm', 'ready'],
  ['new launch', 'new_launch'], ['prelaunch', 'pre_launch'], ['pre launch', 'pre_launch'], ['completed', 'ready'], ['possession', null], ['handover', null], ['off plan', 'under_construction']];
const FEATURES = [['sea view', 'sea_view'], ['sea facing', 'sea_view'], ['sea', 'sea_view'], ['lake view', 'lake_view'], ['garden', 'garden'], ['pool', 'pool'],
  ['swimming pool', 'pool'], ['gym', 'gym'], ['metro', 'metro'], ['station', 'station'], ['school', 'school'], ['hospital', 'hospital'], ['mall', 'mall'], ['airport', 'airport'],
  ['highway', 'highway'], ['penthouse', 'penthouse'], ['villa', 'villa'], ['villas', 'villa'], ['studio', 'studio'], ['plot', 'plot'], ['duplex', 'duplex'], ['jodi', 'jodi']];

/** Hints and the name words left over. */
function hints(query) {
  let t = tokens(query); const h = { config: [], status: null, year: null, features: [], price: null, size: null };
  const take = (i, n) => { t.splice(i, n); };
  for (let i = 0; i < t.length; i++) {                                        // "2 bhk", "2bhk", "3 bed"
    const j = t[i] + (t[i + 1] || ''), m = CONFIG.exec(t[i]) || (/^\d$/.test(t[i]) && CONFIG.exec(j));
    if (m) { h.config.push(m[1] + (/rk/.test(m[2]) ? 'rk' : 'bhk')); take(i, CONFIG.exec(t[i]) ? 1 : 2); i--; }
  }
  const joined = () => ' ' + t.join(' ') + ' ';
  for (const [phrase, val] of STATUS) { const k = ' ' + phrase + ' '; if (joined().includes(k)) { if (val && !h.status) h.status = val; t = joined().replace(k, ' ').trim().split(/\s+/).filter(Boolean); } }
  for (let i = 0; i < t.length; i++) if (/^20[2-4]\d$/.test(t[i])) { h.year = Number(t[i]); take(i, 1); i--; }
  for (const [phrase, val] of FEATURES.sort((a, b) => b[0].length - a[0].length)) { const k = ' ' + phrase + ' '; if (joined().includes(k)) { if (!h.features.includes(val)) h.features.push(val); t = joined().replace(k, ' ').trim().split(/\s+/).filter(Boolean); } }
  for (let i = 0; i < t.length; i++) {                                        // "3 crore", "80 lakh", "1.5 cr", "1200 sqft"
    const n = parseFloat(t[i]), u = t[i + 1] || '';
    if (Number.isFinite(n) && /^(crore|crores|cr)$/.test(u)) { h.price = { inr: n * 1e7 }; take(i, 2); i--; continue; }
    if (Number.isFinite(n) && /^(lakh|lakhs|lac|lacs|l)$/.test(u)) { h.price = { inr: n * 1e5 }; take(i, 2); i--; continue; }
    if (Number.isFinite(n) && /^(sqft|sq|sqm|square)$/.test(u)) { h.size = { value: n, unit: /sqm/.test(u) ? 'sqm' : 'sqft' }; take(i, /sq/.test(u) && /^(ft|m|feet|metre|meter)$/.test(t[i + 2] || '') ? 3 : 2); i--; }
  }
  const name = t.filter(w => !STOP.has(w));
  return { hints: h, name, any: Boolean(h.config.length || h.status || h.year || h.features.length || h.price || h.size) };
}

module.exports = { hints, STOP };
