'use strict';
/**
 * ShelterKart -- translating a report without changing a fact.
 *
 * A report names real developers and states things about their records, so a
 * mistranslation is not cosmetic: "insolvency" for "delay" can do real harm.
 * The design therefore never trusts the translator:
 *
 *   1. Marks, sources and ids are NEVER translated. Only the words
 *      that describe them are, and they stay attached to the English finding.
 *   2. Code checks every translation against its source (checkTranslation):
 *      every number, date, registration id, URL and e-mail must survive
 *      unchanged, no new number may appear, and named projects/developers and
 *      official register names stay in the Latin script. A translation that
 *      fails is retried once; if it fails again that item is shown in ENGLISH,
 *      never a wrong translation.
 *   3. Claims that matter most (negative, legal, financial, registration) get
 *      a second, independent meaning check by the model; a mismatch also
 *      falls back to English.
 *   4. Translations are cached per sentence (language + glossary version + a
 *      hash of the text), so a sentence is translated once and every later
 *      report that contains it reuses it. Identical sentences (protections,
 *      standard questions, finding notes) cost nothing after the first.
 *   5. Any failure -- no API key, daily cap, network, bad reply -- returns the
 *      English report with a status saying so. A report never fails to open
 *      because it could not be translated.
 *
 * The English original governs. Every translated report says so.
 */
const crypto = require('crypto');
const { LANGUAGES, pickLanguage } = require('./languages');
const { callModel } = require('./searchLane');

const GLOSSARY_VERSION = 'g1';

// Names that stay exactly as written, in any language: registers, regulators, statutes.
const KEEP = ['RERA', 'MahaRERA', 'TNRERA', 'K-RERA', 'Oqood', 'DLD', 'RERA Act 2016', 'Companies House', 'ACRA', 'SGX', 'NSE', 'BSE', 'IBBI',
  'CIN', 'GST', 'EPC', 'HMRC', 'IRAS', 'URA', 'NCLT', 'NHBC', 'LABC', 'TOP', 'SIREN', 'UEN', 'ABN', 'ARES', 'HomeViews', 'Trustpilot'];

// Terms whose translation must be consistent and careful, per language. Reviewed by native speakers before `reviewed: true`.
const GLOSSARY = {
  hi: { 'escrow account': 'एस्क्रो खाता', 'possession': 'कब्ज़ा (पज़ेशन)', 'carpet area': 'कारपेट एरिया', 'insolvency': 'दिवालियापन', 'liquidation': 'परिसमापन', 'developer': 'डेवलपर', 'registered agreement': 'पंजीकृत समझौता', 'Occupation Certificate': 'ऑक्यूपेंसी सर्टिफिकेट (OC)' },
  ar: { 'escrow account': 'حساب ضمان', 'possession': 'التسليم', 'insolvency': 'الإعسار', 'liquidation': 'التصفية', 'developer': 'المطوّر', 'off-plan': 'على الخارطة', 'handover': 'التسليم' },
  pl: { 'escrow account': 'mieszkaniowy rachunek powierniczy', 'possession': 'odbiór lokalu', 'insolvency': 'niewypłacalność', 'liquidation': 'likwidacja', 'developer': 'deweloper', 'off-plan': 'na etapie budowy', 'handover': 'przekazanie lokalu' },
  'zh-Hant': { 'escrow account': '履約保證專戶', 'possession': '交屋', 'insolvency': '無力清償', 'liquidation': '清算', 'developer': '開發商', 'off-plan': '預售', 'handover': '交屋' },
  es: { 'escrow account': 'cuenta especial (garantía de cantidades anticipadas)', 'possession': 'entrega de llaves', 'insolvency': 'insolvencia', 'liquidation': 'liquidación', 'developer': 'promotor', 'off-plan': 'sobre plano', 'handover': 'entrega' },
  ja: { 'escrow account': 'エスクロー口座', 'possession': '引き渡し', 'insolvency': '支払不能', 'liquidation': '清算', 'developer': '開発業者', 'off-plan': '未完成物件（青田売り）', 'handover': '引き渡し', 'carpet area': 'カーペットエリア（専有面積）', 'liquidated damages': '違約金' },
  de: { 'escrow account': 'Treuhandkonto', 'possession': 'Übergabe', 'insolvency': 'Insolvenz', 'liquidation': 'Liquidation', 'developer': 'Bauträger', 'off-plan': 'ab Plan', 'handover': 'Übergabe' },
  fr: { 'escrow account': 'compte séquestre', 'possession': 'remise des clés', 'insolvency': 'insolvabilité', 'liquidation': 'liquidation judiciaire', 'developer': 'promoteur', 'off-plan': 'vente en l’état futur d’achèvement (VEFA)', 'handover': 'livraison' },
};

