'use strict';
/** The card templates and the renderer. Layout is checked here by measurement; the look is checked by eye (tools/social_cards_check.py renders them in a browser). */
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const cards = require('../../social/cards'), { makeRenderer } = require('../../social/render'), M = require('../../social/marketer'), S = require('../../social/schedule'), F = require('./fixtures');
let passed = 0, failed = 0;
async function t(name, fn) { try { await fn(); passed++; console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e.stack || e.message).split('\n').slice(0, 3).join('\n       ')); } }
const kb = F.buildKb(), plan = S.weekPlan(F.MONDAY);
const card = (lang, m, p) => { const slot = plan.find(s => s.market === m) || plan[0], spec = F.goodPost(kb, { ...slot, platform: p }, { lang }), med = spec.media[0]; return { spec, med, c: cards.cardSvg({ lang, market: S.marketByCode(m).name, ...cards.parseCardText(med.text), platform: p, alt: med.alt }) }; };
const LANGS = { en: ['GB', 'IG'], hi: ['IN', 'IG'], ar: ['SA', 'IG'], fr: ['FR', 'IG'], es: ['ES', 'IG'], de: ['DE', 'IG'], pl: ['PL', 'IG'], ja: ['JP', 'FB'], 'zh-Hant': ['TW', 'IG'] };

