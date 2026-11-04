'use strict';
/**
 * ShelterKart: the error log behind the admin panel's Health and errors screens.
 *
 * Every error or warning the server prints is grouped by a fingerprint of its source and message, so a flood is one
 * row with a count, not ten thousand lines. Messages are scrubbed of e-mail addresses, IP addresses, tokens and query
 * strings first: the log never holds personal data. It never throws and never slows a request: writes are background.
 * Postgres when a pool is given, memory otherwise. Read-only routes: GET /api/admin/errors, /summary and /:id.
 */
const crypto = require('crypto');
const util = require('util');

const KEEP_DAYS = 30, MEMORY_GROUPS = 500, MEMORY_HITS = 20000, THROTTLE_MS = 1000;
const LEVELS = new Set(['error', 'warn', 'info']);

/** Removes what must never be stored: addresses, IPs, tokens, query strings, bearer values. */
function scrub(text, max = 600) {
  return String(text == null ? '' : text)
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[ip]')
    .replace(/\b[0-9a-f:]{3,}:[0-9a-f:]{2,}\b/gi, m => (/^[0-9:]+$/.test(m) && m.split(':').length < 5 ? m : '[ip]'))
    .replace(/(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 [token]')
    .replace(/\?[^\s"')]*(?:token|key|t|code|sig|signature|secret|pass)[^\s"')]*=[^\s"')]*/gi, '?[query]')
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '[token]')
    .trim().slice(0, max);
}

/** The same problem, whatever its numbers and ids. */
function fingerprint(source, message) {
  const norm = String(message).toLowerCase().replace(/\bsk-[0-9a-f]+\b/g, 'sk-#').replace(/\b[0-9a-f]{8,}\b/g, '#').replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();
  return crypto.createHash('sha1').update(source + '|' + norm).digest('hex').slice(0, 20);
}

function rowOf(r) {
  return { id: Number(r.id), level: r.level, source: r.source, message: r.message, detail: r.detail || null, count: Number(r.count), firstAt: new Date(r.first_at || r.firstAt), lastAt: new Date(r.last_at || r.lastAt) };
}

function makePgStore(pool) {
  return {
    kind: 'postgres',
    async upsert({ fingerprint: fp, level, source, message, detail, at, n }) {
      const r = (await pool.query(
        `INSERT INTO error_log (fingerprint, level, source, message, detail, count, first_at, last_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$7)
         ON CONFLICT (fingerprint) DO UPDATE SET count = error_log.count + $6, last_at = $7, detail = COALESCE(EXCLUDED.detail, error_log.detail),
           level = CASE WHEN EXCLUDED.level = 'error' OR error_log.level = 'error' THEN 'error' ELSE error_log.level END
         RETURNING id, level`, [fp, level, source, message, detail || null, n, at])).rows[0];
      await pool.query(`INSERT INTO error_hits (at, error_id, level, n) VALUES ($1,$2,$3,$4)`, [at, r.id, level, n]);
    },
    async list({ level, q, since, limit, offset }) {
      const like = q ? '%' + q.toLowerCase().replace(/[%_]/g, '') + '%' : null;
      return (await pool.query(
        `SELECT id, level, source, message, detail, count, first_at, last_at FROM error_log
          WHERE ($1::text IS NULL OR level=$1) AND ($2::timestamptz IS NULL OR last_at >= $2)
            AND ($3::text IS NULL OR lower(source || ' ' || message || ' ' || COALESCE(detail,'')) LIKE $3)
          ORDER BY last_at DESC LIMIT $4 OFFSET $5`, [level || null, since || null, like, limit, offset])).rows.map(rowOf);
    },
    async get(id) {
      const r = (await pool.query(`SELECT id, level, source, message, detail, count, first_at, last_at FROM error_log WHERE id=$1`, [id])).rows[0];
      if (!r) return null;
      const hits = (await pool.query(`SELECT at, n FROM error_hits WHERE error_id=$1 ORDER BY at DESC LIMIT 30`, [id])).rows.map(h => ({ at: new Date(h.at), n: Number(h.n) }));
      return { ...rowOf(r), hits };
    },
    async hourly(since) {
      return (await pool.query(`SELECT date_trunc('hour', at) AS h, level, SUM(n)::int AS n FROM error_hits WHERE at >= $1 GROUP BY 1, 2`, [since]))
        .rows.map(r => ({ hour: new Date(r.h), level: r.level, n: Number(r.n) }));
    },
    async topSources(since, limit) {
      return (await pool.query(`SELECT source, SUM(n)::int AS n FROM error_hits h JOIN error_log e ON e.id = h.error_id WHERE h.at >= $1 AND h.level <> 'info' GROUP BY source ORDER BY n DESC LIMIT $2`, [since, limit]))
        .rows.map(r => ({ source: r.source, count: Number(r.n) }));
    },
    async purge(before) {
      const h = await pool.query(`DELETE FROM error_hits WHERE at < $1`, [before]);
      const e = await pool.query(`DELETE FROM error_log WHERE last_at < $1`, [before]);
      return { hits: h.rowCount || 0, groups: e.rowCount || 0 };
    },
  };
}

