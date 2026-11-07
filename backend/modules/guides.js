'use strict';
const BOT = require('../engine/botguard');             // proof-of-work before NEW research (BOT_GUARD)         // licence credits for the official registers a report used          // adverse findings held for a person (ADVERSE_HOLD_MARKETS)
const { renderDossier } = require('../engine/dossierHtml');
const PAGES = require('../engine/reportPages');
const PDF = require('../engine/pdf');
const sfs = require('fs'), spath = require('path');
const { ah } = require('../middleware/asyncHandler');
const ROOT = require('path').resolve(__dirname, '..');

module.exports = function register(app, c) {

  /* The reference reports, public: the same report a buyer receives, built from published research, so anyone can see
   * what they would get. Files: data/sample-reports/<id>.json (built by tools/build_dossier.js). PDFs are printed once. */
  const SAMPLE_REPORTS_DIR = spath.join(ROOT, 'data', 'sample-reports');
  const samplePdfCache = new Map();
  function loadSample(id) {
    if (!/^[a-z0-9-]{2,40}$/.test(id)) return null;
    try { return JSON.parse(sfs.readFileSync(spath.join(SAMPLE_REPORTS_DIR, id + '.json'), 'utf8')); } catch { return null; }
  }
  /* The free Home Buying Guide: one web page and one PDF, built by guide/build_guide.py and copied to data/guide/. */
  const GUIDE_DIR = require('path').join(ROOT, 'data', 'guide');
  const guideFile = name => { try { return require('fs').readFileSync(require('path').join(GUIDE_DIR, name)); } catch { return null; } };
  app.get('/guide', (req, res) => {
    const page = guideFile('ShelterKart-Home-Buying-Guide.html');
    if (!page) return res.status(404).json({ ok: false, error: 'The guide is not installed on this server.' });
    res.set({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=600' });
    res.send(page.toString('utf8'));
  });
  app.get('/guide/card.png', (req, res) => {
    const png = guideFile('ShelterKart-Sales-Office-Card.png');
    if (!png) return res.status(404).json({ ok: false, error: 'The card is not installed on this server.' });
    res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=3600' });
    res.send(png);
  });
  app.get('/guide/card.pdf', (req, res) => {
    const pdf = guideFile('ShelterKart-Sales-Office-Card.pdf');
    if (!pdf) return res.status(404).json({ ok: false, error: 'The card is not installed on this server.' });
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="ShelterKart-Sales-Office-Card.pdf"', 'Cache-Control': 'public, max-age=3600' });
    res.send(pdf);
  });
  app.get('/guide/pdf', (req, res) => {
    const pdf = guideFile('ShelterKart-Home-Buying-Guide.pdf');
    if (!pdf) return res.status(404).json({ ok: false, error: 'The guide PDF is not installed on this server.' });
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="ShelterKart-Home-Buying-Guide.pdf"', 'Cache-Control': 'public, max-age=3600' });
    res.send(pdf);
  });
  app.get('/samples/:id', (req, res) => {
    const d = loadSample(String(req.params.id || ''));
    res.set({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=600' });
    if (!d) return res.status(404).send(PAGES.startPage({ botGuard: BOT.enabled(process.env) }).replace('Know who you are paying, before you pay.', 'That sample was not found. Start your own report.'));
    res.send(PAGES.samplePage(d, { id: req.params.id, pdf: PDF.available() }));
  });
  app.get('/samples/:id/pdf', ah(async (req, res) => {
    const id = String(req.params.id || ''), d = loadSample(id);
    if (!d) return res.status(404).json({ ok: false, error: 'No such sample.' });
    try {
      if (!samplePdfCache.has(id)) samplePdfCache.set(id, await PDF.renderPdf(renderDossier(d), { footer: `ShelterKart sample report: ${(d.project && d.project.name) || d.query}. Research, not advice.` }));
      const name = 'ShelterKart-Sample-' + String((d.project && d.project.name) || id).replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') + '.pdf';
      res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${name}"`, 'Cache-Control': 'public, max-age=3600' });
      res.send(samplePdfCache.get(id));
    } catch (e) {
      if (e && e.code === 'pdf_unavailable') return res.status(503).json({ ok: false, error: 'PDF download is not available yet. Open the sample and use your browser\'s print to save a PDF.' });
      throw e;
    }
  }));
};
