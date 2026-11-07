#!/usr/bin/env node
'use strict';
/**
 * Fail when a foreign key has no index on its referencing column and is not in tools/fk-index-allowlist.json.
 *
 *   DATABASE_URL=postgres://... node tools/check_fk_indexes.js
 *
 * PostgreSQL does not index the referencing side of a foreign key. Without one, deleting or updating a parent row
 * scans the child table. Each allow-list entry carries a reason; an entry that no longer matches a missing index is reported.
 */
const fs = require('fs'), path = require('path');

const QUERY = `
  SELECT c.conrelid::regclass::text AS tbl, a.attname AS col
  FROM pg_constraint c
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
  WHERE c.contype = 'f'
    AND NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = c.conrelid AND i.indisvalid AND i.indkey[0] = c.conkey[1])
  ORDER BY 1, 2`;

function evaluate(missing, allow) {
  const key = r => `${r.tbl}.${r.col}`;
  const allowed = new Map(allow.map(e => [`${e.table}.${e.column}`, e.reason]));
  const unreasoned = allow.filter(e => !e.reason || !String(e.reason).trim()).map(e => `${e.table}.${e.column}`);
  const unlisted = missing.filter(r => !allowed.has(key(r))).map(key);
  const stale = [...allowed.keys()].filter(k => !missing.some(r => key(r) === k));
  return { unlisted, stale, unreasoned, ok: !unlisted.length && !unreasoned.length };
}

async function check(client, allow = JSON.parse(fs.readFileSync(path.join(__dirname, 'fk-index-allowlist.json'), 'utf8'))) {
  return evaluate((await client.query(QUERY)).rows, allow);
}

module.exports = { QUERY, evaluate, check };

if (require.main === module) {
  (async () => {
    if (!process.env.DATABASE_URL) { console.error('Set DATABASE_URL first.'); process.exit(2); }
    const { Client } = require(path.join(__dirname, '..', 'backend', 'node_modules', 'pg'));
    const client = new Client({ connectionString: process.env.DATABASE_URL }); await client.connect();
    try {
      const r = await check(client);
      for (const k of r.stale) console.log(`note: allow-list entry ${k} now has an index; remove it`);
      for (const k of r.unreasoned) console.error(`allow-list entry ${k} has no reason`);
      for (const k of r.unlisted) console.error(`foreign key without an index: ${k}. Index it in a migration or add it to tools/fk-index-allowlist.json with a reason.`);
      if (r.ok) console.log('every foreign key is indexed or allow-listed with a reason');
      else process.exitCode = 1;
    } finally { await client.end(); }
  })();
}
