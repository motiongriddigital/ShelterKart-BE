'use strict';
/** Generated custom reports, kept in memory for a day so a report can be re-fetched or turned into a PDF without
 * re-running the search. Deliberately not persisted (v1 of this pipeline): a restart loses them. */
const TTL_MS = 24 * 3600 * 1000;
const reports = new Map();

function save(report) { reports.set(report.ref, { report, at: Date.now() }); return report; }
function get(ref) { const e = reports.get(ref); return e ? e.report : null; }
function sweep(now = Date.now()) { for (const [ref, e] of reports) if (now - e.at > TTL_MS) reports.delete(ref); }

module.exports = { save, get, sweep, _reports: reports };
