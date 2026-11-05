'use strict';
/**
 * The constitution checker. Every rule of the ShelterKart Constitution, and the law and platform rules around it, as tests a post must pass.
 * It is independent of the marketer: it reads the finished post and the knowledge base, never the marketer's reasoning, and it never
 * rewrites anything. Verdicts: PASS, HOLD (a fixable problem; the marketer revises and resubmits) or BLOCK (a rule is broken and
 * rewording cannot fix it). The mechanical tests are fixed rules; the judgement tests use a separate model (the `verify` role) and,
 * when that is unavailable or unreadable, the post is HELD: when in doubt, hold.
 */
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const lex = require('./lexicons'), K = require('./kb'), SCHED = require('./schedule'), { fingerprintOf } = require('./fingerprint');
const DISCLAIMERS = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'disclaimers.json'), 'utf8')).disclaimers;
const CURRICULUM = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'curriculum.json'), 'utf8'));
const PLATFORMS = SCHED.PLATFORMS, MARKETS = new Map(SCHED.WHEEL.markets.map(m => [m.code, m]));
const LANGS = ['en', 'hi', 'ar', 'fr', 'pl', 'zh-Hant', 'es', 'de', 'ja', 'pt', 'it', 'nl', 'th', 'sv', 'da', 'no', 'fi', 'cs', 'et', 'lv', 'lt'];
const BLOCK = 'block', HOLD = 'hold';
const RULES = ['S1.structure', 'C1.sponsored', 'C2.claims_typed', 'C3.kb_trace', 'C3.numbers', 'C4.corrections', 'C5.named_party', 'C5.accusation', 'C7.scope', 'C8.score_ranking', 'C9.advice', 'C9.safety_claim',
  'C10.fair_housing', 'C11.sensitive', 'C12.platform', 'C12.links', 'C12.media', 'C13.privacy', 'C14.language', 'C14.backtranslation', 'C15.schedule', 'C16.duplicate', 'C17.tone', 'C18.disclaimer', 'C19.judge', 'C20.disclosure'];
const HASH = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
/** Changes whenever any rule, lexicon, platform limit, disclaimer or the checker's own code changes: an approval is only good for the version it was checked under. */
const RULES_VERSION = crypto.createHash('sha256').update([__filename, path.join(__dirname, 'data', 'platforms.json'), path.join(__dirname, 'data', 'disclaimers.json'), path.join(__dirname, 'data', 'curriculum.json'), path.join(__dirname, 'data', 'wheel.json')].map(HASH).join('|') + lex.VERSION + RULES.join(',')).digest('hex').slice(0, 12);

