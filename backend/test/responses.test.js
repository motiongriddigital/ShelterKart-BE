'use strict';
/** Respond or correct: the rules (validation, screening, the status flow), with the storage in memory and e-mail captured. */
const assert = require('assert');
const R = require('../engine/responses.js');
let passed = 0, failed = 0;
async function t(name, fn) { try { await fn(); passed++; console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); } }

const BRIEF = { project: { name: 'Sky Villas', developer: 'Example Developers', developer_site: 'https://www.exampledev.test' },
  findings: [{ id: 'F1', claim: 'Possession is marketed as December 2027, but the regulator filing says July 2029.' }, { id: 'F2', claim: 'The seller is registered under a different company name from the brand.' }] };
const REF = 'SK-ABC123456789';
function harness(over = {}) {
  const mails = [], alerts = [];
  const store = R.makeResponseStore(null);
  const svc = R.makeResponses({ store, getBrief: async ref => (ref === REF ? BRIEF : null), sendMail: async m => { mails.push(m); return !over.mailFails; },
    alert: async (s, x) => { alerts.push({ s, x }); }, siteBase: () => 'https://shelterkart.test', refOk: r => /^SK-[A-Z0-9]{8,}$/.test(r), ...over });
  const tokenOf = () => (mails[mails.length - 1].text.match(/sk_respond_confirm=([0-9a-f]+)/) || [])[1];
  return { svc, store, mails, alerts, tokenOf };
}
const reply = (o = {}) => ({ reportRef: REF, role: 'developer', kind: 'reply', findingId: 'F1', body: 'The July 2029 date is the regulator\u2019s outer limit. Handover is planned for December 2027 and the filing is being updated.', email: 'pr@exampledev.test', ...o });