const hash = (text) => crypto.createHash('sha1').update(String(text)).digest('hex');
const cacheKey = (lang, text) => `${lang}|${GLOSSARY_VERSION}|${hash(text)}`;

/* ---------- the fact checks (pure code; the heart of the safety) ---------- */

/** Unicode decimal digits -> ASCII, so Devanagari or Arabic-Indic digits still count as the same number. */
function asciiDigits(s) {
  return String(s).replace(/[\u0660-\u0669\u06F0-\u06F9\u0966-\u096F]/g, ch => {
    const c = ch.codePointAt(0);
    return String(c >= 0x0966 ? c - 0x0966 : c >= 0x06F0 ? c - 0x06F0 : c - 0x0660);
  });
}
/** Digit groups in order of appearance: "1,49,00,000" -> [1,49,00,000]; separators differ by locale, the groups do not. */
const digitGroups = s => (asciiDigits(s).match(/\d+/g) || []).slice().sort();
const idTokens = s => (String(s).match(/\b[A-Z]{1,5}[-/]?\d{4,}[A-Z0-9/-]*\b|\b[A-Z0-9]{2,6}(?:\/[A-Za-z0-9]+){2,}\b/g) || []);
const urlTokens = s => (String(s).match(/https?:\/\/[^\s)]+|[\w.+-]+@[\w-]+\.[\w.-]+/g) || []);

/**
 * @returns {{ ok: boolean, problems: string[] }}
 * `names`: project/developer names that must stay verbatim when present in the source.
 */
function checkTranslation(source, translated, { names = [] } = {}) {
  const problems = [];
  if (typeof translated !== 'string' || !translated.trim()) return { ok: false, problems: ['empty'] };
  const a = digitGroups(source), b = digitGroups(translated);
  if (a.join('|') !== b.join('|')) {
    const missing = a.filter(x => !b.includes(x)), extra = b.filter(x => !a.includes(x));
    problems.push(`numbers differ (missing: ${missing.join(',') || '-'}; new: ${extra.join(',') || '-'})`);
  }
  for (const tok of [...idTokens(source), ...urlTokens(source)]) if (!translated.includes(tok)) problems.push(`lost "${tok}"`);
  for (const k of [...KEEP, ...names.filter(Boolean)]) {
    const re = new RegExp('(^|[^\\p{L}\\p{N}])' + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\p{L}\\p{N}])', 'u');
    if (re.test(source) && !translated.includes(k)) problems.push(`name changed: "${k}"`);
  }
  const ratio = translated.length / Math.max(1, source.length);
  if (ratio > 4 || (source.length > 40 && ratio < 0.2)) problems.push('implausible length');
  return { ok: problems.length === 0, problems };
}

/* ---------- which fields of a report are translated ---------- */
const SENSITIVE_TOPICS = new Set(['legal', 'financial', 'registration', 'track_record']);

/**
 * Every translatable string in a report, with a stable path. Marks, ids, urls,
 * sites and counts are not here: they are not words.
 * @returns {{ path, text, sensitive }[]}
 */
function collectTexts(brief) {
  const out = [];
  const add = (path, text, sensitive = false) => { if (typeof text === 'string' && text.trim()) out.push({ path, text, sensitive }); };
  (brief.findings || []).forEach((f, i) => {
    add(`findings.${i}.claim`, f.claim, f.stance === 'negative' || SENSITIVE_TOPICS.has(f.topic));
    add(`findings.${i}.note`, f.note);
  });
  (brief.conflicts || []).forEach((c, i) => { add(`conflicts.${i}.topic`, c.topic); (c.versions || []).forEach((v, j) => add(`conflicts.${i}.versions.${j}.value`, v.value)); });
  (brief.reading || []).forEach((r, i) => { add(`reading.${i}.observation`, r.observation, true); add(`reading.${i}.question`, r.question); });
  (brief.gaps || []).forEach((g, i) => { add(`gaps.${i}.topic`, g.topic); add(`gaps.${i}.why`, g.why); });
  // `when` (Before booking / signing / each payment / possession) is a fixed set the page groups by, and a heading in the interface
  // dictionary: translating it here would break the grouping, so it is deliberately not collected.
  (brief.questions || []).forEach((q, i) => ['who', 'question', 'good', 'red_flag'].forEach(k => add(`questions.${i}.${k}`, q[k])));
  (brief.notes || []).forEach((n, i) => add(`notes.${i}`, n));
  add('disclaimer', brief.disclaimer);
  const pr = brief.protections;
  if (pr) add('protections.disclaimer', pr.disclaimer);
  if (pr) (pr.items || []).forEach((it, i) => { add(`protections.items.${i}.title`, it.title); add(`protections.items.${i}.detail`, it.detail, true); });
  return out;
}

