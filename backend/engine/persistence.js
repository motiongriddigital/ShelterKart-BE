'use strict';
/**
 * ShelterKart — durable storage for research.
 *
 * Everything the engine remembers used to live only in process memory,
 * so every deploy or crash wiped it. The worst consequence: a buyer who
 * paid for a report opened their link the next day and was told it was
 * "no longer available" -- the token still valid, the report gone.
 *
 * This is the durable half of a write-through design. The in-memory
 * maps in research.js stay the fast layer; every change is mirrored here
 * in the background; on startup research.js reloads from here.
 *
 * Deliberately plain SQL: upserts, TEXT[] with = ANY(), one JSONB column.
 * No extension, no JSON operators, nothing version-specific.
 *
 * Every function throws on failure. research.js decides what a failure
 * means (for a background write: log it, never break the request).
 */

const { pagesOf, hostOf } = require('./briefPages');

function makePgStore(pool) {
  return {
    async saveBrief(cacheKey, brief) {
      const urls = pagesOf(brief).map(p => p.url);
      const hosts = [...new Set(urls.map(hostOf).filter(Boolean))];
      await pool.query(
        `INSERT INTO research_briefs (ref, cache_key, brief, page_urls, page_hosts, created_at)
         VALUES ($1, $2, $3::jsonb, $4, $5, now())
         ON CONFLICT (ref) DO UPDATE SET cache_key = EXCLUDED.cache_key, brief = EXCLUDED.brief,
           page_urls = EXCLUDED.page_urls, page_hosts = EXCLUDED.page_hosts, created_at = EXCLUDED.created_at`,
        [brief.ref, cacheKey, JSON.stringify(brief), urls, hosts]);
    },

    /** Reports saved before dossiers were indexed have no cited pages on record, so a takedown could not find them: index them now. */
    async backfillPageIndex() {
      const r = await pool.query(`SELECT ref, brief FROM research_briefs WHERE cardinality(page_urls) = 0 AND brief->>'kind' = 'dossier'`);
      let n = 0;
      for (const x of r.rows) {
        const urls = pagesOf(x.brief).map(p => p.url); if (!urls.length) continue;
        await pool.query(`UPDATE research_briefs SET page_urls = $2, page_hosts = $3 WHERE ref = $1`, [x.ref, urls, [...new Set(urls.map(hostOf).filter(Boolean))]]); n++;
      }
      return n;
    },

    async getBrief(ref) {
      const r = await pool.query(`SELECT brief, created_at FROM research_briefs WHERE ref = $1`, [ref]);
      return r.rows[0] ? { brief: r.rows[0].brief, createdAt: new Date(r.rows[0].created_at) } : null;
    },

    async loadRecent(since, limit) {
      const r = await pool.query(
        `SELECT cache_key, brief, created_at FROM (
           SELECT cache_key, brief, created_at FROM research_briefs WHERE created_at > $1 ORDER BY created_at DESC LIMIT $2
         ) newest ORDER BY created_at ASC`, [since, limit]);
      return r.rows.map(x => ({ cacheKey: x.cache_key, brief: x.brief, createdAt: new Date(x.created_at) }));
    },

    async saveAlias(alias, value) {
      await pool.query(
        `INSERT INTO research_aliases (alias, cache_key, location, ambiguous, updated_at)
         VALUES ($1, $2, $3, $4, now())
         ON CONFLICT (alias) DO UPDATE SET cache_key = EXCLUDED.cache_key, location = EXCLUDED.location,
           ambiguous = EXCLUDED.ambiguous, updated_at = now()`,
        [alias, value.key, value.location || '', Boolean(value.ambiguous)]);
    },

    async loadAliases() {
      const r = await pool.query(`SELECT alias, cache_key, location, ambiguous FROM research_aliases`);
      return r.rows.map(x => ({ alias: x.alias, value: { key: x.cache_key, location: x.location || '', ...(x.ambiguous ? { ambiguous: true } : {}) } }));
    },

    async forgetKey(cacheKey) {
      await pool.query(`DELETE FROM research_aliases WHERE cache_key = $1`, [cacheKey]);
    },

    /** Legal withdrawal. Removes every stored report citing the page or
     *  host, and every alias that pointed at those reports. */
    async deleteCiting({ url, host }) {
      const r = url
        ? await pool.query(`DELETE FROM research_briefs WHERE $1 = ANY(page_urls) RETURNING cache_key`, [url])
        : await pool.query(`DELETE FROM research_briefs WHERE $1 = ANY(page_hosts) RETURNING cache_key`, [String(host).toLowerCase().replace(/^www\./, '')]);
      const keys = r.rows.map(x => x.cache_key);
      if (keys.length) await pool.query(`DELETE FROM research_aliases WHERE cache_key = ANY($1)`, [keys]);
      return keys.length;
    },

    /** Retention: reports older than the promised window are deleted, not
     *  just ignored -- the Privacy Policy states how long they are kept. */
    async pruneOlderThan(cutoff) {
      const r = await pool.query(`DELETE FROM research_briefs WHERE created_at < $1 RETURNING cache_key`, [cutoff]);
      const keys = r.rows.map(x => x.cache_key);
      if (keys.length) await pool.query(`DELETE FROM research_aliases WHERE cache_key = ANY($1)`, [keys]);
      return keys.length;
    },

    async saveHealth(market, h) {
      await pool.query(
        `INSERT INTO source_health (market, state, reason, consecutive_failures, ever_healthy, detail, last_ok_at, checked_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, now())
         ON CONFLICT (market) DO UPDATE SET state = EXCLUDED.state, reason = EXCLUDED.reason,
           consecutive_failures = EXCLUDED.consecutive_failures, ever_healthy = EXCLUDED.ever_healthy,
           detail = EXCLUDED.detail, last_ok_at = EXCLUDED.last_ok_at, checked_at = now()`,
        [market, h.state, h.reason || null, h.consecutiveFailures || 0, Boolean(h.everHealthy), h.detail || null, h.lastOkAt || null]);
      await pool.query(`INSERT INTO source_health_history (market, state, reason, detail, checked_at) VALUES ($1, $2, $3, $4, now())`, [market, h.state, h.reason || null, h.detail ? String(h.detail).slice(0, 300) : null]);
      await pool.query(`DELETE FROM source_health_history WHERE market = $1 AND checked_at < now() - interval '90 days'`, [market]);
    },

    async healthHistory(days) {
      const r = await pool.query(`SELECT market, state, reason, checked_at FROM source_health_history WHERE checked_at >= now() - ($1::int * interval '1 day') ORDER BY market, checked_at ASC`, [days]);
      return r.rows.map(x => ({ market: x.market, state: x.state, reason: x.reason || null, at: new Date(x.checked_at).toISOString() }));
    },

    async loadHealth() {
      const r = await pool.query(`SELECT market, state, reason, consecutive_failures, ever_healthy, detail, last_ok_at, checked_at FROM source_health`);
      return r.rows.map(x => ({ market: x.market, state: x.state, reason: x.reason || undefined, consecutiveFailures: x.consecutive_failures,
        everHealthy: x.ever_healthy, detail: x.detail || '', lastOkAt: x.last_ok_at ? new Date(x.last_ok_at).toISOString() : null,
        checkedAt: new Date(x.checked_at).toISOString() }));
    },

    async saveEvent(e) {
      await pool.query(
        `INSERT INTO analytics_events (at, day, event, visitor, path, channel, referrer, utm_source, utm_medium, utm_campaign,
                                       country, device, market, ref, query, value, currency, detail, lang)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
        [e.at, e.day, e.event, e.visitor, e.path, e.channel, e.referrer, e.utm_source, e.utm_medium, e.utm_campaign,
         e.country, e.device, e.market, e.ref, e.query, e.value, e.currency, e.detail, e.lang || '']);
    },

    async loadEvents(sinceIso, limit) {
      const r = await pool.query(
        `SELECT at, day, event, visitor, path, channel, referrer, utm_source, utm_medium, utm_campaign,
                country, device, market, ref, query, value, currency, detail, lang
           FROM analytics_events WHERE at >= $1 ORDER BY at ASC LIMIT $2`, [sinceIso, limit]);
      // pg returns DATE as a Date and NUMERIC as a string: normalise both
      return r.rows.map(x => ({ ...x, at: new Date(x.at).toISOString(),
        day: x.day instanceof Date ? x.day.toISOString().slice(0, 10) : String(x.day).slice(0, 10),
        value: x.value == null ? null : Number(x.value) }));
    },

    async pruneEventsOlderThan(cutoffIso) {
      await pool.query(`DELETE FROM analytics_events WHERE at < $1`, [cutoffIso]);
    },

    async saveSalt(day, salt) {
      await pool.query(`INSERT INTO analytics_salt (day, salt) VALUES ($1, $2) ON CONFLICT (day) DO UPDATE SET salt = EXCLUDED.salt`, [day, salt]);
      await pool.query(`DELETE FROM analytics_salt WHERE day <> $1`, [day]);
    },

    async loadSalt(day) {
      const r = await pool.query(`SELECT salt FROM analytics_salt WHERE day = $1`, [day]);
      return r.rows[0] ? r.rows[0].salt : null;
    },

    /** Translations already made: rows of { key, text } for the keys that exist. */
    async getTranslations(keys) {
      if (!keys.length) return [];
      const r = await pool.query(`SELECT key, text FROM translation_cache WHERE key = ANY($1)`, [keys]);
      return r.rows.map(x => ({ key: x.key, text: x.text }));
    },

    async saveTranslations(rows) {
      for (const t of rows) {
        await pool.query(
          `INSERT INTO translation_cache (key, lang, text, created_at) VALUES ($1, $2, $3, now())
           ON CONFLICT (key) DO UPDATE SET text = EXCLUDED.text, created_at = now()`, [t.key, t.lang, t.text]);
      }
    },

    async pruneTranslationsOlderThan(cutoffIso) {
      await pool.query(`DELETE FROM translation_cache WHERE created_at < $1`, [cutoffIso]);
    },

    async incrementDaily(day) {
      await pool.query(
        `INSERT INTO research_daily (day, count) VALUES ($1, 1)
         ON CONFLICT (day) DO UPDATE SET count = research_daily.count + 1`, [day]);
    },

    async loadDaily(day) {
      const r = await pool.query(`SELECT count FROM research_daily WHERE day = $1`, [day]);
      return r.rows[0] ? Number(r.rows[0].count) : 0;
    },

    /* Bulk registers (engine/bulk): what the last load of a country did, and look-ups into the loaded rows. */
    async bulkStatus(country) {
      const r = await pool.query(`SELECT country, status, detail, row_count, bytes, last_modified, started_at, finished_at FROM bulk_register_loads WHERE country = $1`, [country]);
      return r.rows[0] || null;
    },
    async bulkFind(country, keyPrefix, limit = 300) {
      const r = await pool.query(
        `SELECT reg_id, name, name_key, legal_form, registered, terminated, address FROM bulk_register_entities
          WHERE country = $1 AND name_key LIKE $2 ORDER BY name_key LIMIT $3`, [country, String(keyPrefix).replace(/[\\%_]/g, '') + '%', limit]);
      return r.rows;
    },
    async bulkGet(country, regId) {
      const r = await pool.query(
        `SELECT reg_id, name, name_key, legal_form, registered, terminated, address FROM bulk_register_entities WHERE country = $1 AND reg_id = $2`, [country, regId]);
      return r.rows[0] || null;
    },
  };
}

module.exports = { makePgStore, hostOf };
