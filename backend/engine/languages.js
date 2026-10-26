'use strict';
/**
 * ShelterKart -- languages, one source of truth.
 *
 * Two different questions, kept apart on purpose:
 *   1. Which languages can a buyer READ ShelterKart in?   (LANGUAGES, `enabled`)
 *   2. Which languages should RESEARCH search in?          (researchLanguages)
 * A market can be researched in Polish long before a Polish interface exists:
 * local-language sources often hold the official record, and the report is
 * written in English first, then translated for the reader.
 *
 * `enabled`: a dictionary and tests exist and the language is offered.
 * `review`: who checked the dictionary, and the page says exactly that:
 *   'none'   -- AI translation only: "A native speaker has not yet reviewed this translation."
 *   'ai'     -- translated AND checked with AI: the automated fact, negation and plural checks plus a
 *               line-by-line AI review, recorded in i18n/REVIEW.md. The page says "Translated and checked with AI."
 *   'native' -- a native speaker signed it off. Never set this unless one did.
 *
 * Adding a language: add its entry here, add i18n/<code>.json (same keys as
 * en.json), run `node tools/build_i18n.js`, set `enabled`. A test fails if a
 * dictionary is missing a key, adds one, or breaks a {placeholder}.
 */
const LANGUAGES = {
  en: { name: 'English', native: 'English', dir: 'ltr', locale: 'en', enabled: true, review: 'native' },
  hi: { name: 'Hindi', native: 'हिन्दी', dir: 'ltr', locale: 'hi-IN', enabled: true, review: 'ai' },
  ar: { name: 'Arabic', native: 'العربية', dir: 'rtl', locale: 'ar-AE', enabled: true, review: 'ai' },
  fr: { name: 'French', native: 'Français', dir: 'ltr', locale: 'fr-FR', enabled: true, review: 'ai' },
  // Wave 2 (October 2026): the three largest markets whose buyers had no language of their own.
  pl: { name: 'Polish', native: 'Polski', dir: 'ltr', locale: 'pl-PL', enabled: true, review: 'ai' },
  'zh-Hant': { name: 'Chinese (Traditional)', native: '繁體中文', dir: 'ltr', locale: 'zh-TW', enabled: true, review: 'ai' },
  es: { name: 'Spanish', native: 'Español', dir: 'ltr', locale: 'es-ES', enabled: true, review: 'ai' },
  // Wave 3: German, Switzerland's main language (and the largest market left without its own).
  de: { name: 'German', native: 'Deutsch', dir: 'ltr', locale: 'de-CH', enabled: true, review: 'ai' },
  // Wave 4 (October 2026): Japan, the second-largest market whose buyers had no language of their own (208,169 homes for sale started in 2025).
  ja: { name: 'Japanese', native: '日本語', dir: 'ltr', locale: 'ja-JP', enabled: true, review: 'ai' },
  // Planned: the framework is ready; each needs a dictionary, tests and a native reviewer.
  'zh-Hans': { name: 'Chinese (Simplified)', native: '简体中文', dir: 'ltr', locale: 'zh-SG', enabled: false, review: 'none' },

  it: { name: 'Italian', native: 'Italiano', dir: 'ltr', locale: 'it-CH', enabled: false, review: 'none' },
  nl: { name: 'Dutch', native: 'Nederlands', dir: 'ltr', locale: 'nl-BE', enabled: false, review: 'none' },
  cs: { name: 'Czech', native: 'Čeština', dir: 'ltr', locale: 'cs-CZ', enabled: false, review: 'none' },
  sv: { name: 'Swedish', native: 'Svenska', dir: 'ltr', locale: 'sv-SE', enabled: false, review: 'none' },
  da: { name: 'Danish', native: 'Dansk', dir: 'ltr', locale: 'da-DK', enabled: false, review: 'none' },
  nb: { name: 'Norwegian', native: 'Norsk', dir: 'ltr', locale: 'nb-NO', enabled: false, review: 'none' },
  fi: { name: 'Finnish', native: 'Suomi', dir: 'ltr', locale: 'fi-FI', enabled: false, review: 'none' },
  et: { name: 'Estonian', native: 'Eesti', dir: 'ltr', locale: 'et-EE', enabled: false, review: 'none' },
  lv: { name: 'Latvian', native: 'Latviešu', dir: 'ltr', locale: 'lv-LV', enabled: false, review: 'none' },
  lt: { name: 'Lithuanian', native: 'Lietuvių', dir: 'ltr', locale: 'lt-LT', enabled: false, review: 'none' },
  ta: { name: 'Tamil', native: 'தமிழ்', dir: 'ltr', locale: 'ta-IN', enabled: false, review: 'none' },
  mr: { name: 'Marathi', native: 'मराठी', dir: 'ltr', locale: 'mr-IN', enabled: false, review: 'none' },
  ms: { name: 'Malay', native: 'Bahasa Melayu', dir: 'ltr', locale: 'ms-SG', enabled: false, review: 'none' },
  ru: { name: 'Russian', native: 'Русский', dir: 'ltr', locale: 'ru-AE', enabled: false, review: 'none' },
  pt: { name: 'Portuguese', native: 'Português', dir: 'ltr', locale: 'pt-BR', enabled: false, review: 'none' },
  th: { name: 'Thai', native: 'ไทย', dir: 'ltr', locale: 'th-TH', enabled: false, review: 'none' },
};

