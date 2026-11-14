'use strict';
/** The paid PDF in the delivery e-mail: the three providers, the words, the size rule is in the caller, and what the log never holds. */
const assert = require('assert');
const D = require('../engine/delivery');
let passed = 0, failed = 0;
async function t(name, fn) { try { await fn(); passed++; console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); } }

const stub = () => { const calls = []; const f = async (url, init) => { calls.push({ url, init }); return { ok: true, status: 200, json: async () => ({ id: 'm1', MessageID: 'm1', messageId: 'm1' }) }; }; f.calls = calls; return f; };
const ATT = { filename: 'Hubtown-Limited_2026-11-14_012345.pdf', content: Buffer.from('%PDF-1.4 test').toString('base64'), bytes: 13 };
const BASE = { ref: 'SK-0123456789AB', project: 'Hubtown Celeste', email: 'buyer@example.com', link: 'https://shelterkart.test/r/SK-0123456789AB', pdfLink: 'https://shelterkart.test/r/SK-0123456789AB/pdf' };
const PROVIDERS = {
  resend: { env: { RESEND_API_KEY: 'k', DELIVERY_FROM: 'ShelterKart <no-reply@mail.shelterkart.com>' }, field: b => b.attachments, name: a => a[0].filename, content: a => a[0].content },
  postmark: { env: { POSTMARK_SERVER_TOKEN: 'k', DELIVERY_FROM: 'no-reply@mail.shelterkart.com' }, field: b => b.Attachments, name: a => a[0].Name, content: a => a[0].Content },
  brevo: { env: { BREVO_API_KEY: 'k', DELIVERY_FROM: 'ShelterKart <no-reply@mail.shelterkart.com>' }, field: b => b.attachment, name: a => a[0].name, content: a => a[0].content },
};

(async () => {
  for (const [name, P] of Object.entries(PROVIDERS)) {
    await t(`${name}: the PDF goes with the e-mail under its file name, as base64, and the words say it is attached`, async () => {
      const f = stub(), del = D.createDelivery({ env: P.env, fetchImpl: f, delays: [] });
      const r = del.send({ ...BASE, attachment: ATT }); await r.done;
      assert.deepStrictEqual(r.queued, ['email']); const body = JSON.parse(f.calls[0].init.body), a = P.field(body);
      assert(Array.isArray(a) && a.length === 1); assert.strictEqual(P.name(a), ATT.filename); assert.strictEqual(Buffer.from(P.content(a), 'base64').toString(), '%PDF-1.4 test');
      assert(JSON.stringify(body).includes('The PDF is attached'));
    });
    await t(`${name}: with no attachment the e-mail is as before: the link only, no attachment field, no claim that it is attached`, async () => {
      const f = stub(), del = D.createDelivery({ env: P.env, fetchImpl: f, delays: [] });
      await del.send({ ...BASE }).done; const body = JSON.parse(f.calls[0].init.body);
      assert.strictEqual(P.field(body), undefined); assert(!JSON.stringify(body).includes('is attached')); assert(JSON.stringify(body).includes('/pdf'));
    });
  }
  await t('the delivery log and status never hold the file', async () => {
    const f = stub(), del = D.createDelivery({ env: PROVIDERS.resend.env, fetchImpl: f, delays: [] });
    await del.send({ ...BASE, attachment: ATT }).done;
    assert(!JSON.stringify(del.log).includes(ATT.content)); assert(!JSON.stringify(del.status()).includes(ATT.content)); assert(!JSON.stringify(del.failed()).includes(ATT.content));
  });
  await t('a retry after a failure sends the same attachment again', async () => {
    let n = 0; const calls = []; const f = async (url, init) => { calls.push(init.body); n++; return n === 1 ? { ok: false, status: 500, json: async () => ({}) } : { ok: true, status: 200, json: async () => ({ id: 'm2' }) }; };
    const timers = []; const del = D.createDelivery({ env: PROVIDERS.resend.env, fetchImpl: f, delays: [10], setTimer: fn => timers.push(fn) });
    await del.send({ ...BASE, attachment: ATT }).done; assert.strictEqual(timers.length, 1); await timers[0]();
    assert.strictEqual(calls.length, 2); for (const c of calls) assert.strictEqual(JSON.parse(c).attachments[0].filename, ATT.filename);
  });
  await t('the attachment rule: on by default, off by switch, nothing without a file, link only above the size limit, a file that cannot be read is skipped', async () => {
    const buf = Buffer.from('%PDF-1.4 ' + 'x'.repeat(100)), name = 'A_2026-11-14_012345.pdf';
    const a = await D.pdfAttachment({ buffer: buf }, { env: {}, filename: name }); assert.strictEqual(a.filename, name); assert.strictEqual(Buffer.from(a.content, 'base64').toString(), buf.toString()); assert.strictEqual(a.bytes, buf.length);
    assert.strictEqual(await D.pdfAttachment({ buffer: buf }, { env: { DELIVERY_ATTACH_PDF: 'off' }, filename: name }), null);
    assert.strictEqual(await D.pdfAttachment({ buffer: buf }, { env: { DELIVERY_ATTACH_PDF: 'OFF' }, filename: name }), null);
    assert.strictEqual(await D.pdfAttachment(null, { env: {}, filename: name }), null);
    assert.strictEqual(await D.pdfAttachment({ buffer: buf }, { env: { DELIVERY_ATTACH_MAX_BYTES: String(buf.length - 1) }, filename: name }), null);
    assert((await D.pdfAttachment({ buffer: buf }, { env: { DELIVERY_ATTACH_MAX_BYTES: String(buf.length) }, filename: name })).bytes === buf.length);
    assert.strictEqual(await D.pdfAttachment({ path: '/nope' }, { env: {}, filename: name, readFile: async () => { throw new Error('gone'); } }), null);
    assert((await D.pdfAttachment({ path: '/x' }, { env: {}, filename: name, readFile: async () => buf })).bytes === buf.length);
  });
  await t('the message text names the attachment only when there is one', () => {
    assert(D.messageOf({ project: 'P', link: 'l', pdfLink: 'p', attached: true }).text.includes('The PDF is attached to this e-mail.'));
    assert(!D.messageOf({ project: 'P', link: 'l', pdfLink: 'p' }).text.includes('attached'));
  });
  console.log(`\n${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
})();
