'use strict';
const assert = require('assert');
const D = require('../engine/dossier');
const G = require('../engine/grounding');
let passed = 0, failed = 0;
async function t(name, fn) { try { await fn(); passed++; console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); } }

const REAL = ['https://ecourts.gov.in/x', 'https://www.mca.gov.in/', 'https://find-and-update.company-information.service.gov.uk/company/1', 'https://www.sec.gov/edgar', 'https://www.acra.gov.sg/', 'https://www.dubailand.gov.ae/', 'https://eservices.mca.gov.in/', 'https://www.rera.gov.in/', 'https://data.gov.sg/'];
const FAKE = ['https://evil.gov.xyz/register', 'https://x.gov.top/case', 'https://a.gov.ws/page', 'https://registry.gov.cc/', 'https://gov.zz.example.com/', 'https://notgov.com/', 'https://gov.in.evil.com/'];

(async () => {
  await t('genuine government hosts still count as official in the dossier and in grounding', async () => {
    for (const u of REAL) { assert.ok(D.isOfficial(u), 'dossier ' + u); assert.ok(G.isOfficial(u), 'grounding ' + u); }
  });
  await t('look-alike hosts under open registration suffixes are not official', async () => {
    for (const u of FAKE) { assert.ok(!D.isOfficial(u), 'dossier ' + u); assert.ok(!G.isOfficial(u), 'grounding ' + u); }
  });
  console.log(`\n${passed} passed, ${failed} failed`); process.exitCode = failed ? 1 : 0;
})();