/* ---------- small helpers ---------- */
const DIGITS = { '٠': 0, '١': 1, '٢': 2, '٣': 3, '٤': 4, '٥': 5, '٦': 6, '٧': 7, '٨': 8, '٩': 9, '۰': 0, '۱': 1, '۲': 2, '۳': 3, '۴': 4, '۵': 5, '۶': 6, '۷': 7, '۸': 8, '۹': 9, '०': 0, '१': 1, '२': 2, '३': 3, '४': 4, '५': 5, '६': 6, '७': 7, '८': 8, '९': 9, '๐': 0, '๑': 1, '๒': 2, '๓': 3, '๔': 4, '๕': 5, '๖': 6, '๗': 7, '๘': 8, '๙': 9 };
const asciiDigits = s => String(s || '').normalize('NFKC').replace(/[٠-٩۰-۹०-९๐-๙]/g, d => DIGITS[d]);
const URL_RE = /https?:\/\/[^\s)>\]]+/gi, TAG_RE = /[#＃][^\s#＃]+/g;
const strip = s => String(s || '').replace(URL_RE, ' ').replace(TAG_RE, ' ');
const numbers = s => new Set((asciiDigits(strip(s)).match(/\d+/g) || []).map(n => String(+n === 0 && n.length ? n : n.replace(/^0+(?=\d)/, ''))));
const squash = s => lex.base(s).replace(/\s+/g, ' ').trim();
const hostOf = u => { try { return new URL(u).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; } };
const hostAllowed = (host, allowed) => allowed.some(a => host === a || host.endsWith('.' + a));
const SH_CACHE = new Map();
const shingles = text => { const key = String(text); if (SH_CACHE.has(key)) return SH_CACHE.get(key); if (SH_CACHE.size > 4000) SH_CACHE.clear(); const v = shinglesOf(text); SH_CACHE.set(key, v); return v; };
const shinglesOf = text => { const t = squash(strip(text)).replace(/[^\p{L}\p{N}\s]/gu, ''); const w = lex.base(t).match(/[\p{L}\p{N}]+/gu) || []; const set = new Set(); if (w.length >= 5 && !/[\u3040-\u9fff\u0e00-\u0e7f]/.test(t)) for (let i = 0; i + 5 <= w.length; i++) set.add(w.slice(i, i + 5).join(' ')); else { const c = t.replace(/\s+/g, ''); for (let i = 0; i + 6 <= c.length; i++) set.add(c.slice(i, i + 6)); } return set; };
const jaccard = (a, b) => { if (!a.size || !b.size) return 0; let n = 0; for (const x of a) if (b.has(x)) n++; return n / (a.size + b.size - n); };
const F = (rule, severity, detail, quote) => ({ rule, severity, detail, ...(quote ? { quote } : {}) });
const LEX_RULES = [['accusation', 'C5.accusation', BLOCK], ['score_ranking', 'C8.score_ranking', BLOCK], ['advice', 'C9.advice', BLOCK], ['out_of_scope', 'C7.scope', BLOCK], ['safety_claim', 'C9.safety_claim', BLOCK],
  ['fair_housing', 'C10.fair_housing', BLOCK], ['sponsored', 'C1.sponsored', BLOCK], ['sensitive', 'C11.sensitive', HOLD], ['clickbait', 'C17.tone', HOLD], ['scope_watch', 'C7.scope', HOLD]];

/**
 * All the mechanical tests. Pure and synchronous. ctx: { kb, today, holds, recent, langReady, allowedDomains, protectedNames }.
 * Returns findings: [{ rule, severity, detail, quote? }]; none means every mechanical test passed.
 */
function evaluate(spec, ctx = {}) {
  const f = [], kb = ctx.kb, today = ctx.today || new Date().toISOString().slice(0, 10);
  const s = spec || {}, market = MARKETS.get(s.market), P = PLATFORMS[s.platform];
  /* S1: the structure must be complete, or nothing else can be judged */
  const need = [];
  if (!market) need.push('market'); if (!LANGS.includes(s.lang)) need.push('lang'); if (!P) need.push('platform'); if (typeof s.body !== 'string' || !s.body.trim()) need.push('body');
  if (!Array.isArray(s.claims) || !s.claims.length) need.push('claims'); if (!s.slot || !s.slot.scheduledUtc || !s.slot.localDate) need.push('slot'); if (!Array.isArray(s.hashtags)) need.push('hashtags'); if (!Array.isArray(s.media)) need.push('media'); if (!Array.isArray(s.links)) need.push('links');
  if (need.length) { f.push(F('S1.structure', BLOCK, 'the post is incomplete: ' + need.join(', '))); return f; }
  const text = [s.title || '', s.body, ...s.hashtags, ...s.media.map(m => m.text || '')].join(' \n ');
  /* C1: nothing sponsored; trust cannot be purchased */
  if (s.sponsored) f.push(F('C1.sponsored', BLOCK, 'the post is marked sponsored or paid'));
  /* C5: no named party; developers are a stakeholder, not a target. A named post is not part of the weekly pack at all. */
  if (s.kind !== 'education') f.push(F('C5.named_party', BLOCK, `kind "${s.kind}" is not an education post: named-project posts go through the red-level process, never the weekly pack`));
  if (Array.isArray(s.namedParties) && s.namedParties.length) f.push(F('C5.named_party', BLOCK, 'the post names a party: ' + s.namedParties.join(', ')));
  for (const n of ctx.protectedNames || []) { const re = new RegExp('(?<![\\p{L}\\p{N}])' + String(n).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\p{L}\\p{N}])', 'iu'); if (re.test(text)) f.push(F('C5.named_party', BLOCK, 'the text contains a protected name', n)); }
  /* the lexicons */
  for (const hit of lex.scan(text)) { const r = LEX_RULES.find(x => x[0] === hit.category); if (r) f.push(F(r[1], r[2], `${hit.category}: "${hit.term}" (${hit.lang}, ${hit.via})`, hit.term)); }
  /* C2 and C3: every claim is typed and restates a usable knowledge-base item; no number is invented */
  const allowed = new Set(); let claimsOk = true;
  for (const c of s.claims) {
    const it = kb && kb.get(c.kbId);
    if (!K.TYPES.includes(c.type)) { f.push(F('C2.claims_typed', BLOCK, `a claim has no valid type (${c.type})`)); claimsOk = false; }
    if (c.type === 'fact' && (!/^https:\/\//.test(c.sourceUrl || '') || !/^\d{4}-\d{2}-\d{2}$/.test(c.checkedOn || ''))) f.push(F('C2.claims_typed', BLOCK, `a fact needs an https source and a check date (${c.kbId})`));
    if (c.type === 'prediction' && !c.hedged) f.push(F('C2.claims_typed', BLOCK, `a prediction must be hedged (${c.kbId})`));
    if (c.type === 'opinion' && !c.labelled) f.push(F('C2.claims_typed', BLOCK, `an opinion must be labelled as an informational opinion (${c.kbId})`));
    if (!it) { f.push(F('C3.kb_trace', BLOCK, `claim ${c.kbId} is not in the knowledge base`)); claimsOk = false; continue; }
    const u = K.usable(it, today); if (!u.ok) f.push(F('C3.kb_trace', BLOCK, `knowledge item ${c.kbId} cannot be used: ${u.reason}`));
    if (it.market !== s.market) f.push(F('C3.kb_trace', BLOCK, `knowledge item ${c.kbId} is for ${it.market}, not ${s.market}`));
    if (it.type !== c.type) f.push(F('C3.kb_trace', BLOCK, `claim type ${c.type} differs from the item's ${it.type}`));
    if (it.source.url !== c.sourceUrl || it.checkedOn !== c.checkedOn) f.push(F('C3.kb_trace', BLOCK, `claim ${c.kbId} does not carry the item's source and check date`));
    const tr = s.lang === 'en' ? { text: it.statement, ok: true } : (it.translations && it.translations[s.lang] ? { text: it.translations[s.lang].text, ok: Boolean(it.translations[s.lang].approvedBy) } : null);
    if (!tr) { f.push(F('C14.language', HOLD, `no ${s.lang} translation of ${c.kbId}`)); }
    else {
      if (!tr.ok) f.push(F('C14.language', HOLD, `the ${s.lang} translation of ${c.kbId} has not been approved`));
      if (squash(c.text) !== squash(tr.text)) f.push(F('C3.kb_trace', BLOCK, `claim text differs from the knowledge item ${c.kbId}`));
      if (!squash(s.body).includes(squash(c.text))) f.push(F('C3.kb_trace', BLOCK, `the body does not restate claim ${c.kbId} word for word`));
    }
    for (const n of numbers(c.text)) allowed.add(n);
    for (const n of String(c.checkedOn || '').split('-')) allowed.add(String(+n));
  }
  /* the curriculum: the chapter number must be the topic's */
  const topic = CURRICULUM.topics.find(t => t.id === s.topic);
  if (s.chapter != null) { if (!topic || topic.chapter !== s.chapter) f.push(F('C3.numbers', BLOCK, `chapter ${s.chapter} is not the chapter of topic ${s.topic}`)); else allowed.add(String(s.chapter)); }
  if (s.listCount != null) allowed.add(String(s.listCount));
  if (claimsOk) { const extra = [...numbers([s.title, s.body].join(' '))].filter(n => !allowed.has(n)); if (extra.length) f.push(F('C3.numbers', BLOCK, 'the post states numbers that no claim supports: ' + extra.join(', '))); }
  /* C4: a correction is never silent */
  if (s.supersedes && !(s.correction && String(s.correction.note || '').trim().length >= 15 && /^\d{4}-\d{2}-\d{2}$/.test(s.correction.date || ''))) f.push(F('C4.corrections', BLOCK, 'a post that replaces an earlier one carries a visible, dated correction note'));
  /* C12: the platform's own limits */
  if (P) {
    if (s.hashtags.length > P.maxHashtags) f.push(F('C12.platform', HOLD, `${s.hashtags.length} hashtags; ${P.name} allows ${P.maxHashtags}`));
    for (const h of s.hashtags) { if (!/^[#＃][^\s#＃]{1,40}$/.test(h)) f.push(F('C12.platform', HOLD, `malformed hashtag ${h}`)); }
    const chars = [...(s.body + (s.hashtags.length ? ' ' + s.hashtags.join(' ') : ''))].length; if (chars > P.maxChars) f.push(F('C12.platform', HOLD, `${chars} characters; ${P.name} allows ${P.maxChars}`));
    if (s.links.length > P.maxLinks) f.push(F('C12.links', HOLD, `${s.links.length} links; ${P.name} allows ${P.maxLinks}`));
    const domains = [...(ctx.allowedDomains || ['shelterkart.com']), ...s.claims.map(c => hostOf(c.sourceUrl))].filter(Boolean);
    for (const l of s.links) if (!/^https:\/\//.test(l.url || '') || !hostAllowed(hostOf(l.url), domains)) f.push(F('C12.links', BLOCK, `a link goes somewhere the post may not point: ${l.url}`));
    for (const u of (s.body.match(URL_RE) || [])) if (!s.links.some(l => l.url === u.replace(/[.,;:!?]+$/, ''))) f.push(F('C12.links', HOLD, `a link in the text is not declared: ${u}`));
    if (P.requiresMedia && !s.media.length) f.push(F('C12.media', HOLD, `${P.name} needs an image or video`));
    if (P.mediaKind && s.media.length && !s.media.some(m => m.kind === P.mediaKind)) f.push(F('C12.media', HOLD, `${P.name} needs a ${P.mediaKind}`));
    for (const m of s.media) { if (m.kind === 'image' && String(m.alt || '').trim().length < 10) f.push(F('C12.media', HOLD, 'an image has no alt text')); if (s.platform === 'IG' && m.kind === 'image' && m.jpeg === false) f.push(F('C12.media', HOLD, 'Instagram images must be JPEG')); }
  }
  const letters = (s.body.match(/\p{Lu}|\p{Ll}/gu) || []); if (letters.length >= 20 && /[A-Za-z]/.test(s.body) && letters.filter(c => c !== c.toLowerCase()).length / letters.length > 0.5) f.push(F('C17.tone', HOLD, 'more than half the letters are capitals'));
  if ((s.body.match(/\p{Extended_Pictographic}/gu) || []).length > 1) f.push(F('C17.tone', HOLD, 'more than one emoji'));
  /* C13: privacy */
  if (s.fromUserData) f.push(F('C13.privacy', BLOCK, 'the post is derived from a user\'s research or paid report'));
  const flat = asciiDigits(strip(text));
  if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(s.body) || /\b[A-Z]{5}\d{4}[A-Z]\b/.test(s.body) || /\b\d{4}\s?\d{4}\s?\d{4}\b/.test(flat) || /(?:\+?\d[\d\s().-]{8,}\d)/.test(flat.replace(/\d{4}-\d{2}-\d{2}/g, ''))) f.push(F('C13.privacy', BLOCK, 'the text contains something that looks like an e-mail address, a phone number or an ID number'));
  /* C14: language */
  if (market && !market.languages.some(l => ({ English: 'en', Hindi: 'hi', Arabic: 'ar', French: 'fr', Polish: 'pl', 'Traditional Chinese': 'zh-Hant', Spanish: 'es', German: 'de', Japanese: 'ja', Portuguese: 'pt', Italian: 'it', Dutch: 'nl', Thai: 'th', Swedish: 'sv', Danish: 'da', Norwegian: 'no', Finnish: 'fi', Czech: 'cs', Estonian: 'et', Latvian: 'lv', Lithuanian: 'lt' }[l]) === s.lang) && s.lang !== 'en') f.push(F('C14.language', BLOCK, `${s.lang} is not a language of ${s.market}`));
  if (s.lang !== 'en') {
    if (!(ctx.langReady && ctx.langReady[s.lang])) f.push(F('C14.language', HOLD, `${s.lang} is not yet ready for posting: it needs a landing page and a native-speaker check`));
    const bt = String(s.backtranslationEn || '').trim();
    if (!bt) f.push(F('C14.backtranslation', HOLD, 'a local-language post needs its English back-translation'));
    else { const a = numbers(s.body), b = numbers(bt), diff = [...a].filter(n => !b.has(n)).concat([...b].filter(n => !a.has(n))); if (diff.length) f.push(F('C14.backtranslation', HOLD, 'the numbers differ between the post and its back-translation: ' + diff.join(', '))); }
  }
  /* C18: the disclaimer */
  const line = DISCLAIMERS[s.lang] || DISCLAIMERS.en, hay = squash([s.body, ...s.media.map(m => m.text || '')].join(' '));
  if (!hay.includes(squash(line))) f.push(F('C18.disclaimer', HOLD, `the line "${line}" is missing from the post and its card`));
  /* C20: AI-made media is labelled */
  if (s.media.some(m => m.synthetic) && !(s.disclosure && s.disclosure.aiGenerated && s.disclosure.aiLabel)) f.push(F('C20.disclosure', HOLD, 'AI-made media must be labelled as such'));
  /* C15: the wheel and the clock */
  if (market) {
    const idx = (new Date(s.slot.localDate + 'T00:00:00Z').getUTCDay() + 6) % 7, expected = market.week[idx];
    if (s.platform !== expected) f.push(F('C15.schedule', BLOCK, `off the wheel: ${market.name} posts on ${expected} that day, not ${s.platform}`));
    const lp = SCHED.localParts(market.zone, Date.parse(s.slot.scheduledUtc)); if (lp.date !== s.slot.localDate || lp.minutes >= 23 * 60 || lp.minutes < 6 * 60) f.push(F('C15.schedule', BLOCK, 'the scheduled time is not in the market\'s local day, or falls in the night'));
    if (ctx.holds && ctx.holds[s.market]) f.push(F('C15.schedule', HOLD, `${market.name} is on a sensitivity hold`));
  }
  /* C16: not a copy of another market's post */
  if (Array.isArray(ctx.recent) && ctx.recent.length) { const mine = shingles(s.body); for (const r of ctx.recent) if (r.market !== s.market && r.id !== s.id && jaccard(mine, shingles(r.body)) >= 0.8) { f.push(F('C16.duplicate', HOLD, `almost the same as ${r.market}'s post ${r.id}: each market needs its own facts, terms and local detail`)); break; } }
  return dedupe(f);
}
function dedupe(list) { const seen = new Set(); return list.filter(x => { const k = x.rule + '|' + x.severity + '|' + x.detail; if (seen.has(k)) return false; seen.add(k); return true; }); }
const verdictOf = findings => findings.some(x => x.severity === BLOCK) ? 'block' : findings.length ? 'hold' : 'pass';

/* ---------- the judgement test: a separate model reads the finished post ---------- */
function buildJudgePrompt(spec) {
  return `You are the constitution checker for ShelterKart, a service that publishes research from public records about NEW-BUILD primary-sale property. You never rewrite a post; you only judge it.
Judge the post below against these rules. Report only real problems.
- C3.kb_trace: any factual statement that is NOT one of the listed claims.
- C5.accusation: any accusation, or implied accusation, against any person or company.
- C5.named_party: any named or clearly identifiable company, developer, project or person.
- C9.advice: any advice to buy, not buy, borrow or invest, or any promise of a return.
- C10.fair_housing: any preference for or against a kind of buyer (religion, caste, ethnicity, gender, nationality, family status, income).
- C7.scope: anything about resale, the secondary market, renting or land.
- C11.sensitive: politics, religion, war, death or a tragedy.
- C17.tone: fear, clickbait or hype.
Post language: ${spec.lang}. Market: ${spec.market}. Platform: ${spec.platform}.
LISTED CLAIMS (the only facts allowed):
${(spec.claims || []).map((c, i) => `${i + 1}. [${c.type}] ${c.text}`).join('\n')}
POST:
"""
${spec.body}
"""
English back-translation: ${spec.backtranslationEn || '(none: the post is in English)'}
Answer with JSON only, no other text: {"pass": true|false, "issues": [{"rule": "C5.accusation", "quote": "the words", "why": "one sentence"}]}`;
}
function parseJudge(text) {
  const m = String(text || '').match(/\{[\s\S]*\}/); if (!m) return null;
  try { const j = JSON.parse(m[0]); if (typeof j.pass !== 'boolean') return null; return { pass: j.pass, issues: Array.isArray(j.issues) ? j.issues.filter(i => i && RULES.includes(i.rule)).map(i => ({ rule: i.rule, quote: String(i.quote || '').slice(0, 200), why: String(i.why || '').slice(0, 300) })) : [] }; } catch { return null; }
}
/** The model judge, on the `verify` role so it can run on a different provider from the marketer (which uses `adviser`). */
function makeLlmJudge({ engines = require('../engines'), env = process.env, fetchImpl } = {}) {
  return async spec => { const r = await engines.run('verify', 'complete', { prompt: buildJudgePrompt(spec), maxTokens: 700, label: 'social checker' }, { env, fetchImpl }); return parseJudge(r.text); };
}

/**
 * The checker, with its audit trail. check(spec, ctx) runs the mechanical tests, then the judge (unless ctx.judge === 'off', used only in tests),
 * logs the verdict with the post's fingerprint, and returns { verdict, findings, rulesVersion, fingerprint }.
 */
function makeChecker({ kb, audit = null, judge = null, defaults = {} } = {}) {
  async function check(spec, ctx = {}) {
    const c = { kb, ...defaults, ...ctx }; const findings = evaluate(spec, c);
    if (!findings.some(x => x.severity === BLOCK)) {
      const j = c.judge === 'off' ? 'off' : (c.judge || judge);
      if (j === 'off') { /* tests only */ }
      else if (!j) findings.push(F('C19.judge', HOLD, 'no judgement model is available: when in doubt, hold'));
      else {
        let r = null; try { r = await j(spec); } catch { r = null; }
        if (!r) findings.push(F('C19.judge', HOLD, 'the judgement model was unavailable or its answer could not be read: when in doubt, hold'));
        else { for (const i of r.issues) findings.push(F(i.rule, ['C5.accusation', 'C5.named_party', 'C9.advice', 'C10.fair_housing', 'C7.scope', 'C3.kb_trace'].includes(i.rule) ? BLOCK : HOLD, 'judge: ' + (i.why || i.rule), i.quote)); if (!r.pass && !r.issues.length) findings.push(F('C19.judge', HOLD, 'the judge did not pass the post and gave no reason')); }
      }
    }
    const out = { verdict: verdictOf(dedupe(findings)), findings: dedupe(findings), rulesVersion: RULES_VERSION, fingerprint: fingerprintOf(spec) };
    if (audit) audit.append('check', { postId: spec && spec.id, market: spec && spec.market, platform: spec && spec.platform, fingerprint: out.fingerprint, verdict: out.verdict, rules: [...new Set(out.findings.map(x => x.rule))], rulesVersion: RULES_VERSION });
    return out;
  }
  return { check, evaluate: (spec, ctx = {}) => { const f = evaluate(spec, { kb, ...defaults, ...ctx }); return { verdict: verdictOf(f), findings: f }; }, rulesVersion: RULES_VERSION };
}
module.exports = { makeChecker, evaluate, verdictOf, buildJudgePrompt, parseJudge, makeLlmJudge, RULES, RULES_VERSION, DISCLAIMERS, LANGS, numbers, squash };
