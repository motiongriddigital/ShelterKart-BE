'use strict';
const assert = require('assert');
const D = require('../engine/delivery');
let passed = 0, failed = 0;
async function t(name, fn) { try { await fn(); passed++; console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); } }

const stub = (status = 201, body = { messageId: '<abc@smtp-relay.brevo.com>' }) => { const calls = []; const f = async (url, init) => { calls.push({ url, init }); return { ok: status < 400, status, json: async () => body }; }; f.calls = calls; return f; };
const ENV = { BREVO_API_KEY: 'brevo-key', DELIVERY_FROM: 'ShelterKart <no-reply@mail.shelterkart.com>' };

(async () => {
  await t('Brevo is configured by its key and the sender address', async () => {
    assert.strictEqual(D.emailProvider(ENV), 'brevo');
    assert.strictEqual(D.emailProvider({ BREVO_API_KEY: 'k' }), null);
    assert.strictEqual(D.emailProvider({ DELIVERY_FROM: 'a@b.co' }), null);
  });
  await t('the named provider wins when several are configured, otherwise the first configured', async () => {
    const both = { ...ENV, RESEND_API_KEY: 'r' };
    assert.strictEqual(D.emailProvider({ ...both, DELIVERY_EMAIL_PROVIDER: 'brevo' }), 'brevo');
    assert.strictEqual(D.emailProvider({ ...both, DELIVERY_EMAIL_PROVIDER: 'resend' }), 'resend');
    assert.strictEqual(D.emailProvider(both), 'resend');
    assert.strictEqual(D.emailProvider({ ...ENV, DELIVERY_EMAIL_PROVIDER: 'brevo', BREVO_API_KEY: '' }), null);
  });
  await t('sendEmail posts the Brevo transactional shape with the api-key header', async () => {
    const f = stub();
    const ok = await D.sendEmail(ENV, { to: 'buyer@example.com', subject: 'Hello', text: 'Plain <b>body</b>' }, f);
    assert.strictEqual(ok, true);
    const { url, init } = f.calls[0], body = JSON.parse(init.body);
    assert.strictEqual(url, 'https://api.brevo.com/v3/smtp/email');
    assert.strictEqual(init.method, 'POST');
    assert.strictEqual(init.headers['api-key'], 'brevo-key');
    assert.strictEqual(init.headers['Content-Type'], 'application/json');
    assert.deepStrictEqual(body.sender, { name: 'ShelterKart', email: 'no-reply@mail.shelterkart.com' });
    assert.deepStrictEqual(body.to, [{ email: 'buyer@example.com' }]);
    assert.strictEqual(body.subject, 'Hello');
    assert.strictEqual(body.textContent, 'Plain <b>body</b>');
    assert.ok(body.htmlContent.includes('&lt;b&gt;'));
  });
  await t('a bare sender address has no name', async () => {
    const f = stub();
    await D.sendEmail({ BREVO_API_KEY: 'k', DELIVERY_FROM: 'no-reply@mail.shelterkart.com' }, { to: 'a@b.co', subject: 's', text: 't' }, f);
    assert.deepStrictEqual(JSON.parse(f.calls[0].init.body).sender, { email: 'no-reply@mail.shelterkart.com' });
  });
  await t('a provider refusal is not a send, and never throws or leaks the key', async () => {
    const f = stub(401, { code: 'unauthorized' });
    const logged = []; const orig = console.error; console.error = (...a) => logged.push(a.join(' '));
    let ok; try { ok = await D.sendEmail(ENV, { to: 'a@b.co', subject: 's', text: 't' }, f); } finally { console.error = orig; }
    assert.strictEqual(ok, false);
    assert.ok(logged.some(l => l.includes('Brevo answered 401')));
    assert.ok(!logged.join(' ').includes('brevo-key'));
  });
  await t('report delivery uses Brevo and records the message id', async () => {
    const f = stub();
    const del = D.createDelivery({ env: ENV, fetchImpl: f, delays: [] });
    const r = del.send({ ref: 'SK-1', project: 'Creek Bay', email: 'buyer@example.com', link: 'https://x/r/SK-1' });
    assert.deepStrictEqual(r.queued, ['email']);
    await r.done;
    assert.strictEqual(del.log.at(-1).ok, true);
    assert.strictEqual(del.log.at(-1).id, '<abc@smtp-relay.brevo.com>');
    assert.strictEqual(del.status().email, 'brevo');
  });
  console.log(`\n${passed} passed, ${failed} failed`); process.exitCode = failed ? 1 : 0;
})();
