/**
 * ShelterKart — outbound fetch guard (SSRF).
 *
 * WHY THIS IS SHARP HERE
 *
 * Connectors exist to fetch remote documents. That is the product's
 * core loop, and it means the server can be induced to make requests
 * on someone else's behalf — the definition of SSRF.
 *
 * It compounds with the injection problem. A hostile filing can contain
 * a URL ("supporting document available at ..."), and a connector that
 * follows references found inside retrieved documents will fetch it.
 * So the attacker who authors the document also chooses the
 * destination. The two defences are separate: injection handling stops
 * the text influencing the model, this stops the text influencing the
 * network.
 *
 * WHAT AN UNGUARDED FETCH REACHES
 *   169.254.169.254        cloud instance metadata — IAM credentials
 *   metadata.google.internal
 *   127.0.0.1:5432         the database this process is authenticated to
 *   localhost:4000         its own admin API, from inside the trust boundary
 *   file:///etc/passwd     if the fetcher honours non-HTTP schemes
 *
 * DESIGN
 *
 * Allow-list, not block-list. A block-list of private ranges is a list
 * of the bypasses someone has thought of; the encodings are endless
 * (decimal IPs, IPv6-mapped IPv4, DNS entries pointing at 127.0.0.1).
 * Only hosts registered in `sources` may be contacted, so an address
 * nobody anticipated is refused because it was never permitted, not
 * because it was recognised as dangerous.
 *
 * Every redirect hop is re-validated. Validating only the first URL is
 * the most common way this control is defeated: a permitted host
 * answers 302 and points anywhere it likes.
 */

'use strict';

const dnsCb = require('dns');
const dns = dnsCb.promises;
const net = require('net');

class EgressBlocked extends Error {
  constructor(reason, target) {
    super(`Egress blocked: ${reason} (${target})`);
    this.name = 'EgressBlocked';
    this.reason = reason;
    this.target = target;
  }
}

/* ------------------------------------------------------------
   Address classification.
   Used as a second line behind the host allow-list: a permitted
   hostname whose DNS record resolves into private space is still
   refused, which is what defeats DNS rebinding.
   ------------------------------------------------------------ */
function ipv4ToInt(ip) {
  return ip.split('.').reduce((acc, o) => (acc << 8) + Number(o), 0) >>> 0;
}

const BLOCKED_V4 = [
  ['0.0.0.0',        8,  'this network'],
  ['10.0.0.0',       8,  'private'],
  ['100.64.0.0',     10, 'carrier NAT'],
  ['127.0.0.0',      8,  'loopback'],
  ['169.254.0.0',    16, 'link-local / cloud metadata'],
  ['172.16.0.0',     12, 'private'],
  ['192.0.0.0',      24, 'IETF protocol assignments'],
  ['192.0.2.0',      24, 'documentation'],
  ['192.88.99.0',    24, '6to4 relay'],
  ['192.168.0.0',    16, 'private'],
  ['198.18.0.0',     15, 'benchmarking'],
  ['198.51.100.0',   24, 'documentation'],
  ['203.0.113.0',    24, 'documentation'],
  ['224.0.0.0',      4,  'multicast'],
  ['240.0.0.0',      4,  'reserved'],
];

function classifyV4(ip) {
  const v = ipv4ToInt(ip);
  for (const [base, bits, label] of BLOCKED_V4) {
    const mask = (~0 << (32 - bits)) >>> 0;
    if ((v & mask) === (ipv4ToInt(base) & mask)) return { blocked: true, reason: label };
  }
  return { blocked: false };
}

/** Sixteen bytes of an IPv6 address, or null. Handles "::", a dotted IPv4 tail and a zone id. */
function ipv6Bytes(ip) {
  const addr = ip.split('%')[0].toLowerCase();
  if (!net.isIPv6(addr)) return null;
  const halves = addr.split('::');
  const side = part => {
    if (!part) return [];
    const groups = part.split(':');
    const last = groups[groups.length - 1];
    if (last.includes('.')) {
      const o = last.split('.').map(Number);
      groups.splice(groups.length - 1, 1, ((o[0] << 8) | o[1]).toString(16), ((o[2] << 8) | o[3]).toString(16));
    }
    return groups.map(g => parseInt(g, 16));
  };
  const head = side(halves[0]);
  const tail = halves.length > 1 ? side(halves[1]) : [];
  const words = [...head, ...new Array(8 - head.length - tail.length).fill(0), ...tail];
  const bytes = [];
  for (const w of words) bytes.push(w >> 8, w & 255);
  return bytes;
}

