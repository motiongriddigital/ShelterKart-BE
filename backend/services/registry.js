'use strict';
const { MARKETS } = require('../engine/markets');
const { CONNECTORS } = require('../engine/registry');
const HEALTH = require('../engine/health');
const { guardedFetch } = require('../connectors/egress');
const { makeRegistryHttp } = require('../engine/registryHttp');

module.exports = function setup(c) {
  const { pgStore } = c;
  const registryAllowSet = new Set(Object.values(CONNECTORS).flatMap(c => c.hosts));
  const registryHttp = makeRegistryHttp({ guardedFetch, allowSet: registryAllowSet });
  let healthRunning = false;
  const runSourceHealth = async () => {
    if (healthRunning) return null;                       // never two runs at once
    healthRunning = true;
    try { return await HEALTH.runHealthChecks({ connectors: CONNECTORS, markets: MARKETS, http: registryHttp, env: process.env, store: pgStore }); }
    finally { healthRunning = false; }
  };
  Object.assign(c, { registryHttp, runSourceHealth });
};
