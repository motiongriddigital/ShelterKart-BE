'use strict';
/**
 * The marketer, deterministic layer: turns ONE verified knowledge item into the post for ONE slot. It restates the item word for
 * word (the checker requires it), adds a market label, a source line, a question, the disclaimer and the platform's hashtags, and
 * describes the card or video that goes with it. It is the safe floor. A model polish (hooks, rhythm) can sit on top later, but the
 * checker still requires the claim verbatim and every number supported, so the polish cannot invent anything.
 * It covers English and the eight other site languages. For any other language a verified translation of the knowledge item is not
 * enough: the localiser must supply the surrounding words too, so the draft is refused with a clear reason rather than guessed.
 */
const crypto = require('crypto'), fs = require('fs'), path = require('path');
const SCHED = require('./schedule'), { DISCLAIMERS } = require('./checker');
const CURRICULUM = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'curriculum.json'), 'utf8'));
const PLATFORMS = SCHED.PLATFORMS;
// The words around the claim. These nine are written by an AI and need a native-speaker check in the dry run.
const PH = {
  en: { hook: n => `Home Buying Guide · chapter ${n}`, source: 'Source', question: 'What would you check first?', tags: ['#HomeBuying'] },
  hi: { hook: n => `घर खरीदने की गाइड · अध्याय ${n}`, source: 'स्रोत', question: 'आप सबसे पहले क्या जांचेंगे?', tags: ['#घरखरीदना'] },
  ar: { hook: n => `دليل شراء المنزل · الفصل ${n}`, source: 'المصدر', question: 'ما الذي ستتحقق منه أولاً؟', tags: ['#شراء_منزل'] },
  fr: { hook: n => `Guide d'achat immobilier · chapitre ${n}`, source: 'Source', question: 'Que vérifieriez-vous en premier ?', tags: ['#AchatImmobilier'] },
  es: { hook: n => `Guía para comprar vivienda · capítulo ${n}`, source: 'Fuente', question: '¿Qué comprobaría primero?', tags: ['#ComprarVivienda'] },
  de: { hook: n => `Ratgeber Immobilienkauf · Kapitel ${n}`, source: 'Quelle', question: 'Was würden Sie zuerst prüfen?', tags: ['#Immobilienkauf'] },
  pl: { hook: n => `Poradnik zakupu mieszkania · rozdział ${n}`, source: 'Źródło', question: 'Co sprawdziłbyś najpierw?', tags: ['#ZakupMieszkania'] },
  ja: { hook: n => `住宅購入ガイド・第${n}章`, source: '出典', question: '最初に何を確認しますか？', tags: ['#住宅購入'] },
  'zh-Hant': { hook: n => `購屋指南・第${n}章`, source: '來源', question: '您會先查證什麼？', tags: ['#購屋'] },
};
// What each of those phrases says in English, so the back-translation of the deterministic parts is exact.
const EN = PH.en, BRAND = '#ShelterKart';
const LANG_NAME = { en: 'English', hi: 'Hindi', ar: 'Arabic', fr: 'French', es: 'Spanish', de: 'German', pl: 'Polish', 'zh-Hant': 'Traditional Chinese', ja: 'Japanese' };
const hashOf = s => crypto.createHash('sha256').update(s).digest('hex');
const siteLink = (slot, topic) => `https://shelterkart.com/?utm_source=${slot.platform.toLowerCase()}&utm_medium=social&utm_campaign=${slot.market.toLowerCase()}-${topic}&utm_content=${slot.id}`;

/**
 * Draft one post. Returns { ok: true, spec } or { ok: false, reason }.
 * @param slot     one entry of the week's plan
 * @param item     a usable knowledge item for slot.market and `topic`
 * @param lang     the language of the post (the item must carry an approved translation for any language but English)
 */
