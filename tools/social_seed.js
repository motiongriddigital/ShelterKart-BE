#!/usr/bin/env node
'use strict';
/**
 * Loads a seed file (default backend/social/data/seeds-wave1.json) into the marketing desk's knowledge keeper, one market and topic at a time,
 * through the admin route. A host the keeper's official-site rule does not match is sent as an allowed host ONLY if a person has set "approved": true
 * for it in backend/social/data/official-hosts.json (the reviewed list: what each host is, and a recommendation). Nothing is approved by default.
 *   node tools/social_seed.js                         shows what would be sent, sends nothing
 *   node tools/social_seed.js --send --user U --pass P [--base https://shelterkart.com] [--allow-hosts] [--file path] [--hosts path]
 */
const fs = require('fs'), path = require('path');
const DATA = path.join(__dirname, '..', 'backend', 'social', 'data');

/** The requests to send: topic seeds always; allowed hosts only when asked for AND approved in the reviewed list. Returns { jobs, pendingHosts, approvedHosts }. */
function buildJobs(doc, hostsDoc, { allowHosts = false } = {}) {
  const approved = new Set((hostsDoc.hosts || []).filter(h => h.approved === true).map(h => `${h.market}:${h.host}`)), jobs = [], pendingHosts = [], approvedHosts = [];
  for (const [market, m] of Object.entries(doc.markets)) {
    const hosts = (m.allowedHosts || []).filter(h => (hostsDoc.hosts || []).some(x => x.market === market && x.host === h) ? true : (pendingHosts.push(`${market}:${h} (not in the reviewed list)`), false));
    const ok = hosts.filter(h => approved.has(`${market}:${h}`)); for (const h of hosts) if (!approved.has(`${market}:${h}`)) pendingHosts.push(`${market}:${h}`);
    if (allowHosts && ok.length) { jobs.push({ market, allowedHosts: ok }); approvedHosts.push(...ok.map(h => `${market}:${h}`)); }
    for (const [topic, urls] of Object.entries(m.topics || {})) { const focus = Object.fromEntries(urls.filter(u => (m.focus || {})[u]).map(u => [u, m.focus[u]])); jobs.push(Object.keys(focus).length ? { market, topic, urls, focus } : { market, topic, urls }); }
  }
  return { jobs, pendingHosts: [...new Set(pendingHosts)], approvedHosts };
}
module.exports = { buildJobs };

if (require.main === module) {
  const a = process.argv.slice(2), has = f => a.includes(f), val = f => { const i = a.indexOf(f); return i >= 0 ? a[i + 1] : ''; };
  const doc = JSON.parse(fs.readFileSync(val('--file') || path.join(DATA, 'seeds-wave1.json'), 'utf8')), hostsDoc = JSON.parse(fs.readFileSync(val('--hosts') || path.join(DATA, 'official-hosts.json'), 'utf8')), base = (val('--base') || 'http://localhost:3000').replace(/\/$/, '');
  const { jobs, pendingHosts, approvedHosts } = buildJobs(doc, hostsDoc, { allowHosts: has('--allow-hosts') });
  (async () => {
    if (!has('--send')) {
      console.log(`${jobs.length} requests would be sent to ${base}/api/admin/social/keeper/seeds (add --send --user U --pass P):`); for (const j of jobs.slice(0, 12)) console.log(' ', JSON.stringify(j).slice(0, 150)); if (jobs.length > 12) console.log(`  … and ${jobs.length - 12} more`);
      if (pendingHosts.length) console.log(`\n${pendingHosts.length} hosts need a person to approve them as official (read backend/social/data/official-hosts.json, then set "approved": true for the ones you accept):\n  ${pendingHosts.join('\n  ')}`);
      if (approvedHosts.length) console.log(`\nApproved hosts that would be sent: ${approvedHosts.join(', ')}`); return;
    }
    const auth = 'Basic ' + Buffer.from(`${val('--user')}:${val('--pass')}`).toString('base64'); let ok = 0, bad = 0;
    for (const j of jobs) { const r = await fetch(base + '/api/admin/social/keeper/seeds', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: auth }, body: JSON.stringify(j) }); if (r.ok) ok++; else { bad++; console.error(j.market, j.topic || 'hosts', r.status, (await r.text()).slice(0, 120)); } }
    console.log(`sent ${ok}, failed ${bad}`); if (pendingHosts.length) console.log(`${pendingHosts.length} hosts were not sent because they are not approved.`); process.exit(bad ? 1 : 0);
  })();
}