function makeMemoryStore() {
  const groups = new Map(), hits = [];
  let seq = 0;
  return {
    kind: 'memory',
    async upsert({ fingerprint: fp, level, source, message, detail, at, n }) {
      let g = groups.get(fp);
      if (!g) {
        if (groups.size >= MEMORY_GROUPS) { const oldest = [...groups.entries()].sort((a, b) => a[1].lastAt - b[1].lastAt)[0]; groups.delete(oldest[0]); }
        g = { id: ++seq, level, source, message, detail: detail || null, count: 0, firstAt: at, lastAt: at }; groups.set(fp, g);
      }
      g.count += n; g.lastAt = at; if (detail) g.detail = detail; if (level === 'error') g.level = 'error';
      hits.push({ at, id: g.id, level, n }); if (hits.length > MEMORY_HITS) hits.splice(0, hits.length - MEMORY_HITS);
    },
    async list({ level, q, since, limit, offset }) {
      const t = q ? q.toLowerCase() : null;
      return [...groups.values()].filter(g => (!level || g.level === level) && (!since || g.lastAt >= since) && (!t || `${g.source} ${g.message} ${g.detail || ''}`.toLowerCase().includes(t)))
        .sort((a, b) => b.lastAt - a.lastAt).slice(offset, offset + limit).map(g => rowOf(g));
    },
    async get(id) {
      const g = [...groups.values()].find(x => x.id === id); if (!g) return null;
      return { ...rowOf(g), hits: hits.filter(h => h.id === id).sort((a, b) => b.at - a.at).slice(0, 30).map(h => ({ at: h.at, n: h.n })) };
    },
    async hourly(since) {
      const m = new Map();
      for (const h of hits) if (h.at >= since) { const hr = new Date(Math.floor(h.at.getTime() / 3600e3) * 3600e3), k = hr.getTime() + '|' + h.level; m.set(k, (m.get(k) || 0) + h.n); }
      return [...m.entries()].map(([k, n]) => { const [t, level] = k.split('|'); return { hour: new Date(Number(t)), level, n }; });
    },
    async topSources(since, limit) {
      const m = new Map(), byId = new Map([...groups.values()].map(g => [g.id, g]));
      for (const h of hits) if (h.at >= since && h.level !== 'info') { const s = (byId.get(h.id) || {}).source; if (s) m.set(s, (m.get(s) || 0) + h.n); }
      return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([source, count]) => ({ source, count }));
    },
    async purge(before) {
      let h = 0, g = 0;
      for (let i = hits.length - 1; i >= 0; i--) if (hits[i].at < before) { hits.splice(i, 1); h++; }
      for (const [k, v] of groups) if (v.lastAt < before) { groups.delete(k); g++; }
      return { hits: h, groups: g };
    },
  };
}

