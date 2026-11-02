'use strict';
/**
 * TEST ONLY. Every statement here begins "TEST ONLY" and is not a fact about any country. The production knowledge base is empty
 * and nothing here is ever loaded outside the tests and the local demo.
 */
const K = require('../../social/kb'), S = require('../../social/schedule'), M = require('../../social/marketer');
const TODAY = '2026-10-26', MONDAY = '2026-10-26';
const TEXT = {
  en: m => `TEST ONLY (${m}): the ${m} regulator's public register lists a project's registration number, its promoter and its approved completion date.`,
  hi: m => `केवल परीक्षण (${m}): ${m} नियामक का सार्वजनिक रजिस्टर परियोजना का पंजीकरण नंबर, उसका प्रवर्तक और स्वीकृत पूर्णता तिथि दिखाता है।`,
  ar: m => `للاختبار فقط (${m}): يعرض السجل العام للجهة التنظيمية في ${m} رقم تسجيل المشروع والمطوّر وتاريخ الإنجاز المعتمد.`,
  fr: m => `TEST UNIQUEMENT (${m}) : le registre public de ${m} indique le numéro d'enregistrement d'un projet, son promoteur et sa date d'achèvement.`,
  es: m => `SOLO PRUEBA (${m}): el registro público del regulador de ${m} muestra el número de registro de un proyecto, su promotor y su fecha de entrega aprobada.`,
  de: m => `NUR TEST (${m}): Das Register der Behörde von ${m} zeigt Registrierungsnummer, Bauträger und Fertigstellungsdatum eines Projekts.`,
  pl: m => `TYLKO TEST (${m}): publiczny rejestr organu nadzorczego w ${m} pokazuje numer rejestracyjny projektu, jego dewelopera i zatwierdzoną datę ukończenia.`,
  ja: m => `テスト用（${m}）：${m}の規制当局の公開登録簿には、プロジェクトの登録番号、事業者、承認された完成予定日が記載されています。`,
  'zh-Hant': m => `僅供測試（${m}）：${m}監管機構的公開登記冊會顯示項目的登記編號、發展商和獲批的完工日期。`,
};
const LOCAL = { IN: 'hi', AE: 'ar', SA: 'ar', HK: 'zh-Hant', TW: 'zh-Hant', FR: 'fr', BE: 'fr', CH: 'de', DE: 'de', ES: 'es', MX: 'es', PL: 'pl', JP: 'ja', CA: 'fr' };
const langFor = code => LOCAL[code] || 'en';
const READY = Object.fromEntries(Object.keys(TEXT).map(l => [l, true]));
const topics = M.CURRICULUM.topics.map(t => t.id), markets = S.WHEEL.markets.map(m => m.code);

function buildKb(today = TODAY) {
  const kb = K.makeKb({ markets, topics, today: typeof today === 'function' ? today : () => today });
  for (const m of S.WHEEL.markets) for (const t of topics) {
    const translations = {}; for (const l of Object.keys(TEXT)) if (l !== 'en') translations[l] = { text: TEXT[l](m.name), approvedBy: 'test' };
    kb.put({ id: `test.${m.code}.${t}`, market: m.code, topic: t, statement: TEXT.en(m.name), type: 'fact', source: { name: 'Test regulator', url: 'https://example.org/register' }, checkedOn: '2026-10-20', expiresOn: '2027-01-20', scope: 'new_build_primary', status: 'verified', verification: { by: 'agent', at: '2026-10-21' }, translations });
  }
  return kb;
}
/** One good post for a slot, in its market's local language (or English). */
function goodPost(kb, slot, { lang, topic = 't01' } = {}) {
  const l = lang || langFor(slot.market), r = M.draft({ slot, item: kb.get(`test.${slot.market}.${topic}`), lang: l, topic });
  if (!r.ok) throw new Error(`fixture draft failed for ${slot.id} (${l}): ${r.reason}`); return r.spec;
}
const ctx = (kb, extra = {}) => ({ kb, today: TODAY, langReady: READY, allowedDomains: ['shelterkart.com'], judge: 'off', ...extra });
module.exports = { TODAY, MONDAY, TEXT, LOCAL, READY, langFor, buildKb, goodPost, ctx, topics, markets };
