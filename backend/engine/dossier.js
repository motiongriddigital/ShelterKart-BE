'use strict';
/**
 * ShelterKart — the dossier.
 *
 * What the investigator found, merged across every bot on the panel, reasoned over, and turned into the
 * questions a buyer should put to the developer's team. Pure functions: no network, no AI, fully testable.
 *
 * The product is the questions. A fact is never thrown away for being unverified: it is shown with where it
 * appears and a status, and if it matters it becomes a question. The report states what was found; it never
 * tells the buyer whether to buy.
 */

/* ---------------- status of a fact ---------------- */

const STATUS = {
  verified: 'Verified at an official source',
  reported: 'Reported, with link',
  claim: "Developer's own claim",
  inference: 'Our inference, with the reasoning shown',
  conflict: 'Sources disagree',
};

// Official sources: regulators, registries, courts, exchanges, governments. Anything else is reported.
const OFFICIAL = [/(^|\.)gov$/, /(^|\.)gov\.(in|uk|au|sg|ae|ie|ph|my|za|br|tw|hk|lv|cz|ee|lt|pl|sa|qa|bh|om|th|cn|lk|bd|np|pk|eg|ng|ke)$/, /(^|\.)nic\.in$/, /(^|\.)bseindia\.com$/, /(^|\.)nseindia\.com$/,
  /(^|\.)sec\.gov$/, /(^|\.)ibbi\.gov\.in$/, /(^|\.)mca\.gov\.in$/, /(^|\.)ecourts\.gov\.in$/, /(^|\.)companieshouse\.gov\.uk$/,
  /(^|\.)thegazette\.co\.uk$/, /(^|\.)legislation\.gov\.uk$/, /(^|\.)bodacc\.fr$/, /(^|\.)boe\.es$/, /(^|\.)dubailand\.gov\.ae$/,
  /(^|\.)ura\.gov\.sg$/, /(^|\.)acra\.gov\.sg$/, /(^|\.)asic\.gov\.au$/, /(^|\.)abr\.business\.gov\.au$/, /(^|\.)indiacode\.nic\.in$/,
  /(^|\.)maharera\.maharashtra\.gov\.in$/, /(^|\.)rera\.[a-z]+\.gov\.in$/, /(^|\.)sci\.gov\.in$/];

/** The URL if it is a real web address (http or https), else ''. The only thing that may ever become a link: an engine, or text on a hostile page behind it,
 *  can name "javascript:..." or "data:..." as a source, and the browser parses away tabs and line breaks inside a scheme, so the URL is parsed, not pattern-matched. */
function safeUrl(url) {
  if (typeof url !== 'string') return '';
  const t = url.trim();
  try { const u = new URL(t); return u.protocol === 'http:' || u.protocol === 'https:' ? t : ''; } catch { return ''; }
}
function host(url) { try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; } }
const isOfficial = url => { const h = host(url); return Boolean(h) && OFFICIAL.some(re => re.test(h)); };
const sameSite = (url, site) => { const h = host(url), s = String(site || '').toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, ''); return Boolean(h && s) && (h === s || h.endsWith('.' + s)); };

/** One status per fact, decided in code from its sources: official beats reported beats the developer's own word. */
function statusOf(fact, developerSite) {
  const urls = (fact.sources || []).map(s => s.url);
  if (fact.kind === 'inference') return 'inference';
  if (urls.some(isOfficial)) return 'verified';
  if (urls.length && urls.every(u => sameSite(u, developerSite))) return 'claim';
  return 'reported';
}

/* ---------------- normalising text, numbers and dates ---------------- */

