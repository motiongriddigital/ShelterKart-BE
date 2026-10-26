'use strict';
/**
 * Source tiers and the traceability guards (constitution rules 2, 3 and 5).
 * The official and social rules live in data/source-tiers.json; these checks make sure the file is valid, that the
 * classification it drives is the one we reviewed, and that engagement numbers (views, likes, shares) can never change a mark.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const G = require('../engine/grounding.js');
const tiers = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'source-tiers.json'), 'utf8'));
let passed = 0, failed = 0;
function t(name, fn) { try { fn(); passed++; console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); } }

t('the tiers file is valid: its patterns compile, and its host list has no duplicates', () => {
  new RegExp(tiers.official.suffixPattern); new RegExp(tiers.social.pattern);
  assert.strictEqual(new Set(tiers.official.hosts).size, tiers.official.hosts.length, 'a host is listed twice');
  assert(tiers.official.reason && tiers.social.reason, 'each tier states its reason');
});

const SAMPLE = {
  'https://www.rera.gov.in/x': true, 'https://maharera.mahaonline.gov.in/p': true, 'https://data.gov.sg/d': true,
  'https://nseindia.com/q': true, 'https://dfm.ae/q': true,
  'https://housing.com/p': false, 'https://magicbricks.com/p': false, 'https://trustpilot.com/p': false,
  'https://hubtown.co.in/p': false, 'https://some-blog.com/p': false,
};
t('official sites are classified as they were reviewed (the sample of real addresses)', () => {
  for (const [u, expected] of Object.entries(SAMPLE)) assert.strictEqual(G.isOfficial(u), expected, u);
});

// KNOWN GAP (recorded, not changed): once "www." is removed, a bare government root such as gov.uk or gob.es does not match the
// official rule, so the UK government's main domain and Spain's gob.es are not marked official. Fixing it changes existing marks,
// and marks feed the price tier, so it is a method change to be approved and published first. When it is fixed, flip these to true.
t('KNOWN GAP: bare government roots are not yet official (gov.uk, gob.es), pending a method decision', () => {
  assert.strictEqual(G.isOfficial('https://www.gov.uk/x'), false, 'current behaviour, recorded');
  assert.strictEqual(G.isOfficial('https://www.gob.es/x'), false, 'current behaviour, recorded');
});

t('social platforms are a social tier, and nothing else is', () => {
  const soc = new RegExp(tiers.social.pattern);
  for (const h of ['www.youtube.com', 'x.com', 'twitter.com', 'instagram.com', 'reddit.com', 'threads.net']) assert(soc.test(h), h);
  for (const h of ['housing.com', 'youtube.co.example', 'rera.gov.in']) assert(!soc.test(h), h);
});

t('engagement never changes a mark: views, likes, shares and comments are ignored', () => {
  const base = { urls: ['https://housing.com/a', 'https://magicbricks.com/b'], claim: 'Possession is delayed', kind: 'fact' };
  const loud = { ...base, views: 9e6, likes: 4e5, shares: 1e5, comments: 9e4, followers: 2e6 };
  const a = G.markFinding(base, 'Celeste', 'Hubtown'), b = G.markFinding(loud, 'Celeste', 'Hubtown');
  assert.strictEqual(a.mark, b.mark, 'the mark must not depend on engagement');
  assert.strictEqual(a.sites, b.sites);
});

t('a finding sourced from social platforms carries the note that it is what people say', () => {
  const m = G.markFinding({ urls: ['https://www.youtube.com/watch?v=1', 'https://www.reddit.com/r/x/1'], claim: 'Water leaks', kind: 'fact' }, 'Celeste', 'Hubtown');
  assert(/individual views/.test(m.note), 'the social note is shown');
});

// KNOWN GAP (recorded, not changed): two social sites are counted as two sites, so they can reach the 'reported' mark.
// A stricter rule (social sites never count towards 'reported') lowers some marks and so the price tier. It needs approval first.
t('KNOWN GAP: two social sites are counted as two sites (mark reported), pending a method decision', () => {
  const m = G.markFinding({ urls: ['https://www.youtube.com/watch?v=1', 'https://www.reddit.com/r/x/1'], claim: 'Water leaks', kind: 'fact' }, 'Celeste', 'Hubtown');
  assert.strictEqual(m.mark, 'reported', 'current behaviour, recorded');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
