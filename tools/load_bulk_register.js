'use strict';
// Loads one country's open-data register file into Postgres by hand: node tools/load_bulk_register.js lv [--force]
// Needs DATABASE_URL. The same code runs daily when BULK_REGISTERS_SCHEDULE=true on one instance.
require('../backend/node_modules/dotenv').config({ path: require('path').join(__dirname, '..', 'backend', '.env') });
const { Pool } = require('../backend/node_modules/pg');
const { guardedFetch } = require('../backend/connectors/egress');
const { loadBulk } = require('../backend/engine/bulk/loader');
const specs = { lv: require('../backend/engine/bulk/latvia').spec };
(async () => {
  const country = process.argv[2], spec = specs[country];
  if (!spec) { console.error('usage: node tools/load_bulk_register.js <' + Object.keys(specs).join('|') + '> [--force]'); process.exit(2); }
  if (!process.env.DATABASE_URL) { console.error('DATABASE_URL is not set'); process.exit(2); }
  const pool = new Pool(require('../backend/lib/dbConfig').directOptions(process.env));
  const allow = new Set(spec.hosts);
  const r = await loadBulk({ spec, pool, force: process.argv.includes('--force'), log: console.log,
    fetchFile: (url, { headers }) => guardedFetch(url, { allowSet: allow, headers, timeoutMs: 60000 }).then(x => x.response) });
  console.log(JSON.stringify(r));
  await pool.end();
  process.exit(r.status === 'ok' || r.status === 'unchanged' ? 0 : 1);
})();