const setPath = (obj, path, value) => {
  const keys = path.split('.'); let o = obj;
  for (let i = 0; i < keys.length - 1; i++) { o = o && o[keys[i]]; if (o == null) return false; }
  o[keys[keys.length - 1]] = value; return true;
};

/* ---------- the translator ---------- */
let counter = { day: '', n: 0 };
const withinDailyCap = (env) => {
  const day = new Date().toISOString().slice(0, 10);
  if (counter.day !== day) counter = { day, n: 0 };
  return counter.n < (Number(env.TRANSLATE_DAILY_CAP) || 4000);
};

const memory = new Map();        // cacheKey -> translated text
let store = null;                // optional durable store: { getTranslations(keys), saveTranslations(rows) }
const attachStore = s => { store = s; };
/* The memory is a speed-up, never the record (the durable store keeps everything), so it is capped: the oldest entries go first. */
const memoryMax = env => { const n = Number(env && env.TRANSLATE_MEMORY_MAX); return Number.isFinite(n) && n >= 100 ? Math.floor(n) : 20000; };
function remember(key, text, env = process.env) { memory.delete(key); memory.set(key, text); const max = memoryMax(env); while (memory.size > max) memory.delete(memory.keys().next().value); }

function prompt(lang, items, names) {
  const L = LANGUAGES[lang];
  const gl = GLOSSARY[lang] ? Object.entries(GLOSSARY[lang]).map(([k, v]) => `"${k}" -> "${v}"`).join('; ') : '';
  return `You translate extracts of a real-estate due-diligence report from English into ${L.name} for ordinary home buyers.
Accuracy matters more than style: a report describes real companies, and a changed fact can harm them or the buyer.

Rules:
- Translate the VALUES of the JSON object; keep every key unchanged; return ONLY the JSON object.
- Keep every number, date, amount, percentage, registration id, URL and e-mail exactly as written. Write digits as 0-9. Never convert number words to digits or the reverse.
- Keep these names exactly as written, in Latin script: ${[...KEEP.slice(0, 18), ...names].filter(Boolean).join(', ')}. Keep all company, project and developer names exactly as written.
- Do not add, remove, soften or strengthen anything. Keep negations, hedges ("reportedly", "may") and tense. Do not add opinions.
- Use plain, polite, neutral language a buyer would use. Keep currency amounts as written (for example "₹1.49 crore").
${gl ? `- Use these terms consistently: ${gl}.\n` : ''}${L.dir === 'rtl' ? '- Write right-to-left Modern Standard Arabic; keep Latin names and digits as they are.\n' : ''}${lang === 'zh-Hant' ? '- Write Traditional Chinese as used in Taiwan and Hong Kong; keep Latin names and digits as they are.\n' : ''}${lang === 'de' ? '- Write Swiss Standard German: use "ss" instead of "ß", and the formal "Sie".\n' : ''}
${JSON.stringify(items)}`;
}

