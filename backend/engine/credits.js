'use strict';
/**
 * Credits for the official registers a report used (blind-spot review #6). Several of their licences make attribution
 * a condition of reuse. Computed from the report's own pages and finding sources, so a credit appears exactly when a
 * register's data is in the report, never otherwise.
 */
const fs = require('fs'), path = require('path');
const REG = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'registers.json'), 'utf8')).registers;
const byHost = new Map(REG.flatMap(r => r.hosts.map(h => [h, r])));
const hostOf = u => { try { return new URL(String(u)).hostname.toLowerCase(); } catch { return ''; } };
const urlsOf = b => [
  ...((b && b.pages) || []).map(p => p && p.url),
  ...((b && b.findings) || []).flatMap(f => (f && f.sources || []).map(s => (typeof s === 'string' ? s : s && s.url))),
  ...((b && b.sources) || []).map(s => (typeof s === 'string' ? s : s && s.url)),
].filter(Boolean);

function creditsFor(brief) {
  const seen = new Set(), out = [];
  for (const u of urlsOf(brief)) {
    const r = byHost.get(hostOf(u));
    if (r && !seen.has(r.id)) { seen.add(r.id); out.push({ id: r.id, name: r.name, country: r.country, licence: r.licence, licenceUrl: r.licenceUrl, credit: r.credit }); }
  }
  return out;
}
const attach = brief => (brief ? { ...brief, credits: creditsFor(brief) } : brief);
module.exports = { creditsFor, attach, REGISTERS: REG };
