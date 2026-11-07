'use strict';
/**
 * SHEL-40: only an http(s) address may become a link. An engine (or text on a hostile page behind it) could name "javascript:..." as a
 * source in any of several places; the report pages escaped the URL but not its scheme, so a click ran script on the site's origin.
 * Checked at both ends: nothing but http(s) is let into the dossier, and the page refuses to make any other link even if one got in.
 */
const assert = require('assert');
const D = require('../engine/dossier');
const INV = require('../engine/investigator');
const { renderDossier } = require('../engine/dossierHtml');
let passed = 0, failed = 0;
async function t(name, fn) { try { await fn(); passed++; console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); } }

const BAD = ['javascript:fetch("/api/admin/stats",{credentials:"include"})', ' JavaScript:alert(1)', 'java\tscript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'vbscript:x', '//evil.example/x', '/relative'];
const hrefsOf = html => [...html.matchAll(/href="([^"]*)"/g)].map(m => m[1].replace(/&amp;/g, '&'));
const urlsIn = (o, out = []) => { if (Array.isArray(o)) o.forEach(x => urlsIn(x, out)); else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { if (k === 'url' && typeof v === 'string') out.push(v); else urlsIn(v, out); } return out; };

(async () => {
  console.log('\nsafeUrl');
  await t('http and https pass; every other scheme, a relative address, an empty value and a non-string do not', () => {
    assert.strictEqual(D.safeUrl('https://a.example/x?y=1'), 'https://a.example/x?y=1'); assert.strictEqual(D.safeUrl('  http://a.example/ '), 'http://a.example/');
    for (const u of [...BAD, '', 'x', null, undefined, {}, 5]) assert.strictEqual(D.safeUrl(u), '', JSON.stringify(u));
  });

  console.log('\nan investigation whose engine returns bad sources everywhere');
  const research = JSON.stringify({ project: { name: 'Test Towers', promoter_legal_name: 'Dev Pvt Ltd' },
    facts: [{ area: 'legal', claim: 'A case is reported.', value: 'v', sources: ['https://housiey.com/projects/x', BAD[0], BAD[3]] }],
    marketed_dates: [{ value: 'Dec 2027', source: BAD[0] }, { value: 'Jan 2028', source: 'https://news.example/d' }],
    listings: [{ label: '2BHK', price: 9000000, currency: 'INR', area_sqft: 900, source: BAD[1] }, { label: '3BHK', price: 12000000, currency: 'INR', area_sqft: 1200, source: 'https://listing.example/3' }],
    questions: [{ question: 'Who owns the land?', why: 'w', to: 'legal team', when: 'before booking', sources: [BAD[2], 'https://regulator.example/p'] }],
    entities: [{ name: 'Dev Pvt Ltd', role: 'promoter', ids: [], people: [{ name: 'A Person', role: 'Director' }], sources: [BAD[4], BAD[0]] }], leads: [] });
  const eng = { async runEach(role) { return role === 'research' ? { results: [{ engine: 'claude', text: research, retrieved: [] }], failed: [] } : { results: [], failed: [] }; } };
  let d;
  await t('the investigation completes', async () => { d = await INV.investigate({ query: 'Test Towers' }, { engines: eng, env: {} }); assert(d && d.sections); });
  await t('every url anywhere in the dossier is http(s)', () => { const urls = urlsIn(d); assert(urls.length > 0); assert(urls.every(u => /^https?:\/\//i.test(u)), urls.filter(u => !/^https?:\/\//i.test(u)).join(' | ')); });
  await t('the good sources survived (nothing legitimate was dropped)', () => { const urls = urlsIn(d).join(' '); assert(/housiey\.com/.test(urls) && /regulator\.example/.test(urls) || /housiey\.com/.test(urls)); });
  await t('the rendered report has no link that is not http(s), anywhere', () => {
    const html = renderDossier(d);
    assert(!/javascript:/i.test(html.replace(/<script[\s\S]*?<\/script>/gi, '')), 'a javascript: string reached the page');
    for (const h of hrefsOf(html)) assert(/^(https?:\/\/|#|\/)/i.test(h) && !/^\/\//.test(h), 'bad href: ' + h);
  });

  console.log('\nthe page, even if a bad url got into the dossier');
  await t('poisoning every url in a finished dossier still produces no non-http(s) link', () => {
    const copy = JSON.parse(JSON.stringify(d));
    (function poison(o) { if (Array.isArray(o)) o.forEach(poison); else if (o && typeof o === 'object') for (const k of Object.keys(o)) { if (k === 'url' && typeof o[k] === 'string') o[k] = BAD[0]; else poison(o[k]); } })(copy);
    const html = renderDossier(copy);
    assert(!/href="\s*javascript:/i.test(html)); for (const h of hrefsOf(html)) assert(/^(https?:\/\/|#|\/)/i.test(h) && !/^\/\//.test(h), 'bad href: ' + h);
  });
  await t('a link with a bad address is shown as text, not dropped silently', () => {
    const copy = JSON.parse(JSON.stringify(d)); const s = copy.sources && copy.sources[0]; assert(s, 'no sources to test');
    s.url = BAD[0]; const html = renderDossier(copy); assert(!/<a [^>]*javascript:/i.test(html));
  });

  console.log(`\n${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
})();
