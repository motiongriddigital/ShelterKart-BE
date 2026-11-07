'use strict';
const ENGINES = require('../engines');               // which AI engine serves each agent (backend/engines)

module.exports = function setup(c) {
  const { pool } = c;
  /* ---------- pricing and payments (see pricing/ and payments/) ----------
     The fee is set by the PROPERTY and the evidence depth, the same in dollars for every buyer; the buyer's
     country decides only the currency, the tax and the payment route. Everything country-specific is data. */
  const ENGINE_HISTORY = require('../engines/history').createHistory({ pool: process.env.DATABASE_URL ? pool : null });   // usage kept per day, so a restart does not reset it
  ENGINES.meter.setSink(ENGINE_HISTORY.record);
  Object.assign(c, { ENGINE_HISTORY });
};