const norm = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const tokens = s => new Set(norm(s).split(' ').filter(w => w.length > 2));
function jaccard(a, b) { const A = tokens(a), B = tokens(b); if (!A.size || !B.size) return 0; let n = 0; for (const t of A) if (B.has(t)) n++; return n / (A.size + B.size - n); }

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
/** A date as 'YYYY-MM' (or 'YYYY-MM-DD' when a day is given); null when the text holds no date. */
function parseDate(text) {
  const s = String(text || '').toLowerCase();
  let m = s.match(/(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3})[a-z]*\.?\s+(\d{4})/); if (m && MONTHS.includes(m[2])) return `${m[3]}-${String(MONTHS.indexOf(m[2]) + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = s.match(/([a-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/); if (m && MONTHS.includes(m[1])) return `${m[3]}-${String(MONTHS.indexOf(m[1]) + 1).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  m = s.match(/([a-z]{3})[a-z]*\.?\s+(\d{4})/); if (m && MONTHS.includes(m[1])) return `${m[2]}-${String(MONTHS.indexOf(m[1]) + 1).padStart(2, '0')}`;
  m = s.match(/(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/); if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}
const monthsBetween = (a, b) => { const [ya, ma] = a.split('-').map(Number), [yb, mb] = b.split('-').map(Number); return (yb - ya) * 12 + (mb - ma); };

/** The first number in a text, with Indian and Western grouping understood ("2,623.62", "1,46,80,249"). */
function parseNumber(text) { const m = String(text || '').replace(/,/g, '').match(/-?\d+(?:\.\d+)?/); return m ? Number(m[0]) : null; }

/** Two values of one field "agree" when they are the same date, the same number (within 1%), or near-identical text. */
function sameValue(a, b) {
  const da = parseDate(a), db = parseDate(b);
  if (da && db) return da.slice(0, 7) === db.slice(0, 7) && (da.length < 10 || db.length < 10 || da === db);
  const na = parseNumber(a), nb = parseNumber(b);
  if (na != null && nb != null && /\d/.test(norm(a)) && /\d/.test(norm(b))) return Math.abs(na - nb) <= Math.max(Math.abs(na), Math.abs(nb)) * 0.01;
  return norm(a) === norm(b) || jaccard(a, b) >= 0.8;
}

/* ---------------- merging what the panel found ---------------- */

/**
 * Merge raw facts from every bot and every round. Facts about the same field (for example "filed completion date")
 * are grouped: if their values agree they become one fact found by several bots; if not, a conflict is recorded
 * and every version is kept. Facts without a field merge when their wording is near-identical.
 * A link the bot cited but the search never returned is kept and flagged, never deleted.
 */
function mergeFacts(raw, { developerSite = '', retrieved = new Set() } = {}) {
  const facts = [], conflicts = [];
  const byField = new Map();
  for (const f of raw) {
    if (!f || !(f.claim || f.value)) continue;
    const sources = (f.sources || []).map(s => (typeof s === 'string' ? { url: s } : s)).filter(s => s && /^https?:\/\//.test(s.url || ''))
      .map(s => ({ url: s.url, title: s.title || '', seen: retrieved.has(s.url) }));
    const item = { area: f.area || 'other', field: f.field ? norm(f.field) : '', label: f.field ? String(f.field).trim() : '', value: String(f.value || '').trim(), claim: String(f.claim || f.value).trim(),
      kind: f.kind || 'fact', sources, foundBy: [...new Set([].concat(f.foundBy || []))], round: f.round || 0 };
    if (item.field) {
      const group = byField.get(item.field) || []; byField.set(item.field, group);
      const twin = group.find(g => sameValue(g.value || g.claim, item.value || item.claim));
      if (twin) { absorb(twin, item); continue; }
      group.push(item); facts.push(item); continue;
    }
    const twin = facts.find(g => !g.field && g.area === item.area && jaccard(g.claim, item.claim) >= 0.6);
    if (twin) { absorb(twin, item); continue; }
    facts.push(item);
  }
  for (const [field, group] of byField) if (group.length > 1)
    conflicts.push({ field, label: group[0].label || field, area: group[0].area, versions: group.map(g => ({ value: g.value || g.claim, sources: g.sources, foundBy: g.foundBy })) });
  facts.forEach((f, i) => { f.id = 'F' + (i + 1); f.status = statusOf(f, developerSite); f.inConflict = Boolean(f.field && conflicts.some(c => c.field === f.field)); });
  return { facts, conflicts };
}
function absorb(into, f) {
  for (const s of f.sources) if (!into.sources.some(x => x.url === s.url)) into.sources.push(s);
  into.foundBy = [...new Set([...into.foundBy, ...f.foundBy])];
  if (f.claim.length > into.claim.length) into.claim = f.claim;
}

/* ---------------- leads: what to investigate next ---------------- */

const LEAD_PATTERNS = [
  { kind: 'company-id', re: /\b[UL]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}\b/g },                       // Indian CIN
  { kind: 'registration', re: /\bP5\d{10}\b/g },                                                 // MahaRERA project number
  { kind: 'complaint', re: /\bCC\d{7,12}\b/g },                                                 // MahaRERA complaint
  { kind: 'case', re: /\b[A-Z][A-Za-z.()\s]{1,30}No\.?\s*\d{1,7}\s*(?:of|\/)\s*\d{4}\b/g },     // "M.A.S. No. 5714 of 2015"
  { kind: 'company', re: /\b[A-Z][A-Za-z&'.-]+(?:\s+[A-Z][A-Za-z&'.-]+){0,5}\s+(?:Private Limited|Pvt\.? Ltd\.?|Limited|LLP|LLC|PLC|Ltd\.?|Inc\.?)\b/g },
];
/** Leads named in a fact's text, plus any the bots listed explicitly. Deduplicated by kind and value. */
function extractLeads(facts, botLeads = [], known = new Map()) {
  const out = new Map(known);
  const add = (kind, value, why, from) => {
    let v = String(value || '').replace(/\s+/g, ' ').trim();
    if (kind === 'company') v = v.replace(/^(?:(?:The|Promoter|Developer|Builder|Company|SPV|Seller|By|Of|And|Parent|Its|Subsidiary)\s+)+/i, '');
    if (v.length < 4) return;
    const key = kind + ':' + norm(v); if (out.has(key)) return;
    out.set(key, { key, kind, value: v, why: why || '', from: from || '', state: 'open' });
  };
  for (const f of facts) for (const p of LEAD_PATTERNS) for (const m of String(f.claim + ' ' + f.value).matchAll(p.re)) add(p.kind, m[0], 'named in ' + f.id, f.id);
  for (const l of botLeads) if (l && l.value) add(l.kind || 'other', l.value, l.why, 'panel');
  return out;
}

