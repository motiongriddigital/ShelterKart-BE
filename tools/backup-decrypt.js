#!/usr/bin/env node
'use strict';
/**
 * Decrypt a ShelterKart database backup (.skbk) into a pg_dump custom-format file, ready for pg_restore.
 *
 *   BACKUP_KEY_k1=<64 hex> node tools/backup-decrypt.js db-20261104T100000Z-k1.skbk restored.dump
 *   pg_restore --no-owner --dbname=postgres://.../scratch_db restored.dump
 *
 * The key id is read from the file; supply the key with the same name as the server uses (BACKUP_KEY_<id>).
 * A wrong key or a changed byte stops with an error and leaves no output file. Never restore over the live database.
 */
const { decryptFile, readKeys } = require('../backend/engine/backups');
(async () => {
  const [file, out] = process.argv.slice(2);
  if (!file || !out) { console.error('usage: node tools/backup-decrypt.js <file.skbk> <output.dump>'); process.exit(2); }
  const { keys } = readKeys(process.env);
  try {
    const r = await decryptFile(file, out, id => keys.get(id));
    console.log('[backup-decrypt] ok: key ' + r.keyId + ' -> ' + out);
  } catch (e) { console.error('[backup-decrypt] failed: ' + e.message); process.exit(1); }
})();