function classifyV6(ip) {
  const b = ipv6Bytes(ip);
  if (!b) return { blocked: true, reason: 'unparseable address' };
  const embedded = at => `${b[at]}.${b[at + 1]}.${b[at + 2]}.${b[at + 3]}`;
  if (b.every(x => x === 0)) return { blocked: true, reason: 'IPv6 unspecified' };
  if (b.slice(0, 15).every(x => x === 0) && b[15] === 1) return { blocked: true, reason: 'IPv6 loopback' };
  if (b.slice(0, 10).every(x => x === 0) && b[10] === 255 && b[11] === 255) {
    const c = classifyV4(embedded(12));
    return c.blocked ? { blocked: true, reason: `IPv4-mapped ${c.reason}` } : c;
  }
  if (b[0] === 0) return { blocked: true, reason: 'IPv6 reserved (IPv4-compatible, NAT64, discard)' };
  if (b[0] === 1) return { blocked: true, reason: 'IPv6 reserved' };
  if ((b[0] & 0xfe) === 0xfc) return { blocked: true, reason: 'IPv6 unique-local' };
  if (b[0] === 0xfe) return { blocked: true, reason: 'IPv6 link-local or site-local' };
  if (b[0] === 0xff) return { blocked: true, reason: 'IPv6 multicast' };
  if (b[0] === 0x20 && b[1] === 0x02) {
    const c = classifyV4(embedded(2));
    return c.blocked ? { blocked: true, reason: `6to4 ${c.reason}` } : c;
  }
  if (b[0] === 0x20 && b[1] === 0x01 && (b[2] & 0xfe) === 0) return { blocked: true, reason: 'IPv6 IETF protocol (Teredo)' };
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x0d && b[3] === 0xb8) return { blocked: true, reason: 'IPv6 documentation' };
  if (b[0] === 0x3f && b[1] === 0xff && (b[2] & 0xf0) === 0) return { blocked: true, reason: 'IPv6 documentation' };
  return { blocked: false };
}

function classifyIp(ip) {
  if (net.isIPv4(ip)) return classifyV4(ip);
  if (net.isIPv6(ip.split('%')[0])) return classifyV6(ip);
  return { blocked: true, reason: 'unparseable address' };
}

/* ------------------------------------------------------------
   Connect-time check. The pre-request lookup in validateTarget
   gives a readable refusal, but the HTTP client resolves the name
   again when it opens the socket, and an attacker-controlled DNS
   server can answer differently the second time. This lookup is
   handed to the client itself, so the address that is checked is
   the address that is connected to.
   ------------------------------------------------------------ */
function guardedLookup(hostname, options, cb) {
  if (typeof options === 'function') { cb = options; options = {}; }
  dnsCb.lookup(hostname, { ...options, all: true, verbatim: true }, (err, addrs) => {
    if (err) return cb(err);
    for (const a of addrs) {
      const c = classifyIp(a.address);
      if (c.blocked) return cb(new EgressBlocked(`resolves to ${c.reason} (${a.address})`, hostname));
    }
    if (options && options.all) return cb(null, addrs);
    return cb(null, addrs[0].address, addrs[0].family);
  });
}

let pinnedAgent = null;
function pinnedDispatcher() {
  if (!pinnedAgent) {
    const { Agent } = require('undici');
    pinnedAgent = new Agent({ connect: { lookup: guardedLookup } });
  }
  return pinnedAgent;
}

// A replaced globalThis.fetch (tests, tooling: an anonymous function) is used as it is; only the platform fetch, named fetch, goes through the pinned agent.
function defaultFetch() {
  const g = globalThis.fetch;
  if (typeof g !== 'function') return null;
  if (g.name !== 'fetch') return g;
  const { fetch } = require('undici');
  const dispatcher = pinnedDispatcher();
  return (url, init) => fetch(url, { ...init, dispatcher });
}

/* ------------------------------------------------------------
   Host allow-list, built from the sources table.
   ------------------------------------------------------------ */
function hostFromUrl(u) {
  return new URL(u).hostname.toLowerCase().replace(/\.$/, '');
}

/** Build the permitted host set from registered source base_urls. */
function buildAllowList(sourceRows) {
  const hosts = new Set();
  for (const row of sourceRows || []) {
    if (!row.base_url) continue;
    try { hosts.add(hostFromUrl(row.base_url)); } catch { /* skip malformed */ }
  }
  return hosts;
}

/** A host matches if it equals a permitted host or is a subdomain of
 *  one. Suffix matching is done on labels, not characters: a plain
 *  endsWith() would let `evil-mca.gov.in.attacker.com` through. */
function hostAllowed(host, allowSet) {
  if (allowSet.has(host)) return true;
  for (const allowed of allowSet) {
    if (host.endsWith('.' + allowed)) return true;
  }
  return false;
}

/* ------------------------------------------------------------
   Validation of a single URL.
   ------------------------------------------------------------ */