/* ---------------- reasoning: what the facts imply ---------------- */

/** "Hemant M Shah" and "Hemant Mahipatray Shah" are one person: same first and last name, and the initials agree. */
function samePerson(a, b) {
  const pa = norm(a).split(' ').filter(Boolean), pb = norm(b).split(' ').filter(Boolean);
  if (pa.length < 2 || pb.length < 2) return false;
  if (pa[0] !== pb[0] || pa.at(-1) !== pb.at(-1)) return false;
  const ma = pa.slice(1, -1), mb = pb.slice(1, -1);
  return ma.every((x, i) => !mb[i] || x[0] === mb[i][0]) && mb.every((x, i) => !ma[i] || x[0] === ma[i][0]);
}

/**
 * Common control. Given the people and signals attached to each entity (members, directors, promoters,
 * e-mail domains, the brand it is sold under), find pairs of entities that share them and explain the link
 * step by step. Control is an inference; legal liability is a separate question, which this says.
 */
function commonControl(entities) {
  const chains = [];
  for (let i = 0; i < entities.length; i++) for (let j = i + 1; j < entities.length; j++) {
    const A = entities[i], B = entities[j], steps = [];
    for (const pa of A.people || []) for (const pb of B.people || []) if (samePerson(pa.name, pb.name))
      steps.push({ text: `${pa.name}${pa.role ? ' (' + pa.role + ')' : ''} on ${A.name} matches ${pb.name}${pb.role ? ' (' + pb.role + ')' : ''} on ${B.name}`, sources: [...(pa.sources || []), ...(pb.sources || [])] });
    const da = (A.domains || []).map(norm), db = (B.domains || []).map(norm);
    for (const d of da) if (db.includes(d)) steps.push({ text: `Both use the ${d.replace(/ /g, '.')} e-mail domain`, sources: [] });
    if (A.brand && B.brand && norm(A.brand) === norm(B.brand)) steps.push({ text: `Both are presented under the ${A.brand} brand`, sources: [] });
    if (steps.length) chains.push({ a: A.name, b: B.name, steps, strength: steps.length >= 2 ? 'strong' : 'possible',
      conclusion: `${A.name} and ${B.name} appear to be under common control (${steps.length} link${steps.length > 1 ? 's' : ''}). Control is not the same as legal liability: whether ${B.name} will stand behind ${A.name}'s obligations is a question for the developer.` });
  }
  return chains;
}

