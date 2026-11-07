/**
 * ShelterKart Backend: entry point.
 * The app itself is assembled in app.js (shared services, request pipeline, feature modules);
 * this file loads the environment, exports the app for the tests, and starts the server.
 * See docs/backend-structure.md for the folder layout.
 */
require('dotenv').config();
const { app, c } = require('./app');
const express = require('express');
const { hydrate } = require('./engine/research');
const ANALYTICS = require('./engine/analytics');
const HEALTH = require('./engine/health');
const { adminAuth } = require('./middleware/adminAuth');
const { ah } = require('./middleware/asyncHandler');
const { ACCOUNTS, BACKUPS, BULK_SPECS, ENGINE_HISTORY, ERRORLOG, pgStore, pool, runBulk, runSourceHealth } = c;

const PORT = process.env.PORT || 4000;
if (require.main === module) {
  // Refuse to start a misconfigured production server (engine/configCheck.js); elsewhere the same findings are printed as advice.
  const config = require('./engine/configCheck').check(process.env);
  for (const w of config.warnings) console.warn('[config] ' + w);
  if (config.errors.length) {
    console.error('[config] this server will not start in production until these are fixed:\n - ' + config.errors.join('\n - '));
    process.exit(1);
  }
  // Reload recent reports before accepting traffic. A storage failure is
  // logged and the server still starts: report links fall back to reading
  // storage on demand, so buyers are not locked out while it recovers.
  (async () => {
    try {
      const h = await hydrate();
      if (pgStore) {
        const day = ANALYTICS.today();
        const salt = await pgStore.loadSalt(day);
        if (salt) ANALYTICS.loadSalt(day, salt);                         // a mid-day restart must not double-count visitors
        await pgStore.pruneEventsOlderThan(new Date(Date.now() - 400 * 86400000).toISOString());
        await pgStore.pruneTranslationsOlderThan(new Date(Date.now() - 90 * 86400000).toISOString());
      }
      if (process.env.DATABASE_URL) console.log(`[persistence] restored ${h.reports} report(s), ${h.aliases} alias(es); ${h.dailyCount || 0} new research run(s) today`);
      else console.warn('[persistence] DATABASE_URL not set: reports live in memory only and are lost on restart.');
    } catch (e) {
      console.error('[persistence] startup reload failed, starting with empty memory:', e && e.message);
    }
    // The marketing desk (backend/social): plans, checks, packs and publishes the daily posts for all 36 markets. It is OFF unless
    // SOCIAL_ENGINE=on, posts nothing real unless SOCIAL_PUBLISH=live, and refuses to run without durable storage. Its routes answer 503 while off.
    let social = null;
    try {
      social = await require('./social').createSocial({ env: process.env, pool: process.env.DATABASE_URL ? pool : null });
      social.mount(app, { adminAuth, ah, jsonParser: express.json({ limit: '20kb' }) });
      if (social.start()) console.log('[social] the marketing desk is running');
    } catch (e) { console.error('[social] the marketing desk did not start: ' + (e && e.message)); }
    // The marketing dashboard (backend/marketing): the weekly numbers per market, early warnings and decision triggers from the
    // launch strategy, read from analytics, refunds, replies and the desk. Read-only except for the founder's own inputs.
    try {
      require('./marketing').mount(app, { adminAuth, ah, jsonParser: express.json({ limit: '20kb' }), loadRows: since => ANALYTICS.loadRows(since, 250000), pool: process.env.DATABASE_URL ? pool : null, social });
    } catch (e) { console.error('[marketing] the dashboard did not start: ' + (e && e.message)); }
    // Run the nightly source-health check on ONE instance only
    // (SOURCE_HEALTH_SCHEDULE=true); run several and each would alert.
    if (process.env.SOURCE_HEALTH_SCHEDULE === 'true') {
      HEALTH.startSchedule(runSourceHealth, { hours: Number(process.env.SOURCE_HEALTH_HOURS) || 24 });
      console.log('[source-health] scheduled: first run in a minute, then every ' + (Number(process.env.SOURCE_HEALTH_HOURS) || 24) + 'h');
    }
    // The bulk registers (Latvia): ONE instance downloads each country's open-data file once a day (BULK_REGISTERS_SCHEDULE=true).
    if (process.env.BULK_REGISTERS_SCHEDULE === 'true') {
      const bulkRun = async () => { for (const country of Object.keys(BULK_SPECS)) { try { const r = await runBulk(country); console.log(`[bulk ${country}] ${r.status}${r.detail ? ': ' + r.detail : ''}${r.rows ? ' (' + r.rows + ' rows)' : ''}`); } catch (e) { console.error(`[bulk ${country}] run failed:`, e && e.message); } } };
      setTimeout(() => { bulkRun(); setInterval(bulkRun, 24 * 3600 * 1000).unref(); }, 120000).unref();
      console.log('[bulk] scheduled: first run in two minutes, then every 24h');
    }
    if (ACCOUNTS.problems.length) {
      console.error('[accounts] configuration problems:\n - ' + ACCOUNTS.problems.join('\n - '));
      if (process.env.NODE_ENV === 'production') process.exit(1);
    }
    setInterval(() => ENGINE_HISTORY.purge().catch(e => console.error('[engine-history] clean-up failed:', e && e.message)), 24 * 3600 * 1000).unref();
    for (const sig of ['SIGTERM', 'SIGINT']) process.once(sig, () => { ENGINE_HISTORY.flush().catch(() => {}).finally(() => process.exit(0)); });   // write the counts held for a moment before stopping
    BACKUPS.startSchedule();
    setInterval(() => ERRORLOG.purge().catch(e => console.error('[errorlog] clean-up failed:', e && e.message)), 24 * 3600 * 1000).unref();
    if (ACCOUNTS.enabled) setInterval(() => ACCOUNTS.cleanup().catch(e => console.error('[accounts] clean-up failed:', e && e.message)), 6 * 3600 * 1000).unref();
    app.listen(PORT, () => console.log(`ShelterKart API listening on port ${PORT}`));
  })();
}

module.exports = app;