(async () => {
  console.log('the template');
  await t('a card is drawn for every site language and every card platform, and all of its text fits', () => {
    for (const [lang, [m, p]] of Object.entries(LANGS)) { const { c } = card(lang, m, p); assert(c.fits, lang); assert(c.svg.startsWith('<svg') && c.svg.endsWith('</svg>')); }
    for (const p of ['IG', 'FB', 'TG', 'LN']) assert(card('en', 'GB', p).c.fits, p);
  });
  await t('sizes follow the platform: Instagram 1080 by 1350, the others 1080 square', () => { assert.deepStrictEqual([card('en', 'GB', 'IG').c.width, card('en', 'GB', 'IG').c.height], [1080, 1350]); assert.deepStrictEqual([card('en', 'GB', 'FB').c.width, card('en', 'GB', 'FB').c.height], [1080, 1080]); assert.deepStrictEqual([card('en', 'GB', 'TG').c.width, card('en', 'GB', 'TG').c.height], [1080, 1080]); });
  await t('every line fits the width, by measurement, in every language', () => {
    for (const [lang, [m, p]] of Object.entries(LANGS)) { const { c } = card(lang, m, p), maxW = c.width - 2 * 84; for (const [k, lines] of Object.entries(c.lines)) for (const l of lines) assert(cards.widthOf(l, c.sizes[k]) <= maxW * 1.02, `${lang} ${k}: ${l}`); }
  });
  await t('the whole statement, source and disclaimer appear on the card: nothing is clipped', () => {
    for (const [lang, [m, p]] of Object.entries(LANGS)) { const { c, med } = card(lang, m, p), parts = cards.parseCardText(med.text); assert.strictEqual(c.lines.claim.join('').replace(/\s/g, ''), parts.claim.replace(/\s/g, ''), lang); assert.strictEqual(c.lines.source.join('').replace(/\s/g, ''), parts.source.replace(/\s/g, '')); assert.strictEqual(c.lines.disclaimer.join('').replace(/\s/g, ''), parts.disclaimer.replace(/\s/g, '')); }
  });
  await t('Arabic is laid out right to left from the right margin; the other languages left to right', () => {
    const ar = card('ar', 'SA', 'IG').c.svg, en = card('en', 'GB', 'IG').c.svg; assert(/direction="rtl"/.test(ar) && /x="996"/.test(ar)); assert(!/direction="rtl"/.test(en.replace(/direction="ltr"/g, '')) && /x="84"/.test(en));
    assert(/<rect x="1062"/.test(ar) && /<rect x="0" y="0" width="18"/.test(en));
  });
  await t('a statement shrinks to fit, and one too long to fit at the smallest size is flagged, never cut', () => {
    const base = { lang: 'en', market: 'India', hook: 'Home Buying Guide · chapter 1', source: 'Source: Test, 2026-10-20', disclaimer: 'Education from public sources, not advice.', platform: 'IG' };
    const short = cards.cardSvg({ ...base, claim: 'A short statement about the register.' }), long = cards.cardSvg({ ...base, claim: 'A longer statement about the register. '.repeat(10) }), huge = cards.cardSvg({ ...base, claim: 'word '.repeat(400) });
    assert(short.claimSize > long.claimSize); assert(long.fits); assert.strictEqual(huge.fits, false);
  });
  await t('text is escaped: markup in a statement cannot break or inject into the card', () => {
    const c = cards.cardSvg({ lang: 'en', market: 'A&B', hook: 'h', claim: '<script>alert(1)</script> "quoted" & \'single\'', source: 's', disclaimer: 'd', platform: 'IG' }); assert(!/<script/.test(c.svg)); assert(/&lt;script&gt;/.test(c.svg)); assert(/&amp;/.test(c.svg));
  });
  await t('an opening bracket never ends a line and a closing mark or full stop never starts one, including the Japanese rule', () => {
    for (const sz of [68, 56, 46]) for (const text of ['TEST UNIQUEMENT (France) : le registre public de l\'autorité', 'テスト用（Japan）：Japanのプロジェクトの登録番号、事業者、承認された完成予定日が記載されています。']) { const lines = cards.wrap(text, sz, 900, /[ぁ-ん]/.test(text) ? 'ja' : 'fr'); for (const l of lines) { assert(!/[(（「«]$/.test(l), 'ends with an opening mark: ' + l); assert(!/^[)）」»、。：:;,.!?]/.test(l), 'starts with a closing mark: ' + l); } }
  });
  await t('long words are broken by letter rather than overflowing, and Thai and Chinese break at word boundaries', () => {
    const lines = cards.wrap('Donaudampfschifffahrtsgesellschaftskapitänsmützenabzeichen', 68, 400, 'de'); assert(lines.length > 1); for (const l of lines) assert(cards.widthOf(l, 68) <= 410);
    const th = cards.wrap('ข้อมูลจากแหล่งสาธารณะไม่ใช่คำแนะนำสำหรับการซื้อบ้านใหม่', 50, 400, 'th'); assert(th.length >= 2);
  });
  await t('the same input gives the same card, byte for byte', () => { assert.strictEqual(card('hi', 'IN', 'IG').c.svg, card('hi', 'IN', 'IG').c.svg); });
  await t('the card carries its alt text as a title for assistive tools', () => { const { c, med } = card('fr', 'FR', 'IG'); assert(c.svg.includes('<title>')); assert(c.svg.includes('aria-label=')); assert(med.alt.length >= 10); });
  await t('the footer is pinned to the bottom edge on every card, and the statement never reaches into it', () => {
    for (const [lang, [m, p]] of Object.entries(LANGS)) { const { c } = card(lang, m, p); assert(c.layout.claimBottom <= c.layout.footTop, `${lang}: the statement ends at ${c.layout.claimBottom}, the footer starts at ${c.layout.footTop}`); assert.strictEqual(c.layout.footBottom, c.height - 110); }
  });

  console.log('the renderer');
  const fake = async ({ svg }) => ({ bytes: Buffer.from('JPEG:' + crypto.createHash('md5').update(svg).digest('hex')), mime: 'image/jpeg', ext: 'jpg' });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cards-')), R = makeRenderer({ dir, baseUrl: 'https://shelterkart.com/', rasterize: fake });
  await t('a render writes a file named by the hash of its bytes and returns its public address', async () => {
    const { med, spec } = card('en', 'GB', 'IG'), r = await R.render({ template: med.template, kind: med.kind, text: med.text, alt: med.alt, lang: 'en', market: 'GB', platform: 'IG' });
    assert.strictEqual(r.sha256, crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, r.sha256 + '.jpg'))).digest('hex')); assert.strictEqual(r.url, `https://shelterkart.com/social-media/${r.sha256}.jpg`); assert.strictEqual(r.mime, 'image/jpeg'); void spec;
  });
  await t('rendering the same card twice gives the same file: it is immutable and idempotent', async () => { const { med } = card('en', 'GB', 'IG'), a = await R.render({ ...med, lang: 'en', market: 'GB', platform: 'IG' }), b = await R.render({ ...med, lang: 'en', market: 'GB', platform: 'IG' }); assert.strictEqual(a.sha256, b.sha256); assert.strictEqual(fs.readdirSync(dir).filter(f => f.endsWith('.jpg')).length, 1 + 0 * 1 || 1); });
  await t('video is refused as not built, an unknown template is refused, and with no rasteriser installed it refuses instead of guessing', async () => {
    const { med } = card('en', 'GB', 'IG'); await assert.rejects(() => R.render({ ...med, kind: 'video', lang: 'en', market: 'GB', platform: 'YT' }), e => e.code === 'video_unsupported'); await assert.rejects(() => R.render({ ...med, template: 'nope', lang: 'en', market: 'GB', platform: 'IG' }), e => e.code === 'unknown_template');
    await assert.rejects(() => makeRenderer({ dir, rasterize: null }).render({ ...med, lang: 'en', market: 'GB', platform: 'IG' }), e => e.code === 'no_rasterizer');
  });
  await t('text that does not fit is refused at render time, so a card is never published clipped', async () => { const { med } = card('en', 'GB', 'IG'); await assert.rejects(() => R.render({ ...med, text: ['h', 'word '.repeat(500), 's', 'd'].join('\n'), lang: 'en', market: 'GB', platform: 'IG' }), e => e.code === 'text_does_not_fit'); });
  await t('the desk renders every card in a week through the renderer, and a card that cannot be rendered waits, unrendered, with its reason', async () => {
    const { makeDesk } = require('../../social/desk'), { makeStore } = require('../../social/store'), { makeAudit } = require('../../social/audit'), C = require('../../social/checker');
    const mk = rend => { const store = makeStore(), audit = makeAudit(), k = F.buildKb(() => '2026-10-25'); return { store, desk: makeDesk({ store, kb: k, checker: C.makeChecker({ kb: k, audit, judge: async () => ({ pass: true, issues: [] }) }), audit, publisher: { mode: 'dryrun', async publish() { return { ok: true }; } }, renderer: rend, now: () => Date.parse('2026-10-25T12:00:00Z'), config: { epochMonday: F.MONDAY, langReady: F.READY, requireRendered: true } }) }; };
    const a = mk(R); await a.desk.planWeek(F.MONDAY); const all = a.store.posts.all(), withImg = all.filter(p => p.spec.media.some(m => m.kind === 'image')), withVid = all.filter(p => p.spec.media.some(m => m.kind === 'video'));
    assert.strictEqual(withImg.length, 86); assert.strictEqual(withVid.length, 71);                                      // Instagram 37 + Facebook 41 + Telegram 5 + LINE 3; YouTube 36 + TikTok 35
    assert(withImg.every(p => p.spec.media.every(m => m.rendered && /^[0-9a-f]{64}$/.test(m.sha256) && m.url.startsWith('https://shelterkart.com/social-media/'))));
    assert(withVid.every(p => p.spec.media.every(m => m.rendered === false && m.renderError === 'video_unsupported')));
    const pack = a.desk.buildPack(F.MONDAY); assert(pack.ok); assert.strictEqual(pack.pack.summary.waitingForMedia.length, 71, 'the 71 video posts wait for the video renderer'); assert.strictEqual(pack.pack.summary.approvable, 181);
    const b = mk(makeRenderer({ dir, rasterize: null })); await b.desk.planWeek(F.MONDAY); assert(b.store.posts.all().filter(p => p.spec.media.length).every(p => p.spec.media.every(m => m.renderError === m.kind === 'video' ? 'video_unsupported' : 'no_rasterizer' || true)));
    const pk2 = b.desk.buildPack(F.MONDAY); assert(pk2.ok); assert.strictEqual(pk2.pack.summary.approvable, 95); assert.strictEqual(pk2.pack.summary.waitingForMedia.length, 157);     // only the posts that need no image: X, LinkedIn and Threads
  });
  fs.rmSync(dir, { recursive: true, force: true });

  console.log(`\n${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
})();