/** Does the registered carpet area fit inside the sanctioned built-up area? Units: whatever the record uses, stated. */
function areaCheck({ units = [], sanctioned, unit = 'sq m' }) {
  const carpet = units.reduce((t, u) => t + (Number(u.count) || 0) * (Number(u.carpet) || 0), 0);
  const count = units.reduce((t, u) => t + (Number(u.count) || 0), 0);
  if (!carpet || !sanctioned) return null;
  const ratio = carpet / sanctioned;
  return { count, carpet: Math.round(carpet * 100) / 100, sanctioned, unit, ratio: Math.round(ratio * 100) / 100, reconciles: ratio <= 1,
    text: ratio <= 1 ? `The ${count} registered units total ${fmt(carpet)} ${unit} of carpet area, within the sanctioned ${fmt(sanctioned)} ${unit}.`
      : `The ${count} registered units total ${fmt(carpet)} ${unit} of carpet area, ${ratio.toFixed(2)} times the sanctioned built-up area of ${fmt(sanctioned)} ${unit}. Carpet area cannot exceed built-up area, so the record does not reconcile as shown.` };
}
const fmt = n => Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });

/** Months between the filed completion date and each date the project is marketed with. */
function dateGaps(filed, marketed = []) {
  const f = parseDate(filed); if (!f) return [];
  return marketed.map(m => ({ ...m, date: parseDate(m.value) })).filter(m => m.date)
    .map(m => ({ value: m.value, sources: m.sources || [], months: monthsBetween(m.date.slice(0, 7), f.slice(0, 7)), filed }))
    .filter(g => g.months !== 0);
}

/** Delay interest per ₹1 crore paid, per month, at an annual rate (for example the State Bank of India's highest lending rate + 2%). */
function delayCost({ annualRatePct, perAmount = 1e7, months = 1 }) {
  if (!annualRatePct) return null;
  const monthly = perAmount * annualRatePct / 100 / 12;
  return { annualRatePct, perAmount, monthly: Math.round(monthly), total: Math.round(monthly * months), months };
}

/** Price per square foot for each listing, so offers compare on one basis. */
function priceTable(listings = []) {
  return listings.map(l => ({ ...l, perSqft: l.price && l.area ? Math.round(l.price / l.area) : null })).filter(l => l.perSqft);
}

/* ---------------- the questions ---------------- */

const WHEN = ['before booking', 'before signing', 'before each payment', 'before possession', 'after possession'];
const TO = ['sales team', 'legal team', 'accounts team', 'site and engineering team', 'promoters', 'your own lawyer'];

/** Questions generated in code from conflicts, checks and inferences, so nothing found goes unasked. */
function questionsFromReasoning({ conflicts = [], checks = {}, chains = [], gaps = [] }) {
  const q = [];
  for (const c of conflicts) q.push({ topic: c.field, when: 'before signing', to: 'legal team',
    question: `Sources disagree on ${c.field}: ${c.versions.map(v => '"' + v.value + '"').join(' vs ')}. Which is correct, and which document proves it?`,
    why: 'Conflicting public information on a material fact must be settled from the primary document before you commit.',
    good: 'The certified document that states the value, with its date.', notAccepted: 'A verbal answer or a brochure.', basis: 'conflict', sources: c.versions.flatMap(v => v.sources), anchors: c.versions.map(v => v.value) });
  if (checks.area && !checks.area.reconciles) q.push({ topic: 'area', when: 'before signing', to: 'legal team', basis: 'inference',
    question: `${checks.area.text} Please share the approved area statement, the sanctioned plans and any additional FSI or TDR that explains the difference.`,
    why: 'If the built-up area is not sanctioned, completion, the occupation certificate and your title can all be affected.',
    good: 'Approved plans and an area statement that reconcile, signed by the architect.', notAccepted: '"It includes fungible or premium FSI" without the approval.', sources: [], anchors: ['area statement', String(checks.area.sanctioned)] });
  for (const ch of chains) q.push({ topic: 'common control', when: 'before booking', to: 'promoters', basis: 'inference',
    question: `${ch.a} and ${ch.b} share ${ch.steps.length} link${ch.steps.length > 1 ? 's' : ''}. Will ${ch.b} give a written, enforceable guarantee of ${ch.a}'s obligations under my agreement?`,
    why: 'The company that signs your agreement is the one you can enforce against. Group control does not create liability on its own.',
    good: 'A signed guarantee or undertaking from the group company, reviewed by your lawyer.', notAccepted: '"We are all one group."', sources: ch.steps.flatMap(s => s.sources), anchors: [ch.b, 'guarantee'] });
  for (const g of gaps) q.push({ topic: 'possession date', when: 'before signing', to: 'legal team', basis: 'inference',
    question: `The project is marketed with ${g.value}, ${Math.abs(g.months)} months ${g.months > 0 ? 'before' : 'after'} the filed completion date of ${g.filed}. Which date will my agreement carry, and what interest do I receive for each month of delay?`,
    why: 'Only the date in the registration and your agreement gives you a legal remedy; a marketed date gives none.',
    good: 'One date in the agreement, matching the registration, with the statutory interest clause.', notAccepted: 'An earlier "target" date in writing outside the agreement.', sources: g.sources, anchors: [g.value, g.filed] });
  return q;
}

