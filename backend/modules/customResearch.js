'use strict';
/**
 * The custom report pipeline's routes: Tavily search + Groq formatting (backend/custom/*), kept deliberately
 * separate from the existing /api/research and /api/investigate routes and their multi-engine pipeline.
 */
const bodyGuard = require('../middleware/body');
const { ah } = require('../middleware/asyncHandler');
const CUSTOM_REPORT = require('../custom/customReport');
const STORE = require('../custom/customStore');
const { renderReportHtml } = require('../custom/reportHtml');
const { renderPdf } = require('../engine/pdf');

const ERROR_STATUS = { invalid_query: 400, tavily_unconfigured: 503, tavily_unreachable: 502, tavily_error: 502, groq_unconfigured: 503, groq_unreachable: 502, groq_error: 502, groq_empty: 502, groq_bad_json: 502 };
const fail = (res, e) => res.status(ERROR_STATUS[e.code] || 500).json({ ok: false, code: e.code || 'custom_report_failed', error: e.message });

module.exports = function register(app) {
  setInterval(() => STORE.sweep(), 3600e3).unref();

  app.post('/api/custom/research', bodyGuard.json({ limit: '4kb' }), ah(async (req, res) => {
    const { query, location, market, tier } = req.body || {};
    let report;
    try { report = await CUSTOM_REPORT.generate({ query, location, market, tier }); }
    catch (e) { return fail(res, e); }
    STORE.save(report);
    res.json(report);
  }));

  app.get('/api/custom/research/:ref', ah(async (req, res) => {
    const report = STORE.get(req.params.ref);
    if (!report) return res.status(404).json({ ok: false, code: 'not_found', error: 'No report found for that reference.' });
    res.json(report);
  }));

  app.get('/api/custom/research/:ref/pdf', ah(async (req, res) => {
    const report = STORE.get(req.params.ref);
    if (!report) return res.status(404).json({ ok: false, code: 'not_found', error: 'No report found for that reference.' });
    let buf;
    try { buf = await renderPdf(renderReportHtml(report)); }
    catch (e) { return res.status(e.code === 'pdf_unavailable' ? 503 : 500).json({ ok: false, code: e.code || 'pdf_failed', error: e.message }); }
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${report.ref}.pdf"` });
    res.send(buf);
  }));
};
