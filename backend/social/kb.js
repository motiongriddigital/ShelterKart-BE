'use strict';
/**
 * The knowledge base: the only thing a post may restate. One item is one fact for one market and one topic, with its type
 * (fact, inference, opinion or prediction), its official source, the date it was checked, when it must be rechecked, and how it was
 * verified. An item that is missing, unverified, out of scope or past its date cannot be used, so the engine never invents a rule.
 * The production base starts EMPTY on purpose: nothing is seeded, and nothing here is a real fact until a person or agent verifies it.
 */
const lex = require('./lexicons');
const TYPES = ['fact', 'inference', 'opinion', 'prediction'], SCOPE = 'new_build_primary', MAX_RECHECK_DAYS = 180, DAY = 864e5;
const ISO = /^\d{4}-\d{2}-\d{2}$/, HTTPS = /^https:\/\/[^\s/]+\.[^\s/]+/i;
const UNSAFE = ['accusation', 'advice', 'score_ranking', 'out_of_scope', 'safety_claim', 'fair_housing', 'sponsored'];
const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);

/** Everything wrong with an item, or [] when it can be stored. */
function validateItem(it, { today = new Date().toISOString().slice(0, 10), markets = null, topics = null } = {}) {
  const p = [], s = it && it.statement;
  if (!it || typeof it !== 'object') return ['not an item'];
  if (!/^[a-z0-9][a-z0-9_.-]{2,60}$/i.test(String(it.id || ''))) p.push('id: 3 to 60 letters, digits, dots, dashes or underscores');
  if (!/^[A-Z]{2}$/.test(String(it.market || '')) || (markets && !markets.includes(it.market))) p.push('market: a listed two-letter code');
  if (topics && !topics.includes(it.topic)) p.push('topic: one of the 12 curriculum topics');
  if (typeof s !== 'string' || s.trim().length < 15 || s.length > 400) p.push('statement: 15 to 400 characters');
  if (!TYPES.includes(it.type)) p.push('type: fact, inference, opinion or prediction');
  if (!it.source || !HTTPS.test(String(it.source.url || ''))) p.push('source.url: an https address'); if (!it.source || !String(it.source.name || '').trim()) p.push('source.name: who published it');
  if (!ISO.test(String(it.checkedOn || '')) || it.checkedOn > today) p.push('checkedOn: a date that is not in the future');
  if (!ISO.test(String(it.expiresOn || '')) || (ISO.test(String(it.checkedOn || '')) && (it.expiresOn <= it.checkedOn || days(it.checkedOn, it.expiresOn) > MAX_RECHECK_DAYS))) p.push(`expiresOn: after checkedOn and within ${MAX_RECHECK_DAYS} days of it`);
  if (it.scope !== SCOPE) p.push(`scope: must be ${SCOPE} (new-build, primary sales, direct from the developer)`);
  if (it.type === 'prediction' && !it.hedged) p.push('a prediction must be hedged');
  if (it.type === 'opinion' && !it.labelled) p.push('an opinion must be labelled as an informational opinion');
  if (typeof s === 'string') { const bad = lex.scan(s, UNSAFE); if (bad.length) p.push('statement: contains ' + [...new Set(bad.map(b => b.category + ' "' + b.term + '"'))].join(', ')); }
  if (it.status === 'verified' && !(it.verification && it.verification.by && it.verification.at)) p.push('verification: a verified item says who checked it and when');
  return p;
}

/** Can this item be restated today? { ok, reason }. */
function usable(it, today = new Date().toISOString().slice(0, 10)) {
  if (!it) return { ok: false, reason: 'missing' };
  if (it.status !== 'verified') return { ok: false, reason: 'not_verified' };
  if (it.scope !== SCOPE) return { ok: false, reason: 'out_of_scope' };
  if (it.checkedOn > today) return { ok: false, reason: 'checked_in_the_future' };
  if (it.expiresOn <= today) return { ok: false, reason: 'expired' };
  return { ok: true, reason: '' };
}

