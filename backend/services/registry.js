'use strict';
const { MARKETS } = require('../engine/markets');
const { CONNECTORS } = require('../engine/registry');
const HEALTH = require('../engine/health');
const { guardedFetch } = require('../connectors/egress');
const { makeRegistryHttp } = require('../engine/registryHttp');

const { loadBulk } = require('../engine/bulk/loader');
const BULK_SPECS = { lv: require('../engine/bulk/latvia').spec };

module.exports = function setup(c) {
  const { pgStore, pool } = c;
  const registryAllowSet = new Set(Object.values(CONNECTORS).flatMap(c => c.hosts));
  const registryHttp = makeRegistryHttp({ guardedFetch, allowSet: registryAllowSet });
  let healthRunning = false;
  const runSourceHealth = async () => {
    if (healthRunning) return null;                       // never two runs at once
    healthRunning = true;
    try { return await HEALTH.runHealthChecks({ connectors: CONNECTORS, markets: MARKETS, http: registryHttp, env: process.env, store: pgStore }); }
    finally { healthRunning = false; }
  };
  /* The bulk registers (engine/bulk): one polite download per country per day, loaded into Postgres. Needs a database. */
  const runBulk = async (country, opts = {}) => {
    const spec = BULK_SPECS[country];
    if (!spec) return { status: 'failed', kind: 'unknown', detail: `no bulk register for "${country}"` };
    if (!process.env.DATABASE_URL) return { status: 'failed', kind: 'no_database', detail: 'the bulk registers are stored in Postgres: DATABASE_URL is not set' };
    const allow = new Set(spec.hosts);
    const fetchFile = (url, { headers }) => guardedFetch(url, { allowSet: allow, headers, timeoutMs: 60000 }).then(r => r.response);
    return loadBulk({ spec, pool, fetchFile, log: m => console.log(m), ...opts });
  };
  Object.assign(c, { registryHttp, runSourceHealth, runBulk, BULK_SPECS });
};