/** Is this value (a date, a figure, a name) already named in a question? Prefix-tolerant: "Jul" matches "July". */
function anchorIn(anchor, text) {
  const a = norm(anchor), t = norm(text);
  if (!a) return false;
  if (t.includes(a)) return true;
  const want = a.split(' ').filter(x => x.length >= 3 || /\d/.test(x)), have = t.split(' ');
  return want.length > 0 && want.every(x => have.some(y => y === x || y.startsWith(x) || (/^\d+(\.\d+)?$/.test(x) && parseNumber(y) === parseNumber(x))));
}

/** All questions: the panel's and the reasoning's, deduplicated, ordered by when to ask. No cap.
 *  A question generated by reasoning merges into an earlier question that already names the same values
 *  (at least two of its anchors, or its only one), so an expert's wording is kept and nothing is asked twice. */
function assembleQuestions(lists) {
  const all = [];
  for (const q of lists.flat()) {
    if (!q || !q.question) continue;
    if (q.anchors && q.anchors.length) {
      const need = Math.min(2, q.anchors.length);
      const host = all.find(x => q.anchors.filter(a => anchorIn(a, x.question)).length >= need);
      if (host) { for (const s of q.sources || []) if (!host.sources.some(y => (y.url || y) === (s.url || s))) host.sources.push(s); continue; }
    }
    const when = WHEN.find(w => norm(q.when || '').includes(norm(w).split(' ').at(-1))) || 'before signing';
    const to = TO.find(t => norm(q.to || '').includes(norm(t).split(' ')[0])) || (q.to ? String(q.to) : 'legal team');
    const twin = all.find(x => jaccard(x.question, q.question) >= 0.55);
    if (twin) { for (const s of q.sources || []) if (!twin.sources.some(y => (y.url || y) === (s.url || s))) twin.sources.push(s); continue; }
    all.push({ ...q, when, to, sources: [...(q.sources || [])] });
  }
  all.sort((a, b) => WHEN.indexOf(a.when) - WHEN.indexOf(b.when));
  all.forEach((q, i) => { q.id = 'Q' + (i + 1); });
  return all;
}

/* ---------------- the whole dossier ---------------- */

/** Every distinct source, with its status, in the order first cited. */
function sourceList(facts, developerSite) {
  const seen = new Map();
  for (const f of facts) for (const s of f.sources) if (!seen.has(s.url))
    seen.set(s.url, { url: s.url, title: s.title || '', host: host(s.url), status: isOfficial(s.url) ? 'verified' : sameSite(s.url, developerSite) ? 'claim' : 'reported', seen: s.seen });
  return [...seen.values()];
}

/** Text that must never appear: the report describes, it does not tell the buyer what to do. */
const VERDICT = /\b(we recommend (buying|purchasing|avoiding)|do not buy|don'?t buy|proceed with conditions|safe to buy|good investment|avoid this project)\b/i;
const hasVerdict = text => VERDICT.test(String(text || ''));

module.exports = { STATUS, statusOf, isOfficial, host, safeUrl, norm, jaccard, parseDate, parseNumber, sameValue, mergeFacts, extractLeads,
  samePerson, commonControl, areaCheck, dateGaps, delayCost, priceTable, questionsFromReasoning, assembleQuestions, sourceList,
  WHEN, TO, hasVerdict, anchorIn };