function makeKb({ markets = null, topics = null, today = () => new Date().toISOString().slice(0, 10), onChange = () => {} } = {}) {
  const items = new Map();
  return {
    put(item) { const p = validateItem(item, { today: today(), markets, topics }); if (p.length) throw Object.assign(new Error('Knowledge item refused: ' + p.join('; ')), { code: 'kb_invalid', problems: p }); items.set(item.id, { status: 'draft', ...item }); onChange(items.get(item.id)); return items.get(item.id); },
    /** Load items that were validated when they were stored (a restart). */
    restore(list) { for (const i of list || []) items.set(i.id, i); return items.size; },
    /** A person or agent has verified an item: it becomes usable, with who and when. Validation runs again on the verified form. */
    verify(id, by, at = today()) { const it = items.get(id); if (!it) throw Object.assign(new Error('No such item'), { code: 'not_found' }); const next = { ...it, status: 'verified', verification: { by, at } }; const p = validateItem(next, { today: today(), markets, topics }); if (p.length) throw Object.assign(new Error('Knowledge item refused: ' + p.join('; ')), { code: 'kb_invalid', problems: p }); items.set(id, next); onChange(next); return next; },
    get: id => items.get(id) || null,
    list: ({ market, topic, status } = {}) => [...items.values()].filter(i => (!market || i.market === market) && (!topic || i.topic === topic) && (!status || i.status === status)),
    usable: id => usable(items.get(id), today()),
    /** The usable items for a market and topic: what a post for that week may restate. */
    forPost: (market, topic) => [...items.values()].filter(i => i.market === market && i.topic === topic && usable(i, today()).ok),
    /** A recheck found the page still supports the item: push its dates forward. Validated again, so the 180-day limit still holds. */
    renew(id, { checkedOn = today(), expiresOn }) { const it = items.get(id); if (!it) throw Object.assign(new Error('No such item'), { code: 'not_found' }); const next = { ...it, checkedOn, expiresOn, status: it.status === 'expired' ? 'verified' : it.status }; const p = validateItem(next, { today: today(), markets, topics }); if (p.length) throw Object.assign(new Error('Knowledge item refused: ' + p.join('; ')), { code: 'kb_invalid', problems: p }); items.set(id, next); onChange(next); return next; },
    /** Take an item out of use for good (wrong, unsupported, or no longer true). It stays on record with who and why. */
    retire(id, by, why = '') { const it = items.get(id); if (!it) throw Object.assign(new Error('No such item'), { code: 'not_found' }); const next = { ...it, status: 'retired', retired: { by: String(by || ''), why: String(why).slice(0, 300), at: today() } }; items.set(id, next); onChange(next); return next; },
    /** Mark one item stale (its page changed): it stops being usable at once. */
    expire(id, why = '') { const it = items.get(id); if (!it) throw Object.assign(new Error('No such item'), { code: 'not_found' }); const next = { ...it, status: 'expired', expiredBecause: String(why).slice(0, 300) }; items.set(id, next); onChange(next); return next; },
    /** A drafted translation, NOT yet approved: the checker holds any post that uses it until a native speaker approves it. */
    setTranslation(id, lang, tr) { const it = items.get(id); if (!it) throw Object.assign(new Error('No such item'), { code: 'not_found' }); const next = { ...it, translations: { ...(it.translations || {}), [lang]: { text: String(tr.text), backEn: String(tr.backEn || ''), approvedBy: null, draftedAt: today() } } }; items.set(id, next); onChange(next); return next; },
    approveTranslation(id, lang, by) { const it = items.get(id); if (!it || !it.translations || !it.translations[lang]) throw Object.assign(new Error('No such translation'), { code: 'not_found' }); if (!String(by || '').trim()) throw Object.assign(new Error('Say who approved it'), { code: 'kb_invalid' }); const next = { ...it, translations: { ...it.translations, [lang]: { ...it.translations[lang], approvedBy: String(by), approvedAt: today() } } }; items.set(id, next); onChange(next); return next; },
    /** Mark every verified item past its date as expired; returns what changed, so the gap is reported. */
    sweep() { const out = []; for (const i of items.values()) if (i.status === 'verified' && i.expiresOn <= today()) { i.status = 'expired'; out.push(i.id); onChange(i); } return out; },
    coverage(markets, topics) { const rows = []; for (const m of markets) for (const t of topics) rows.push({ market: m, topic: t, usable: [...items.values()].some(i => i.market === m && i.topic === t && usable(i, today()).ok) }); return rows; },
    size: () => items.size, all: () => [...items.values()],
  };
}
module.exports = { makeKb, validateItem, usable, TYPES, SCOPE, MAX_RECHECK_DAYS, UNSAFE };
