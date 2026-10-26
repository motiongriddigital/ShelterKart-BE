'use strict';
/**
 * Run the source-health check once, from cron or by hand:
 *
 *     node source_health_cli.js        (or: npm run health)
 *
 * Starts from what the database already knows, so "failed twice in a row"
 * means twice across separate runs, not twice within one process. Exits 1
 * if any register is switched off, so a scheduler can flag it. Alerts go
 * to ALERT_WEBHOOK_URL exactly as they do for the in-server schedule.
 */
require('dotenv').config();

async function main({ env = process.env, log = console.log } = {}) {
  const { Pool } = require('pg');
  const { guardedFetch } = require('./connectors/egress');
  const { makeRegistryHttp } = require('./engine/registryHttp');
  const { makePgStore } = require('./engine/persistence');
  const { MARKETS } = require('./engine/markets');
  const { CONNECTORS } = require('./engine/registry');
  const HEALTH = require('./engine/health');

  const pool = env.DATABASE_URL ? new Pool({ connectionString: env.DATABASE_URL }) : null;
  const store = pool ? makePgStore(pool) : null;
  try {
    if (store) for (const h of await store.loadHealth()) HEALTH.loadHealth(h.market, h);
    else log('DATABASE_URL is not set: nothing is remembered between runs, so a failure can never reach "down".');
    const http = makeRegistryHttp({ guardedFetch, allowSet: new Set(Object.values(CONNECTORS).flatMap(c => c.hosts)) });
    const results = await HEALTH.runHealthChecks({ connectors: CONNECTORS, markets: MARKETS, http, env, store });
    for (const r of results) log(`${r.state.padEnd(11)} ${r.market.padEnd(3)} ${r.label.padEnd(16)} ${r.detail || ''}`);
    return results;
  } finally { if (pool) await pool.end(); }
}

if (require.main === module) {
  main().then(r => process.exit(r.some(x => x.state === 'down') ? 1 : 0))
        .catch(e => { console.error('source health run failed:', e); process.exit(2); });
}
module.exports = { main };