function createErrorLog({ pool = null, now = () => Date.now(), enabled = true, setTimer = (fn, ms) => { const h = setTimeout(fn, ms); if (h.unref) h.unref(); return h; } } = {}) {
  const store = pool ? makePgStore(pool) : makeMemoryStore();
  const lastWrite = new Map(), pending = new Map(), held = new Map();

  const write = (fp, e, n, t) => Promise.resolve(store.upsert({ fingerprint: fp, level: e.lv, source: e.src, message: e.msg, detail: e.detail, at: new Date(t), n }))
    .catch(err => process.stderr.write('[errorlog] not saved: ' + (err && err.message) + '\n'));

  function flush(fp) {
    const e = held.get(fp), n = pending.get(fp) || 0;
    held.delete(fp); pending.delete(fp);
    if (e && n) { lastWrite.set(fp, now()); write(fp, e, n, now()); }
  }

  /** Never throws. Same problem within a second is counted, not written again. */
  function record({ level = 'error', source = 'server', message, detail }) {
    if (!enabled) return;
    try {
      const lv = LEVELS.has(level) ? level : 'error', src = scrub(source, 60) || 'server', msg = scrub(message, 300) || '(no message)';
      const fp = fingerprint(src, msg), t = now(), entry = { lv, src, msg, detail: detail ? scrub(detail, 1200) : null };
      if (t - (lastWrite.get(fp) || 0) < THROTTLE_MS) {
        pending.set(fp, (pending.get(fp) || 0) + 1);
        if (lv === 'error' || !held.has(fp)) held.set(fp, entry);
        if (pending.get(fp) === 1) setTimer(() => flush(fp), THROTTLE_MS);
        return;
      }
      const n = 1 + (pending.get(fp) || 0); pending.delete(fp); held.delete(fp); lastWrite.set(fp, t);
      if (lastWrite.size > 2000) lastWrite.clear();
      write(fp, entry, n, t);
    } catch { /* the log must never break the server */ }
  }

  /** Mirror console.error and console.warn into the log. The original output is unchanged. */
  function hookConsole(c = console) {
    if (!enabled || c.__errorLogHooked) return;
    c.__errorLogHooked = true;
    for (const [fn, level] of [['error', 'error'], ['warn', 'warn']]) {
      const orig = c[fn].bind(c);
      c[fn] = (...args) => {
        orig(...args);
        try {
          const err = args.find(a => a instanceof Error);
          const strings = args.filter(a => typeof a === 'string');
          let text = strings.length ? util.format(...strings) : err ? err.message : util.format(...args.map(a => (typeof a === 'object' && a !== null ? (a.message || util.inspect(a, { depth: 1, breakLength: 200 })) : a)));
          const tag = /^\[([A-Za-z0-9:_ .-]{1,40})\]\s*/.exec(text);
          const source = tag ? tag[1] : 'server';
          if (tag) text = text.slice(tag[0].length);
          record({ level, source, message: text.split('\n')[0], detail: err && err.stack ? err.stack.split('\n').slice(0, 6).join('\n') : text.includes('\n') ? text : null });
        } catch { /* ignore */ }
      };
    }
  }

  const parseSince = (v, fallbackHours) => { const h = Math.min(24 * KEEP_DAYS, Math.max(1, parseInt(v, 10) || fallbackHours)); return new Date(now() - h * 3600e3); };

  async function summary(hours = 24) {
    const since = new Date(now() - hours * 3600e3), rows = await store.hourly(since), byHour = new Map();
    const end = Math.floor(now() / 3600e3) * 3600e3, n = Math.min(hours, 72);
    const series = [];
    for (let i = n - 1; i >= 0; i--) { const h = end - i * 3600e3; series.push({ hour: new Date(h).toISOString(), errors: 0, warnings: 0 }); byHour.set(h, series[series.length - 1]); }
    const totals = { error: 0, warn: 0, info: 0 };
    for (const r of rows) { totals[r.level] = (totals[r.level] || 0) + r.n; const b = byHour.get(r.hour.getTime()); if (b) { if (r.level === 'error') b.errors += r.n; else if (r.level === 'warn') b.warnings += r.n; } }
    return { hours, totals, series, topSources: await store.topSources(since, 5) };
  }

  const out = r => ({ id: r.id, level: r.level, source: r.source, message: r.message, detail: r.detail, count: r.count, firstAt: r.firstAt.toISOString(), lastAt: r.lastAt.toISOString() });

  function mountAdmin(app, { adminAuth, ah, rateLimit }) {
    const A = [rateLimit ? rateLimit({ windowMs: 15 * 60e3, max: 300, message: { ok: false, error: 'Too many requests. Please try again later.' } }) : (q, r, n) => n(), adminAuth];
    const json = (res, body) => { res.set('Cache-Control', 'no-store'); res.json({ ok: true, ...body }); };
    app.get('/api/admin/errors/summary', ...A, ah(async (req, res) => json(res, await summary(Math.min(24 * 7, Math.max(1, parseInt((req.query || {}).hours, 10) || 24))))));
    app.get('/api/admin/errors', ...A, ah(async (req, res) => {
      const qy = req.query || {}, level = LEVELS.has(qy.level) ? qy.level : null, q = String(qy.q || '').trim().slice(0, 80);
      const limit = Math.min(200, Math.max(1, parseInt(qy.limit, 10) || 50)), offset = Math.max(0, parseInt(qy.offset, 10) || 0);
      json(res, { errors: (await store.list({ level, q: q || null, since: qy.hours ? parseSince(qy.hours, 24) : null, limit, offset })).map(out), limit, offset });
    }));
    app.get('/api/admin/errors/:id', ...A, ah(async (req, res) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id < 1) return res.status(400).json({ ok: false, error: 'Invalid identifier.' });
      const g = await store.get(id);
      if (!g) return res.status(404).json({ ok: false, error: 'No such error.' });
      json(res, { error: { ...out(g), hits: g.hits.map(h => ({ at: h.at.toISOString(), times: h.n })) } });
    }));
  }

  return { record, hookConsole, summary, mountAdmin, store, purge: () => store.purge(new Date(now() - KEEP_DAYS * 86400e3)), list: o => store.list({ limit: 50, offset: 0, ...o }) };
}

module.exports = { createErrorLog, scrub, fingerprint, KEEP_DAYS };