function parseObject(text) {
  const t = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('translation reply unreadable');
  return JSON.parse(t.slice(a, b + 1));
}
const textOf = data => (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');

async function translateBatch(lang, entries, { env, fetchImpl, names }) {
  // entries: [{ id, text }] -> { id: translated }
  const items = Object.fromEntries(entries.map(e => [e.id, e.text]));
  const r = await require('../engines').run('translate', 'complete', { prompt: prompt(lang, items, names), maxTokens: 8000, label: 'translation' }, { env, fetchImpl });
  const obj = parseObject(r.text || '');
  const out = {}; for (const e of entries) if (typeof obj[e.id] === 'string') out[e.id] = obj[e.id];
  return out;
}

/** The independent meaning check for sensitive claims: one call for all of them. */
async function verifyMeaning(lang, pairs, { env, fetchImpl }) {
  if (!pairs.length) return {};
  const body = Object.fromEntries(pairs.map(p => [p.id, { english: p.source, translation: p.translated }]));
  const r = await require('../engines').run('verify', 'complete', { prompt: `You check ${LANGUAGES[lang].name} translations of due-diligence statements about companies. For each id, decide whether the translation says exactly what the English says: same facts, same negations, same strength, nothing added or dropped. Reply ONLY with a JSON object mapping each id to {"ok": true} or {"ok": false, "issue": "short reason"}.\n${JSON.stringify(body)}` , maxTokens: 4000, label: 'meaning check' }, { env, fetchImpl });
  return parseObject(r.text || '');
}

/**
 * Translate a list of strings. Never throws; each result says whether it is a
 * real translation or the English fallback.
 * @param items [{ id, text, sensitive? }]
 * @returns { [id]: { text, translated: boolean, why? } }
 */
async function translateTexts(items, lang, { env = process.env, fetchImpl = globalThis.fetch, names = [] } = {}) {
  lang = pickLanguage(lang);
  const result = {}; const fallback = (it, why) => { result[it.id] = { text: it.text, translated: false, why }; };
  if (lang === 'en') { items.forEach(it => { result[it.id] = { text: it.text, translated: false, why: 'english' }; }); return result; }
  // 1. the cache
  const keys = items.map(it => cacheKey(lang, it.text));
  let missingKeys = keys.filter(k => !memory.has(k));
  if (missingKeys.length && store) {
    try { const rows = await store.getTranslations(missingKeys); for (const r of rows) remember(r.key, r.text, env); } catch (e) { console.error('[translate] cache read:', e && e.message); }
    missingKeys = keys.filter(k => !memory.has(k));
  }
  const todo = []; const seen = new Set();
  items.forEach((it, i) => {
    if (memory.has(keys[i])) { result[it.id] = { text: memory.get(keys[i]), translated: true, cached: true }; return; }
    if (seen.has(keys[i])) return; seen.add(keys[i]); todo.push({ ...it, key: keys[i] });
  });
  if (todo.length) {
    if (!require('../engines').available('translate', env) || env.TRANSLATE_ENABLED === 'false') todo.forEach(it => fallback(it, 'unavailable'));
    else if (!withinDailyCap(env)) todo.forEach(it => fallback(it, 'cap'));
    else {
      const good = {};                                                  // key -> translated text
      const attempt = async (entries) => {
        const sorted = []; for (let i = 0; i < entries.length; i += 30) sorted.push(entries.slice(i, i + 30));
        for (const chunk of sorted) {
          counter.n++;
          let got = {};
          try { got = await translateBatch(lang, chunk.map(e => ({ id: e.key, text: e.text })), { env, fetchImpl, names }); } catch (e) { console.error('[translate]', e && e.message); }
          for (const e of chunk) { const t = got[e.key]; if (t != null && checkTranslation(e.text, t, { names }).ok) good[e.key] = t; }
        }
      };
      await attempt(todo);
      await attempt(todo.filter(e => !(e.key in good)));                // one retry for what failed the fact checks
      // the meaning check, for the sensitive ones
      const sens = todo.filter(e => e.sensitive && e.key in good);
      if (sens.length && env.TRANSLATE_VERIFY !== 'false') {
        try {
          const v = await verifyMeaning(lang, sens.map(e => ({ id: e.key, source: e.text, translated: good[e.key] })), { env, fetchImpl });
          for (const e of sens) if (!v[e.key] || v[e.key].ok !== true) delete good[e.key];
        } catch (e) { console.error('[translate] verify:', e && e.message); sens.forEach(e2 => delete good[e2.key]); }   // cannot verify: do not show it
      }
      const rows = [];
      for (const e of todo) {
        if (e.key in good) { remember(e.key, good[e.key], env); rows.push({ key: e.key, lang, text: good[e.key] }); }
      }
      if (rows.length && store) { try { await store.saveTranslations(rows); } catch (e) { console.error('[translate] cache write:', e && e.message); } }
    }
    for (const it of items) if (!result[it.id]) {
      const k = cacheKey(lang, it.text);
      result[it.id] = memory.has(k) ? { text: memory.get(k), translated: true } : { text: it.text, translated: false, why: 'failed-check' };
    }
  }
  return result;
}

/**
 * A copy of the report in `lang`, with an `i18n` block saying what happened.
 * The English original is untouched (and returned when anything goes wrong).
 */
async function translateBrief(brief, lang, opts = {}) {
  lang = pickLanguage(lang);
  if (lang === 'en' || !brief) return brief;
  const base = { ...brief };
  try {
    const fields = collectTexts(brief);
    const names = [brief.project && brief.project.name, brief.project && brief.project.developer].filter(Boolean);
    const got = await translateTexts(fields.map(f => ({ id: f.path, text: f.text, sensitive: f.sensitive })), lang, { ...opts, names });
    const out = JSON.parse(JSON.stringify(brief));
    let done = 0;
    for (const f of fields) { const r = got[f.path]; if (r && r.translated) { setPath(out, f.path, r.text); done++; } }
    const fb = fields.length - done;
    out.i18n = { lang, status: fields.length === 0 || done === fields.length ? 'ai' : done === 0 ? 'english' : 'partial', translated: done, total: fields.length, fallback: fb,
      review: LANGUAGES[lang].review, original: 'en' };
    return out;
  } catch (e) {
    console.error('[translate] brief:', e && e.message);
    return { ...base, i18n: { lang, status: 'unavailable', translated: 0, total: 0, fallback: 0, review: LANGUAGES[lang].review, original: 'en' } };
  }
}

module.exports = { translateBrief, translateTexts, collectTexts, checkTranslation, attachStore, setPath, cacheKey, asciiDigits, digitGroups, GLOSSARY, KEEP, GLOSSARY_VERSION, remember, memoryMax, _memory: memory };
