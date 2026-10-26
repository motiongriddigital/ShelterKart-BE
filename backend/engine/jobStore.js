'use strict';
/**
 * ShelterKart — running investigations, saved to disk. One JSON file per report reference, written atomically
 * (temporary file, then rename). A restart reloads them: finished previews stay reusable for 30 days, and a paid
 * report that was still running resumes from its saved state instead of paying for its research twice.
 * Directory: LIVE_JOBS_DIR (default backend/data/live-jobs). One server instance; several instances need a database.
 */
const fs = require('fs'), path = require('path');

function createJobStore({ dir }) {
  fs.mkdirSync(dir, { recursive: true });
  const file = ref => path.join(dir, String(ref).replace(/[^A-Za-z0-9_-]/g, '_') + '.json');
  const read = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
  return {
    dir,
    save(rec) {
      if (!rec || !rec.ref) return;
      const f = file(rec.ref), tmp = f + '.' + process.pid + '.tmp';
      try { fs.writeFileSync(tmp, JSON.stringify(rec)); fs.renameSync(tmp, f); } catch (e) { console.error('[jobs] could not save ' + rec.ref + ':', e && e.message); }
    },
    load: ref => read(file(ref)),
    all: () => { try { return fs.readdirSync(dir).filter(n => n.endsWith('.json')).map(n => read(path.join(dir, n))).filter(Boolean); } catch { return []; } },
    remove(ref) { try { fs.unlinkSync(file(ref)); } catch { /* already gone */ } },
  };
}

module.exports = { createJobStore };
