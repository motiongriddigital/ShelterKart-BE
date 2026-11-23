'use strict';
/** Plain text from strangers (B8): tags and comments go, signs and ordinary words stay. */
const assert = require('assert');
const { stripMarkup, oneLine } = require('../lib/plainText');
let passed = 0, failed = 0;
async function t(name, fn) { try { await fn(); passed++; console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); } }

(async () => {
  await t('tags, comments and unfinished tags are removed', () => {
    assert.strictEqual(stripMarkup('QA <img src=x onerror=alert(1)>'), 'QA ');
    assert.strictEqual(stripMarkup('a<script>alert(1)</script>b'), 'aalert(1)b');
    assert.strictEqual(stripMarkup('x<!-- hidden -->y'), 'xy');
    assert.strictEqual(stripMarkup('open <img src=x onerror=alert(1)'), 'open ');
    assert.strictEqual(stripMarkup('<?xml version="1.0"?>text'), 'text');
  });
  await t('tags built from pieces are removed too', () => {
    for (const evil of ['<scr<script>ipt>alert(1)</scr</script>ipt>', '<<b>img src=x onerror=alert(1)>', '<img/src=x onerror=alert(1)//']) assert(!/<[a-zA-Z/!?]/.test(stripMarkup(evil)), evil + ' -> ' + stripMarkup(evil));
    assert.strictEqual(stripMarkup('<<b>script>x'), 'x');
  });
  await t('a sign, a number and an ordinary sentence are left alone', () => {
    for (const ok of ['price < 5 lakh and > 3 lakh', '5 < 6', 'AT&T and "quotes"', 'a <3 b', 'Ravi Kumar', 'x -> y', 'हिन्दी नाम', '<']) assert.strictEqual(stripMarkup(ok), ok, ok);
  });
  await t('oneLine makes a single clean line', () => {
    assert.strictEqual(oneLine('  Ravi\r\nKumar\t<b>Rao</b>\u0000 '), 'Ravi Kumar Rao');
    assert.strictEqual(oneLine(null), '');
  });
  console.log(`\n${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
})();