// Each market's languages, the first being the one its buyers most often prefer. Market codes match markets.js.
const MARKET_LANGUAGES = {
  in: ['hi', 'en', 'ta', 'mr'], ae: ['ar', 'en', 'ru', 'hi'], uk: ['en'], sg: ['en', 'zh-Hans', 'ms', 'ta'], au: ['en'], nz: ['en'],
  hk: ['zh-Hant', 'en'], tw: ['zh-Hant'], ie: ['en'], fr: ['fr'], es: ['es'], pl: ['pl'], cz: ['cs'], se: ['sv'], dk: ['da'],
  no: ['nb'], fi: ['fi', 'sv'], ee: ['et'], lv: ['lv'], lt: ['lt'], be: ['nl', 'fr'], ch: ['de', 'fr', 'it'],
  // The markets added in October 2026, which until now had no entry (so nothing was offered there)
  us: ['en', 'es'], ca: ['en', 'fr'], my: ['ms', 'en', 'zh-Hans'], de: ['de', 'en'], nl: ['nl', 'en'], pt: ['pt', 'en'], it: ['it', 'en'],
  sa: ['ar', 'en'], za: ['en'], br: ['pt'], mx: ['es'], jp: ['ja', 'en'], th: ['th', 'en'], ph: ['en'],
};

const enabled = () => Object.keys(LANGUAGES).filter(c => LANGUAGES[c].enabled);
const isEnabled = code => Boolean(LANGUAGES[code] && LANGUAGES[code].enabled);

/** A language code from a request, or 'en'. Never throws, never returns a disabled language. */
function pickLanguage(requested) {
  const code = String(requested || '').trim();
  const key = Object.keys(LANGUAGES).find(c => c.toLowerCase() === code.toLowerCase());
  return key && LANGUAGES[key].enabled ? key : 'en';
}

/** The languages a market's buyers use, enabled ones first (for the selector's suggestion). */
function languagesForMarket(market) {
  const all = MARKET_LANGUAGES[market] || ['en'];
  return [...all.filter(isEnabled), ...all.filter(c => !isEnabled(c))];
}

/**
 * Languages RESEARCH should search in besides English, as English names for the prompt.
 * Independent of whether an interface exists for them.
 */
function researchLanguages(market) {
  return (MARKET_LANGUAGES[market] || []).filter(c => c !== 'en').slice(0, 2).map(c => LANGUAGES[c].name);
}

/** What the browser needs: code, native name, direction, locale, reviewed -- for enabled languages only. */
function publicList() {
  return enabled().map(c => ({ code: c, native: LANGUAGES[c].native, name: LANGUAGES[c].name, dir: LANGUAGES[c].dir, locale: LANGUAGES[c].locale, review: LANGUAGES[c].review }));
}

module.exports = { LANGUAGES, MARKET_LANGUAGES, enabled, isEnabled, pickLanguage, languagesForMarket, researchLanguages, publicList };