(async () => {
  console.log('validation');
  await t('who you are decides what you can do: a developer cannot ask for removal of personal data; a reader cannot reply', () => {
    assert.strictEqual(R.validate({ ...reply(), role: 'developer', kind: 'privacy' }).ok, false);
    assert.strictEqual(R.validate({ ...reply(), role: 'reader', kind: 'reply' }).ok, false);
    assert.strictEqual(R.validate({ ...reply() }).ok, true);
    assert.strictEqual(R.validate({ ...reply(), role: 'visitor' }).ok, false);
  });
  await t('a change needs evidence: an error, a missing fact, a grade dispute or a supplied fact without a link is refused', () => {
    for (const [role, kind] of [['reader', 'error'], ['reader', 'missing'], ['reader', 'grade'], ['reader', 'outdated'], ['developer', 'supply']]) {
      const base = { ...reply(), role, kind, findingId: kind === 'supply' ? 'F1' : '' };   // a supplied fact is shown beside a finding, so it names one
      assert.strictEqual(R.validate(base).ok, false, kind + ' without evidence');
      assert.strictEqual(R.validate({ ...base, evidenceUrls: ['https://www.rera.gov.in/p/1'] }).ok, true, kind + ' with evidence');
    }
  });
  await t('evidence links must be real web addresses: no scripts, no credentials, no bare words', () => {
    for (const bad of ['javascript:alert(1)', 'ftp://x.test/a', 'https://user:pw@x.test/a', 'not a link', 'https://localhost/a']) assert.strictEqual(R.validate({ ...reply(), role: 'reader', kind: 'error', evidenceUrls: [bad] }).ok, false, bad);
  });
  await t('a reply must say which finding; the message has a minimum and a maximum; the e-mail must be valid', () => {
    assert.strictEqual(R.validate({ ...reply(), findingId: '', findingText: '' }).ok, false);
    assert.strictEqual(R.validate({ ...reply(), body: 'too short' }).ok, false);
    assert.strictEqual(R.validate({ ...reply(), body: 'x'.repeat(2001) }).ok, false);
    assert.strictEqual(R.validate({ ...reply(), email: 'nobody' }).ok, false);
    assert.strictEqual(R.validate({ ...reply(), reportRef: 'nope' }, r => /^SK-/.test(r)).ok, false);
  });

  console.log('screening');
  await t('a plain, factual reply is clean', () => assert.deepStrictEqual(R.screen({ kind: 'reply', body: reply().body }), []));
  await t('personal data, accusations, pressure, threats, abuse, shouting and spam are each caught', () => {
    const has = (body, reason, kind = 'reply') => assert(R.screen({ kind, body }).includes(reason), reason + ' in: ' + body);
    has('Please call me on +91 98200 12345 to discuss this finding properly.', 'personal_data');
    has('Write to the buyer at someone@example.com about this matter please.', 'personal_data');
    has('Their PAN is ABCDE1234F and they are the real problem here honestly.', 'personal_data');
    has('The reviewer who wrote this is a fraud and everyone knows it.', 'accusation');
    has('Remove this finding or we will sue you for defamation immediately.', 'pressure_or_legal');
    has('We will pay a fee to remove the finding from the report today.', 'pressure_or_legal');
    has('I will find you and you will regret writing this report ever.', 'threat', 'error');
    has('This report is full of lies and the author is an asshole honestly.', 'abuse', 'error');
    has('THIS IS COMPLETELY WRONG AND YOU MUST CHANGE IT RIGHT NOW PLEASE', 'shouting', 'error');
    has('aaaaaaaaaaaaaaaaaaaa this is a long message of nonsense characters', 'spam', 'error');
  });
  await t('what is not published is only screened for threats, abuse and spam: an error report may name a fraud case', () => {
    assert.deepStrictEqual(R.screen({ kind: 'error', body: 'The fraud case in the report is wrong: the order was set aside in 2025, see the link.' }), []);
  });

  console.log('finding match');
  await t('a reply is matched to its finding by id or by quoted text, on a live brief or a reference report', () => {
    assert.strictEqual(R.matchFinding(BRIEF, 'F2', '').id, 'F2');
    assert.strictEqual(R.matchFinding(BRIEF, '', 'seller is registered under a different company name').id, 'F2');
    assert.strictEqual(R.matchFinding(BRIEF, 'F9', 'something unrelated that matches nothing here at all'), null);
    const dossier = { sections: [{ facts: [{ id: 'F7', claim: 'The completion date is later than marketed.' }] }] };
    assert.strictEqual(R.matchFinding(dossier, 'F7', '').claim, 'The completion date is later than marketed.');
  });

  console.log('the flow');
  await t('submit, confirm by e-mail, and a clean reply is published beside its finding, with no e-mail address in public', async () => {
    const h = harness(); const r = await h.svc.submit(reply());
    assert(r.ok && /^SKR-[A-Z0-9]{8}$/.test(r.publicRef) && r.statusKey, 'submitted');
    assert.strictEqual(h.mails.length, 1); assert(/confirm/i.test(h.mails[0].subject) && h.mails[0].to === 'pr@exampledev.test');
    assert.deepStrictEqual((await h.svc.publicFor(REF)).counts, { replies: 0, corrections: 0 }, 'nothing public before the e-mail is confirmed');
    const c = await h.svc.confirm(h.tokenOf()); assert.strictEqual(c.state, 'published');
    const pub = await h.svc.publicFor(REF); assert.strictEqual(pub.counts.replies, 1);
    assert.strictEqual(pub.replies[0].findingId, 'F1'); assert.strictEqual(pub.replies[0].verified, true, 'the sender is on the developer\u2019s own domain');
    assert(!JSON.stringify(pub).includes('exampledev.test'), 'no e-mail address in the public data');
  });
  await t('a reply sent from the developer\u2019s own domain is labelled verified; from anywhere else it is published as not verified', async () => {
    const h = harness(); await h.svc.submit(reply({ email: 'legal@sales.exampledev.test' })); await h.svc.confirm(h.tokenOf());
    assert.strictEqual((await h.svc.publicFor(REF)).replies[0].verified, true);
    const g = harness(); await g.svc.submit(reply({ email: 'someone@gmail.com' })); await g.svc.confirm(g.tokenOf());
    assert.strictEqual((await g.svc.publicFor(REF)).replies[0].verified, false);
    const rd = harness(); await rd.svc.submit(reply({ role: 'reader', kind: 'error', findingId: '', evidenceUrls: ['https://www.rera.gov.in/p/1'], email: 'x@exampledev.test' })); await rd.svc.confirm(rd.tokenOf());
    assert.strictEqual((await rd.store.list('in_review'))[0].verification, 'unverified', 'a reader is never verified');
  });
  await t('a flagged reply is held, a person is alerted, nothing is public, and approving it publishes it', async () => {
    const h = harness(); await h.svc.submit(reply({ body: 'The report names a fraud that never happened and the reviewer should be ashamed of it.' }));
    assert.strictEqual((await h.svc.confirm(h.tokenOf())).state, 'held'); assert.strictEqual(h.alerts.length, 1);
    assert.strictEqual((await h.svc.publicFor(REF)).counts.replies, 0);
    const [row] = await h.svc.list('held'); assert(row.screen_reasons.includes('accusation'));
    assert.strictEqual((await h.svc.resolve(row.id, { outcome: 'published' })).ok, true);
    assert.strictEqual((await h.svc.publicFor(REF)).counts.replies, 1);
  });
  await t('a reply that matches no finding is held, not published', async () => {
    const h = harness(); await h.svc.submit(reply({ findingId: 'F99', findingText: 'A statement that is nowhere in this report at all, honestly.' }));
    assert.strictEqual((await h.svc.confirm(h.tokenOf())).state, 'held'); assert((await h.svc.list('held'))[0].screen_reasons.includes('finding_not_found'));
  });
  await t('a correction waits for the research check, is never published as submitted, and becomes public only when resolved as corrected with a note', async () => {
    const h = harness(); await h.svc.watch(REF, 'buyer@example.com'); await h.svc.watch(REF, 'second@example.com'); await h.svc.watch(REF, 'not an email');
    await h.svc.submit({ reportRef: REF, role: 'reader', kind: 'error', findingId: 'F1', body: 'The filing was updated on 2 October 2026 and now shows December 2027.', evidenceUrls: ['https://www.rera.gov.in/p/1'], email: 'reader@example.com' });
    assert.strictEqual((await h.svc.confirm(h.tokenOf())).state, 'in_review'); assert.strictEqual((await h.svc.publicFor(REF)).counts.corrections, 0);
    const [row] = await h.svc.list('in_review');
    assert.strictEqual((await h.svc.resolve(row.id, { outcome: 'corrected', note: 'short' })).ok, false, 'a correction needs a real note');
    const before = h.mails.length, r = await h.svc.resolve(row.id, { outcome: 'corrected', note: 'The completion date now reads December 2027, from the regulator\u2019s filing of 2 October 2026.' });
    assert(r.ok && r.notified === 2, 'both buyers told');
    const pub = await h.svc.publicFor(REF); assert.strictEqual(pub.counts.corrections, 1); assert(/December 2027/.test(pub.corrections[0].note));
    assert(h.mails.slice(before).some(m => m.to === 'buyer@example.com' && /corrected/i.test(m.subject)) && h.mails.slice(before).some(m => m.to === 'reader@example.com'));
    assert.strictEqual((await h.svc.resolve(row.id, { outcome: 'declined', note: 'x' })).status, 409, 'resolved once');
  });
  await t('a correction that is not made is explained to the sender, and stays out of the public list', async () => {
    const h = harness(); await h.svc.submit({ reportRef: REF, role: 'reader', kind: 'grade', findingId: 'F2', body: 'This should be marked as confirmed, not as a single source finding.', evidenceUrls: ['https://example.com/a'], email: 'r@example.com' });
    await h.svc.confirm(h.tokenOf()); const [row] = await h.svc.list('in_review');
    assert.strictEqual((await h.svc.resolve(row.id, { outcome: 'not_changed' })).ok, false, 'a reason is required');
    assert.strictEqual((await h.svc.resolve(row.id, { outcome: 'not_changed', note: 'The source cited is a news article, not the regulator, so the mark stands.' })).ok, true);
    assert.strictEqual((await h.svc.publicFor(REF)).counts.corrections, 0); assert(/mark stands/.test(h.mails[h.mails.length - 1].text));
  });
  await t('privacy requests and legal notices always go to a person, never to publication', async () => {
    for (const kind of ['privacy', 'legal']) { const h = harness(); await h.svc.submit({ reportRef: REF, role: 'named', kind, body: 'I am named in this report and ask that my details are removed from it.', email: 'p@example.com' });
      assert.strictEqual((await h.svc.confirm(h.tokenOf())).state, 'held'); assert((await h.svc.list('held'))[0].screen_reasons.includes('needs_a_person')); assert.strictEqual(h.alerts.length, 1); }
  });
  await t('only a reply can be published, and only an evidence-backed kind can be corrected', async () => {
    const h = harness(); await h.svc.submit({ reportRef: REF, role: 'named', kind: 'legal', body: 'This is a legal notice about a statement in the report, for your attention.', email: 'l@example.com' });
    await h.svc.confirm(h.tokenOf()); const [row] = await h.svc.list('held');
    assert.strictEqual((await h.svc.resolve(row.id, { outcome: 'published' })).ok, false); assert.strictEqual((await h.svc.resolve(row.id, { outcome: 'corrected', note: 'A long enough note for a correction.' })).ok, false);
  });

  console.log('confirmation, status and abuse');
  await t('a wrong, malformed or reused confirmation link does nothing harmful; confirming twice is safe', async () => {
    const h = harness(); await h.svc.submit(reply());
    for (const bad of ['', 'zzzz', 'a'.repeat(48), null]) assert.strictEqual((await h.svc.confirm(bad)).ok, false);
    const tok = h.tokenOf(); assert.strictEqual((await h.svc.confirm(tok)).state, 'published'); const again = await h.svc.confirm(tok);
    assert(again.ok && again.already && again.state === 'published'); assert.strictEqual((await h.svc.publicFor(REF)).counts.replies, 1);
  });
  await t('the status page needs the reference AND its key; a wrong key looks the same as no such response', async () => {
    const h = harness(); const r = await h.svc.submit(reply());
    const ok = await h.svc.statusOf(r.publicRef, r.statusKey); assert(ok.ok && ok.state === 'awaiting_confirmation');
    for (const [ref, key] of [[r.publicRef, 'wrong'], [r.publicRef, ''], ['SKR-ZZZZZZZZ', r.statusKey], ['junk', r.statusKey]]) assert.strictEqual((await h.svc.statusOf(ref, key)).status, 404);
  });
  await t('a sixth submission from one address in a day is refused', async () => {
    const h = harness(); for (let i = 0; i < 5; i++) assert((await h.svc.submit(reply())).ok);
    const r = await h.svc.submit(reply()); assert.strictEqual(r.status, 429);
  });
  await t('a report that does not exist is refused; the honeypot is accepted silently and stores nothing', async () => {
    const h = harness(); assert.strictEqual((await h.svc.submit(reply({ reportRef: 'SK-ZZZZZZZZZZZZ' }))).status, 404);
    const bot = await h.svc.submit(reply({ website: 'http://spam.test' })); assert(bot.ok && bot.silent); assert.strictEqual(h.mails.length, 0); assert.strictEqual((await h.store.list('awaiting_confirmation')).length, 0);
  });
  await t('if the confirmation e-mail cannot be sent, the sender is told, the response is declined, and a person is alerted', async () => {
    const h = harness({ mailFails: true }); const r = await h.svc.submit(reply());
    assert(!r.ok && r.status === 503); assert.strictEqual(h.alerts.length, 1); assert.strictEqual((await h.store.list('awaiting_confirmation')).length, 0);
  });
  await t('an AI classifier can be added at one place: when it flags a message, the message is held', async () => {
    const h = harness({ classify: async () => ({ flag: true, reasons: ['defamation_risk'] }) }); await h.svc.submit(reply()); assert.strictEqual((await h.svc.confirm(h.tokenOf())).state, 'held');
    const g = harness({ classify: async () => { throw new Error('down'); } }); await g.svc.submit(reply()); assert.strictEqual((await g.svc.confirm(g.tokenOf())).state, 'held', 'when in doubt, hold');
  });

  console.log(`\n${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
})();
