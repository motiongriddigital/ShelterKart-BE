'use strict';
/** The Wave 1 seed file: every address is https, every market and topic exists, and every host is official by the research code's own test or is explicitly listed for a person to approve. */
const assert = require('assert'), path = require('path'), fs = require('fs');
const S = require('../../social/schedule'), M = require('../../social/marketer'), G = require('../../engine/grounding');
const doc = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'social', 'data', 'seeds-wave1.json'), 'utf8'));
let passed = 0, failed = 0; const t = (n, f) => { try { f(); passed++; console.log('  ok   ' + n); } catch (e) { failed++; console.log('  FAIL ' + n + '\n       ' + e.message); } };
const codes = new Set(S.WHEEL.markets.map(m => m.code)), topics = new Set(M.CURRICULUM.topics.map(x => x.id)), host = u => new URL(u).hostname.toLowerCase().replace(/^www\./, '');
t('twenty-nine markets are seeded (twelve of Wave 1, eight of Wave 2 and Brazil, Italy, the Netherlands, Portugal, Estonia, Finland, Sweden, Denmark and Norway from Wave 3), all real market codes, each with a stated scope where the research covers one place only', () => { assert.strictEqual(Object.keys(doc.markets).length, 29); for (const [m, v] of Object.entries(doc.markets)) assert(codes.has(m), m); for (const m of ['AE', 'CA', 'AU', 'IE', 'US', 'DE', 'FR', 'ES', 'JP', 'PL', 'MX', 'CH', 'SA', 'BR', 'IT', 'NL', 'PT', 'EE', 'FI', 'SE', 'DK', 'NO']) assert(doc.markets[m].scope, m + ' needs its scope'); });
t('every topic exists, every list has one to five addresses, every address is https', () => { for (const [m, v] of Object.entries(doc.markets)) for (const [tp, urls] of Object.entries(v.topics)) { assert(topics.has(tp), m + ' ' + tp); assert(urls.length >= 1 && urls.length <= 5); for (const u of urls) assert(/^https:\/\//.test(u), u); } });
t('every host passes the research code\u2019s official test, or is listed for that market as a host a person must approve', () => {
  for (const [m, v] of Object.entries(doc.markets)) for (const urls of Object.values(v.topics)) for (const u of urls) { const ok = G.isOfficial(u) || (v.allowedHosts || []).some(h => host(u) === h || host(u).endsWith('.' + h)); assert(ok, `${m}: ${host(u)} is neither official nor listed`); }
});
t('exactly the eighteen hosts the official test does not match are listed for approval, and nothing else is', () => { const listed = Object.entries(doc.markets).filter(([, v]) => (v.allowedHosts || []).length).map(([m, v]) => m + ':' + v.allowedHosts.join(',')).sort(); assert.deepStrictEqual(listed, ['CA:tarion.com', 'CH:parlament.ch,bj.admin.ch', 'DE:gesetze-im-internet.de', 'DK:svendborg.dk', 'EE:riigiteataja.ee', 'ES:defensordelpueblo.es', 'FI:kkv.fi', 'GB:consumercode.co.uk', 'IE:localgov.ie', 'IT:consap.it', 'JP:pref.chiba.lg.jp', 'NL:iplo.nl', 'NO:stortinget.no,regjeringen.no', 'PT:aiccopn.pt', 'SE:boverket.se', 'ZA:nhbrc.org.za']); });
t('the loader sends nothing unless told to, and never sends hosts unless asked', () => {
  const { execFileSync } = require('child_process'), out = execFileSync('node', [path.join(__dirname, '..', '..', '..', 'tools', 'social_seed.js')]).toString(); assert(/would be sent/.test(out)); assert(/need a person to approve/.test(out));
});
const hostsDoc = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'social', 'data', 'official-hosts.json'), 'utf8')), { buildJobs } = require('../../../tools/social_seed');
t('every host a seed asks to allow is in the reviewed list, for the same market, with what it is and a recommendation', () => {
  for (const [m, v] of Object.entries(doc.markets)) for (const h of v.allowedHosts || []) { const e = hostsDoc.hosts.find(x => x.market === m && x.host === h); assert(e, `${m}:${h} is not in official-hosts.json`); assert(e.name && e.what && e.recommendation && e.recommendation_class, `${m}:${h} needs a name, a description and a recommendation`); assert(['approve', 'approve_with_care', 'decide'].includes(e.recommendation_class)); }
  for (const e of hostsDoc.hosts) assert((doc.markets[e.market].allowedHosts || []).includes(e.host), `${e.market}:${e.host} is in the reviewed list but no seed asks for it`);
});
t('nothing is approved in the shipped list: approving a host as official is a person\u2019s decision, not the code\u2019s', () => { assert(hostsDoc.hosts.length >= 9); assert(hostsDoc.hosts.every(h => h.approved === false), 'a host is pre-approved'); });
t('the loader sends no allowed host unless a person approved it, even when asked to, and sends only the approved ones', () => {
  let r = buildJobs(doc, hostsDoc, { allowHosts: true }); assert(!r.jobs.some(j => j.allowedHosts), 'an unapproved host was sent'); assert.strictEqual(r.pendingHosts.length, hostsDoc.hosts.length); assert.strictEqual(r.jobs.length, Object.values(doc.markets).reduce((n, v) => n + Object.keys(v.topics).length, 0));
  const one = JSON.parse(JSON.stringify(hostsDoc)); one.hosts.find(h => h.market === 'ZA').approved = true; r = buildJobs(doc, one, { allowHosts: true }); const sent = r.jobs.filter(j => j.allowedHosts); assert.deepStrictEqual(sent, [{ market: 'ZA', allowedHosts: ['nhbrc.org.za'] }]); assert.strictEqual(r.pendingHosts.length, hostsDoc.hosts.length - 1);
  r = buildJobs(doc, one, { allowHosts: false }); assert(!r.jobs.some(j => j.allowedHosts), 'hosts were sent without --allow-hosts');
  const bad = JSON.parse(JSON.stringify(hostsDoc)); bad.hosts = bad.hosts.filter(h => h.host !== 'nhbrc.org.za'); bad.hosts.forEach(h => { h.approved = true; }); r = buildJobs(doc, bad, { allowHosts: true }); assert(!r.jobs.some(j => j.market === 'ZA' && j.allowedHosts), 'a host missing from the reviewed list was sent'); assert(r.pendingHosts.some(x => /ZA:nhbrc.org.za/.test(x)));
});
t('the first-run checklist only names a market and topic that has a seed, and never names a market with no seed (Belgium, Malaysia, Taiwan, Latvia, Thailand, the Czech Republic, Lithuania)', () => {
  const md = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'docs', 'KEEPER_FIRST_RUN.md'), 'utf8'), table = md.slice(md.indexOf('## 2.'), md.indexOf('Hosts that must be approved first')), pairs = [...table.matchAll(/\b([A-Z]{2}) (t\d\d)\b/g)].map(m => [m[1], m[2]]);
  assert(pairs.length >= 15, 'the run order should name at least 15 market-topic pairs'); for (const [m, tp] of pairs) assert(doc.markets[m] && doc.markets[m].topics[tp], `${m} ${tp} is in the checklist but has no seed`);
  assert(!pairs.some(([m]) => ['BE', 'MY', 'TW', 'LV', 'TH', 'CZ', 'LT'].includes(m)), 'a market with no seed is in the run order');
});
t('any focus words are well formed: they belong to an address the market already lists, at most 8 per address, each a short string', () => {
  for (const [m, v] of Object.entries(doc.markets)) for (const [u, terms] of Object.entries(v.focus || {})) { assert(Object.values(v.topics).some(list => list.includes(u)), `${m}: focus is set for an address that is not seeded: ${u}`); assert(Array.isArray(terms) && terms.length >= 1 && terms.length <= 8, `${m}: 1 to 8 focus words`); for (const w of terms) assert(typeof w === 'string' && w.trim() && w.length <= 80, `${m}: bad focus word`); }
});
t('the loader sends focus words with the address they belong to, and only for the topic that lists it', () => {
  const r = buildJobs(doc, hostsDoc), job = r.jobs.find(j => j.market === 'EE' && j.topic === 't11'); assert(job && job.focus, 'Estonia carries focus'); assert.deepStrictEqual(Object.keys(job.focus), job.urls); assert(!r.jobs.some(j => j.market === 'DE' && j.focus), 'a market with no focus sends none');
});
console.log(`\n${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