function draft({ slot, item, lang = 'en', topic }) {
  const market = SCHED.marketByCode(slot.market), P = PLATFORMS[slot.platform], ph = PH[lang], t = CURRICULUM.topics.find(x => x.id === topic);
  if (!market || !P) return { ok: false, reason: 'unknown_slot' };
  if (!t) return { ok: false, reason: 'unknown_topic' };
  if (!ph) return { ok: false, reason: 'language_needs_localiser' };
  if (!item) return { ok: false, reason: 'no_usable_knowledge' };
  let claimText = item.statement;
  if (lang !== 'en') { const tr = item.translations && item.translations[lang]; if (!tr || !tr.approvedBy) return { ok: false, reason: 'translation_not_approved' }; claimText = tr.text; }
  const disc = DISCLAIMERS[lang], disclaimerEn = DISCLAIMERS.en, hook = ph.hook(t.chapter), hookEn = EN.hook(t.chapter);
  const link = (P.maxLinks > 0 && slot.platform !== 'LN') ? siteLink(slot, topic) : null;
  const host = (() => { try { return new URL(item.source.url).hostname.replace(/^www\./, ''); } catch { return item.source.name; } })();
  // X is short: the claim, its source and the disclaimer, and nothing else. The other platforms add the market label, the hook and the question.
  const short = slot.platform === 'X';
  const compose = srcName => {
    const src = `${ph.source}: ${srcName}, ${item.checkedOn}`, srcEn = `${EN.source}: ${srcName}, ${item.checkedOn}`;
    const parts = short ? [claimText, src, disc] : [`${market.name} · ${hook}`, claimText, src, ph.question, ...(link ? [link] : []), disc];
    const partsEn = short ? [item.statement, srcEn, disclaimerEn] : [`${market.name} · ${hookEn}`, item.statement, srcEn, EN.question, ...(link ? [link] : []), disclaimerEn];
    const tags = []; if (P.maxHashtags >= 1) tags.push(...ph.tags); if (P.maxHashtags >= 2) tags.unshift(BRAND);
    const hashtags = tags.slice(0, P.maxHashtags), body = parts.join('\n\n');
    return { src, body, partsEn, hashtags, fits: [...(body + (hashtags.length ? ' ' + hashtags.join(' ') : ''))].length <= P.maxChars };
  };
  let c = compose(item.source.name);
  if (!c.fits && short && host && host !== item.source.name) c = compose(host);              // a long page title: name the site instead
  const { src, body, partsEn, hashtags } = c;
  const cardText = [hook, claimText, src, disc].join('\n'), alt = `${hook}. ${claimText}`.slice(0, 400), kind = P.mediaKind || 'image';
  const media = P.requiresMedia ? [{ kind, template: kind === 'video' ? 'short_v1' : 'card_v1', text: cardText, alt, sha256: hashOf(`${kind}|${cardText}`), synthetic: false, jpeg: true }] : [];
  const bt = lang === 'en' ? '' : partsEn.join('\n\n');
  if (!c.fits) return { ok: false, reason: 'claim_too_long_for_platform' };
  return { ok: true, spec: {
    id: slot.id, market: slot.market, lang, platform: slot.platform, topic, chapter: t.chapter, kind: 'education', title: slot.platform === 'YT' ? `${market.name} · ${hook}`.slice(0, 100) : '',
    slot: { id: slot.id, market: slot.market, platform: slot.platform, localDate: slot.localDate, localTime: slot.localTime, zone: slot.zone, scheduledUtc: slot.scheduledUtc },
    body, hashtags, links: link ? [{ url: link, purpose: 'site' }] : [], media, claims: [{ kbId: item.id, text: claimText, type: item.type, sourceUrl: item.source.url, checkedOn: item.checkedOn, ...(item.hedged ? { hedged: true } : {}), ...(item.labelled ? { labelled: true } : {}) }],
    listCount: null, backtranslationEn: bt, disclaimer: disc, disclosure: { aiGenerated: false, aiLabel: false }, namedParties: [], sponsored: false, fromUserData: false, supersedes: null, correction: null,
    langName: LANG_NAME[lang], source: 'deterministic',
  } };
}
/** Which topic a market gets in a given week of the cycle: the 12 topics rotate, 12 weeks, then the next depth. */
function topicForWeek(weekIndex) { const n = CURRICULUM.topics.length, i = ((weekIndex % n) + n) % n; return { topic: CURRICULUM.topics[i].id, chapter: CURRICULUM.topics[i].chapter, depth: Math.floor(Math.abs(weekIndex) / n) % CURRICULUM.depths + 1 }; }
module.exports = { draft, topicForWeek, PH, CURRICULUM, siteLink };