async function validateTarget(rawUrl, allowSet, opts = {}) {
  let url;
  try { url = new URL(rawUrl); }
  catch { throw new EgressBlocked('malformed URL', String(rawUrl)); }

  if (url.protocol !== 'https:' && !(opts.allowHttp && url.protocol === 'http:')) {
    throw new EgressBlocked(`scheme ${url.protocol} not permitted`, rawUrl);
  }
  if (url.username || url.password) {
    // http://allowed.gov.in@169.254.169.254/ — the part before @ is
    // credentials, not the host, and it fools eyeballs and weak parsers.
    throw new EgressBlocked('credentials in URL', rawUrl);
  }

  const host = url.hostname.toLowerCase().replace(/\.$/, '');

  // Registers answer on the standard ports. Any other port on a permitted host is a service nobody registered.
  const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
  const portsOk = new Set([443, ...(opts.allowHttp ? [80] : []), ...(opts.allowPorts || [])]);
  if (!portsOk.has(port)) throw new EgressBlocked(`port ${port} not permitted`, rawUrl);

  // A literal IP can never be on the allow-list, which is built from
  // registered hostnames. Reject explicitly so the reason is clear.
  if (net.isIP(host)) {
    const c = classifyIp(host);
    throw new EgressBlocked(
      c.blocked ? `IP literal in ${c.reason} range` : 'IP literal not permitted', rawUrl);
  }
  if (!hostAllowed(host, allowSet)) {
    throw new EgressBlocked('host not in source registry', rawUrl);
  }

  // Resolve and check every address the name maps to. A permitted host
  // whose record points into private space is refused here — this is
  // the DNS-rebinding case, and it is why resolution happens before
  // the request rather than being left to the HTTP client.
  let addrs = [];
  try {
    const res = await dns.lookup(host, { all: true, verbatim: true });
    addrs = res.map(r => r.address);
  } catch {
    throw new EgressBlocked('DNS resolution failed', rawUrl);
  }
  if (addrs.length === 0) throw new EgressBlocked('no addresses resolved', rawUrl);

  for (const a of addrs) {
    const c = classifyIp(a);
    if (c.blocked) throw new EgressBlocked(`resolves to ${c.reason} (${a})`, rawUrl);
  }

  return { url, host, addresses: addrs };
}

/* ------------------------------------------------------------
   Guarded fetch. Redirects are followed manually so each hop is
   validated; handing redirect-following to the HTTP client would
   validate only the first URL.
   ------------------------------------------------------------ */
async function guardedFetch(rawUrl, { allowSet, maxRedirects = 3, timeoutMs = 15000,
                                      allowHttp = false, allowPorts = [], fetchImpl, headers = {}, method = 'GET', body } = {}) {
  const doFetch = fetchImpl || defaultFetch();
  if (typeof doFetch !== 'function') throw new Error('No fetch implementation available');

  let target = rawUrl;
  const chain = [];
  // Caller headers (an API key, for instance) are sent only to the
  // original host. If a permitted host redirects elsewhere -- even to
  // another permitted host -- credentials are dropped, so a redirect can
  // never carry a key somewhere it wasn't meant to go.
  const originHost = (() => { try { return new URL(rawUrl).hostname.toLowerCase(); } catch { return ''; } })();

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const checked = await validateTarget(target, allowSet, { allowHttp, allowPorts });
    chain.push(checked.url.toString());

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res;
    // A method and body apply only to the first hop. A redirect is
    // followed as a plain GET without the body, the same way browsers
    // handle 302/303, so a payload can never be replayed to a new host.
    const firstHop = hop === 0;
    try {
      res = await doFetch(checked.url.toString(), {
        method: firstHop ? method : 'GET',
        ...(firstHop && body != null ? { body } : {}),
        redirect: 'manual',        // we follow them ourselves, re-validating each
        signal: ctrl.signal,
        headers: {
          'user-agent': 'ShelterKart-Connector/1.0',
          ...(checked.host === originHost ? headers : {}),
        },
      });
    } catch (e) {
      if (e && e.cause instanceof EgressBlocked) throw e.cause;
      throw e;
    } finally {
      clearTimeout(timer);
    }

    // Only these statuses are redirects. A 304 (Not Modified, the answer to a conditional request) and 300 or 305 have no destination to follow.
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const loc = res.headers.get('location');
      if (!loc) throw new EgressBlocked('redirect without location', target);
      target = new URL(loc, checked.url).toString();
      continue;                    // re-validate the new destination
    }
    return { response: res, chain };
  }
  throw new EgressBlocked(`exceeded ${maxRedirects} redirects`, rawUrl);
}

module.exports = {
  EgressBlocked, classifyIp, buildAllowList, hostAllowed,
  validateTarget, guardedFetch, guardedLookup,
};
