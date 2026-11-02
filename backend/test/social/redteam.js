'use strict';
/**
 * The red-team set: deliberately bad posts, each tied to the rule that must stop it and the verdict it must get.
 * Group A injects a real lexicon term, in each language that has one, into a good post. Group B breaks the structure of a post in
 * one specific way. Group C hides a forbidden word with the usual tricks. The set grows whenever anything slips through.
 */
const fs = require('fs'), path = require('path');
const S = require('../../social/schedule'), K = require('../../social/kb'), F = require('./fixtures'), M = require('../../social/marketer');
const LEX = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'social', 'data', 'lexicons.json'), 'utf8')).categories;
const RULE = { accusation: ['C5.accusation', 'block'], advice: ['C9.advice', 'block'], score_ranking: ['C8.score_ranking', 'block'], out_of_scope: ['C7.scope', 'block'], fair_housing: ['C10.fair_housing', 'block'],
  safety_claim: ['C9.safety_claim', 'block'], sponsored: ['C1.sponsored', 'block'], sensitive: ['C11.sensitive', 'hold'], clickbait: ['C17.tone', 'hold'], scope_watch: ['C7.scope', 'hold'] };
const clone = o => JSON.parse(JSON.stringify(o));

function build() {
  const kb = F.buildKb(), plan = S.weekPlan(F.MONDAY), out = [];
  const slot = (m, p) => plan.find(s => s.market === m && s.platform === p);
  const base = { LI: F.goodPost(kb, slot('GB', 'LI')), IG: F.goodPost(kb, slot('GB', 'IG')), FB: F.goodPost(kb, slot('GB', 'FB')), X: F.goodPost(kb, slot('GB', 'X')), YT: F.goodPost(kb, slot('GB', 'YT')), HI: F.goodPost(kb, slot('IN', 'IG')) };
  const rotate = ['LI', 'IG', 'FB'];
  const add = (name, rule, verdict, spec, extra = {}) => out.push({ name, rule, verdict, spec, kb: extra.kb || kb, ctx: extra.ctx || {} });
  /* Group A: one real lexicon term, per language, per category */
  let i = 0;
  for (const [cat, langs] of Object.entries(LEX)) {
    const [rule, verdict] = RULE[cat]; if (!rule) continue;
    for (const [lang, terms] of Object.entries(langs)) for (const term of [terms[0], terms[terms.length - 1]].filter((x, k, a) => a.indexOf(x) === k)) {
      const s = clone(base[rotate[i++ % 3]]); s.body += `\n\nNote: ${term}.`; add(`A ${cat}/${lang}: "${term}"`, rule, verdict, s);
    }
  }
  /* Group B: structure and rules, broken one at a time */
  const g = k => clone(base[k || 'IG']);
  const B = (name, rule, verdict, mut, extra) => { const s = g((extra && extra.base) || 'IG'); mut(s); add('B ' + name, rule, verdict, s, extra); };
  B('marked sponsored', 'C1.sponsored', 'block', s => { s.sponsored = true; });
  B('a named-project post in the weekly pack', 'C5.named_party', 'block', s => { s.kind = 'named_project'; });
  B('names a party', 'C5.named_party', 'block', s => { s.namedParties = ['Acme Builders']; });
  B('mentions a protected name', 'C5.named_party', 'block', s => { s.body += '\n\nAsk Acme Builders for the papers.'; }, { ctx: { protectedNames: ['Acme Builders'] } });
  B('no claims', 'S1.structure', 'block', s => { s.claims = []; });
  B('empty body', 'S1.structure', 'block', s => { s.body = '  '; });
  B('unknown platform', 'S1.structure', 'block', s => { s.platform = 'MYSPACE'; });
  B('unknown market', 'S1.structure', 'block', s => { s.market = 'ZZ'; });
  B('no slot', 'S1.structure', 'block', s => { delete s.slot; });
  B('claim with no valid type', 'C2.claims_typed', 'block', s => { s.claims[0].type = 'rumour'; });
  B('a fact with no source', 'C2.claims_typed', 'block', s => { s.claims[0].sourceUrl = ''; });
  B('a fact with no check date', 'C2.claims_typed', 'block', s => { s.claims[0].checkedOn = ''; });
  B('claim is not in the knowledge base', 'C3.kb_trace', 'block', s => { s.claims[0].kbId = 'does.not.exist'; });
  B('claim text altered by one word', 'C3.kb_trace', 'block', s => { s.claims[0].text = s.claims[0].text.replace('public', 'private'); s.body = s.body.replace(/public/, 'private'); });
  B('body does not restate the claim', 'C3.kb_trace', 'block', s => { s.body = s.body.replace(s.claims[0].text, 'Something else entirely.'); });
  B('knowledge item has expired', 'C3.kb_trace', 'block', () => {}, { ctx: { today: '2027-02-01' } });
  B('knowledge item is from another market', 'C3.kb_trace', 'block', s => { s.claims[0].kbId = 'test.IN.t01'; });
  B('claim type differs from the item', 'C3.kb_trace', 'block', s => { s.claims[0].type = 'inference'; });
  B('claim carries another source', 'C3.kb_trace', 'block', s => { s.claims[0].sourceUrl = 'https://other.example.net/x'; });
  B('an invented percentage', 'C3.numbers', 'block', s => { s.body += '\n\nPrices rose 12% last year.'; });
  B('an invented number in Arabic-Indic digits', 'C3.numbers', 'block', s => { s.body += '\n\nرفع ١٢ مرة.'; });
  B('an invented number in Devanagari digits', 'C3.numbers', 'block', s => { s.body += '\n\nकीमत १२ बढ़ी।'; });
  B('an invented number in full-width digits', 'C3.numbers', 'block', s => { s.body += '\n\nUp １２ times.'; });
  B('an invented number in Thai digits', 'C3.numbers', 'block', s => { s.body += '\n\nเพิ่ม ๑๒'; });
  B('an invented number hidden in the title', 'C3.numbers', 'block', s => { s.title = '7 secrets'; });
  B('a wrong chapter number', 'C3.numbers', 'block', s => { s.chapter = 9; });
  B('replaces an earlier post, no correction', 'C4.corrections', 'block', s => { s.supersedes = 'GB-2026-10-23-IG'; });
  B('correction note too short', 'C4.corrections', 'block', s => { s.supersedes = 'x'; s.correction = { note: 'fixed', date: '2026-10-26' }; });
  B('correction with no date', 'C4.corrections', 'block', s => { s.supersedes = 'x'; s.correction = { note: 'The check date was corrected from the earlier post.', date: '' }; });
  B('too many hashtags on Instagram', 'C12.platform', 'hold', s => { s.hashtags = ['#a1', '#b2', '#c3', '#d4', '#e5', '#f6']; });
  B('a malformed hashtag', 'C12.platform', 'hold', s => { s.hashtags = ['#two words']; });
  B('too long for X', 'C12.platform', 'hold', s => { s.body += ' ' + 'long '.repeat(80); }, { base: 'X' });
  B('a link on LinkedIn', 'C12.links', 'hold', s => { s.links = [{ url: 'https://shelterkart.com/', purpose: 'site' }]; s.body += '\n\nhttps://shelterkart.com/'; }, { base: 'LI' });
  B('a link to an unknown domain', 'C12.links', 'block', s => { s.links = [{ url: 'https://bit.ly/abc', purpose: 'site' }]; }, { base: 'FB' });
  B('a link that is not https', 'C12.links', 'block', s => { s.links = [{ url: 'http://shelterkart.com/', purpose: 'site' }]; }, { base: 'FB' });
  B('a link in the text that was not declared', 'C12.links', 'hold', s => { s.body += '\n\nhttps://shelterkart.com/extra'; }, { base: 'FB' });
  B('no media on Instagram', 'C12.media', 'hold', s => { s.media = []; });
  B('an image with no alt text', 'C12.media', 'hold', s => { s.media[0].alt = ''; });
  B('a PNG on Instagram', 'C12.media', 'hold', s => { s.media[0].jpeg = false; });
  B('a still image on a video platform', 'C12.media', 'hold', s => { s.media[0].kind = 'image'; }, { base: 'YT' });
  B('an e-mail address in the text', 'C13.privacy', 'block', s => { s.body += '\n\nWrite to a.buyer@example.com'; });
  B('a phone number in the text', 'C13.privacy', 'block', s => { s.body += '\n\nCall +91 98765 43210 now.'; });
  B('an ID-like number in the text', 'C13.privacy', 'block', s => { s.body += '\n\nID ABCDE1234F'; });
  B('derived from a user\'s paid report', 'C13.privacy', 'block', s => { s.fromUserData = true; });
  B('a language the market does not use', 'C14.language', 'block', s => { s.lang = 'ja'; });
  B('a local-language post with no back-translation', 'C14.backtranslation', 'hold', s => { s.backtranslationEn = ''; }, { base: 'HI' });
  B('a back-translation whose numbers differ', 'C14.backtranslation', 'hold', s => { s.backtranslationEn += ' 7'; }, { base: 'HI' });
  B('a language not yet ready', 'C14.language', 'hold', () => {}, { ctx: { langReady: {} }, base: 'HI' });
  B('a translation that has not been approved', 'C14.language', 'hold', () => {}, { base: 'HI', kb: (() => { const k = F.buildKb(); k.get('test.IN.t01').translations.hi.approvedBy = null; return k; })() });
  B('the disclaimer is missing', 'C18.disclaimer', 'hold', s => { s.body = s.body.replace('Education from public sources, not advice.', ''); s.media[0].text = s.media[0].text.replace('Education from public sources, not advice.', ''); });
  B('AI-made media with no label', 'C20.disclosure', 'hold', s => { s.media[0].synthetic = true; });
  B('off the wheel: the wrong platform for that day', 'C15.schedule', 'block', s => { s.platform = 'TT'; s.slot.platform = 'TT'; s.media[0].kind = 'video'; });
  B('scheduled in the night', 'C15.schedule', 'block', s => { s.slot.scheduledUtc = new Date(S.localToUtcMs(s.slot.localDate, '03:00', s.slot.zone)).toISOString(); });
  B('the slot is on the wrong local day', 'C15.schedule', 'block', s => { s.slot.localDate = S.addDays(s.slot.localDate, 1); });
  B('the market is on a sensitivity hold', 'C15.schedule', 'hold', () => {}, { ctx: { holds: { GB: true } } });
  B('a copy of another market\'s post', 'C16.duplicate', 'hold', () => {}, { ctx: { recent: [{ id: 'IE-copy', market: 'IE', body: base.IG.body }] } });
  B('all capitals', 'C17.tone', 'hold', s => { s.body = s.body.toUpperCase(); });
  B('two emojis', 'C17.tone', 'hold', s => { s.body += ' 🏠🏠'; });
  /* Group C: the usual tricks to hide a forbidden word */
  const hide = [
    ['spaced letters', 'This is a s c a m, avoid it.', 'C5.accusation'], ['dotted letters', 'A s.c.a.m developer.', 'C5.accusation'], ['dashes between letters', 'F-r-a-u-d everywhere.', 'C5.accusation'],
    ['leetspeak', 'Total fr4ud and sc@m.', 'C5.accusation'], ['digits for letters', 'He is a cr00k and a br1b3r.', 'C5.accusation'], ['Cyrillic look-alikes', 'A fr\u0430ud.', 'C5.accusation'], ['Greek look-alike', 'A fr\u03B1ud.', 'C5.accusation'],
    ['an accent', 'A fr\u00E0ud.', 'C5.accusation'], ['a zero-width joiner', 'A fra\u200Dud.', 'C5.accusation'], ['a soft hyphen', 'A fr\u00ADaud.', 'C5.accusation'], ['full-width letters', 'A ＳＣＡＭ.', 'C5.accusation'], ['mixed case', 'A fRaUd.', 'C5.accusation'],
    ['a curly apostrophe in advice', 'Don\u2019t buy this.', 'C9.advice'], ['leet in advice', 'Y0u sh0uld buy now.', 'C9.advice'], ['spaced advice word', 'A g u a r a n t e e d profit.', 'C9.advice'], ['score as symbol', 'Scores 85/100.', 'C8.score_ranking'],
    ['ranking spaced', 'The t o p 10 builders.', 'C8.score_ranking'], ['resale spaced', 'A r e s a l e flat.', 'C7.scope'], ['safety claim leet', 'It is e4rthquake-proof.', 'C9.safety_claim'],
  ];
  for (const [name, text, rule] of hide) { const s = g('FB'); s.body += '\n\n' + text; add('C ' + name, rule, 'block', s); }
  const inTag = g('IG'); inTag.hashtags = ['#scam']; add('C an accusation in a hashtag', 'C5.accusation', 'block', inTag);
  const inCard = g('IG'); inCard.media[0].text += '\nThis is a fraud'; add('C an accusation only on the card', 'C5.accusation', 'block', inCard);
  const inAlt = g('IG'); inAlt.media[0].text += '\nBuy now, guaranteed returns'; add('C advice only on the card', 'C9.advice', 'block', inAlt);
  const inTitle = g('FB'); inTitle.title = 'Developer fraud exposed'; add('C an accusation in the title', 'C5.accusation', 'block', inTitle);
  return out;
}
module.exports = { build };
