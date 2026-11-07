'use strict';
/**
 * Checks requests against the API contract (docs/api/openapi.yaml) with express-openapi-validator.
 *
 *   API_VALIDATION=off|report|enforce      default off: nothing is loaded
 *   API_VALIDATION_ENFORCE=/api/auth,...   path prefixes refused with 400 when the mode is enforce; the rest stay report-only
 *
 * Report mode records route, method, field and message in counters and logs the first sighting of each, then lets the
 * request through unchanged. Enforce mode answers 400 { ok:false, code:'invalid_request', error, fields:[{path,message}] }.
 * Only the request is checked: responses and security stay with the routes. A contract that fails to load never
 * stops the API: it is logged once and every request passes.
 */
const fs = require('fs'), path = require('path');
const SPEC = path.join(__dirname, '..', '..', 'docs', 'api', 'openapi.yaml');
const IGNORED = /^\/api\/(payments\/(razorpay\/|mor\/)?webhook|research\/document-check)\/?$/i;
const MODES = new Set(['off', 'report', 'enforce']);

const modeOf = env => { const m = String(env.API_VALIDATION || 'off').trim().toLowerCase(); return MODES.has(m) ? m : 'off'; };
const prefixesOf = env => String(env.API_VALIDATION_ENFORCE || '').split(',').map(s => s.trim().toLowerCase().replace(/\/+$/, '')).filter(Boolean);
const enforced = (prefixes, p) => { const x = String(p).toLowerCase(); return prefixes.some(f => x === f || x.startsWith(f + '/')); };
const fieldsOf = err => (Array.isArray(err.errors) ? err.errors : []).map(e => ({ path: String(e.path || ''), message: String(e.message || '') }));

function createContract({ env = process.env, spec = SPEC, log = console } = {}) {
  const mode = modeOf(env), prefixes = prefixesOf(env);
  const counters = new Map(), seen = new Set();
  let broken = false;
  const record = (req, fields) => {
    const key = `${req.method} ${req.path}`, first = fields[0] || { path: '', message: 'invalid' };
    const row = counters.get(key) || { method: req.method, path: req.path, count: 0, path0: first.path, message: first.message };
    row.count++; counters.set(key, row);
    const sig = `${key} ${first.path}`;
    if (!seen.has(sig) && seen.size < 500) { seen.add(sig); log.warn(`[contract] ${req.method} ${req.path} does not match the contract: ${first.path || 'request'} ${first.message}`); }
  };
  if (mode === 'off') return { mode, middleware: (req, res, next) => next(), stats: () => ({ mode, enforce: prefixes, mismatches: [] }) };

  let chain = null;
  const build = () => {
    if (chain || broken) return;
    try {
      if (!fs.existsSync(spec)) throw new Error(`contract file not found: ${spec}`);
      const mws = require('express-openapi-validator').middleware({ apiSpec: spec, validateRequests: { allowUnknownQueryParameters: true, coerceTypes: false }, validateResponses: false, validateSecurity: false, ignoreUndocumented: true, ignorePaths: IGNORED });
      chain = (Array.isArray(mws) ? mws : [mws]);
    } catch (e) { broken = true; log.error('[contract] validation is off, the contract could not be loaded: ' + (e && e.message)); }
  };
  const runChain = (req, res) => new Promise(resolve => {
    let i = 0;
    const step = err => { if (err || i >= chain.length) return resolve(err || null); const fn = chain[i++]; try { fn(req, res, step); } catch (e) { resolve(e); } };
    step();
  });

  const middleware = async (req, res, next) => {
    build();
    if (broken || IGNORED.test(req.path)) return next();
    const enforce = mode === 'enforce' && enforced(prefixes, req.path);
    const keep = { query: req.query, body: req.body, params: req.params };
    if (!enforce) { req.query = { ...req.query }; if (req.body && typeof req.body === 'object') req.body = JSON.parse(JSON.stringify(req.body)); }
    let err;
    try { err = await runChain(req, res); } catch (e) { err = e; }
    if (!enforce) { req.query = keep.query; req.body = keep.body; req.params = keep.params; }
    if (!err) return next();
    if (err.status !== 400) { if (!(err.status >= 400 && err.status < 500)) log.error('[contract] the validator failed, the request passes: ' + (err && err.message)); return next(); }
    const fields = fieldsOf(err);
    record(req, fields);
    if (!enforce) return next();
    return res.status(400).json({ ok: false, code: 'invalid_request', error: (fields[0] && `${fields[0].path} ${fields[0].message}`.trim()) || 'The request does not match the API contract.', fields });
  };

  return { mode, middleware: (req, res, next) => middleware(req, res, next).catch(next),
    stats: () => ({ mode, enforce: prefixes, mismatches: [...counters.values()].sort((a, b) => b.count - a.count).slice(0, 100) }) };
}

module.exports = { createContract, modeOf, prefixesOf, enforced, SPEC };
