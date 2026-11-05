'use strict';
/** How many proxies in front of the API may be believed about the client address (TRUST_PROXY). Default: none, so a forged X-Forwarded-For changes nothing. */
const NAMED = new Set(['loopback', 'linklocal', 'uniquelocal']);
const CIDR = /^(\d{1,3}(\.\d{1,3}){3}(\/\d{1,2})?|[0-9a-f:]+(\/\d{1,3})?)$/i;

function parse(raw) {
  const text = String(raw == null ? '' : raw).trim();
  if (text === '' || /^(false|off|no|none|0)$/i.test(text)) return { setting: false, problem: null };
  if (/^\d+$/.test(text)) { const n = Number(text); return n > 0 && n <= 10 ? { setting: n, problem: null } : { setting: false, problem: 'TRUST_PROXY=' + text + ' is out of range (1 to 10); trusting no proxy.' }; }
  if (/^(true|on|yes)$/i.test(text)) return { setting: false, problem: 'TRUST_PROXY=' + text + ' would trust every hop and let any client choose its own address; trusting no proxy. Use a hop count or the proxy addresses.' };
  const parts = text.split(',').map(s => s.trim()).filter(Boolean);
  const bad = parts.filter(p => !NAMED.has(p.toLowerCase()) && !CIDR.test(p));
  if (bad.length) return { setting: false, problem: 'TRUST_PROXY has an entry that is not a hop count, a named range or an address: ' + bad.join(', ') + '; trusting no proxy.' };
  return { setting: parts.map(p => NAMED.has(p.toLowerCase()) ? p.toLowerCase() : p), problem: null };
}

module.exports = { parse };
