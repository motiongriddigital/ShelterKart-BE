'use strict';
/**
 * ShelterKart — the report as a PDF, printed by a headless Chromium (Playwright) on the server.
 * Playwright is optional: where it is not installed, renderPdf throws code 'pdf_unavailable' and the page offers the
 * browser's own print-to-PDF instead. Fonts: install IBM Plex Sans and Fraunces on the server for the brand faces.
 *
 * One browser is started once and reused; each PDF gets its own context, closed afterwards. At most PDF_CONCURRENCY
 * (default 2) render at a time and the rest wait their turn, so a burst of buyers cannot exhaust the server's memory.
 * If the browser dies it is started again on the next render.
 * The page is printed with JavaScript off and every network request refused (see renderPdf).
 */
let chromium = null;
try { ({ chromium } = require('playwright')); } catch { chromium = null; }

const available = () => Boolean(chromium);
const limit = () => Math.max(1, Number(process.env.PDF_CONCURRENCY) || 2);
let active = 0; const waiting = [];
const acquire = () => (active < limit() ? (active++, Promise.resolve()) : new Promise(r => waiting.push(r)).then(() => { active++; }));
const release = () => { active--; const next = waiting.shift(); if (next) next(); };

let browserP = null;
async function browser() {
  // A package without its browser (or a browser that cannot start here) is "PDF not available", which the route answers with a 503 and guidance,
  // not an unexplained 500. Found by running the code in a container that had the package but not Chromium.
  if (!browserP) browserP = chromium.launch().catch(e => { browserP = null; throw Object.assign(new Error('the PDF browser could not be started: ' + String(e && e.message).split('\n')[0]), { code: 'pdf_unavailable' }); });
  const b = await browserP;
  if (typeof b.isConnected === 'function' && !b.isConnected()) { browserP = null; return browser(); }
  return b;
}

async function renderPdf(html, { footer = 'ShelterKart. Research, not advice.' } = {}) {
  if (!chromium) throw Object.assign(new Error('PDF printing is not installed on this server'), { code: 'pdf_unavailable' });
  await acquire();
  let context = null;
  try {
    const b = await browser();
    // The report is a self-contained page: it needs no script and no network. Everything in it is escaped text, but if an escape gap ever appeared, this
    // renderer would reach the server's internal network without the egress guard, so it is shut: no JavaScript, and every request the page makes is refused.
    context = await b.newContext({ javaScriptEnabled: false, serviceWorkers: 'block', acceptDownloads: false });
    await context.route('**/*', route => route.abort('blockedbyclient'));
    const page = await context.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    return await page.pdf({ format: 'A4', printBackground: true, margin: { top: '16mm', bottom: '18mm', left: '16mm', right: '16mm' },
      displayHeaderFooter: true, headerTemplate: '<span></span>',
      footerTemplate: `<div style="font:8px sans-serif;color:#52657F;width:100%;padding:0 16mm;display:flex;justify-content:space-between"><span>${esc(footer)}</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>` });
  } finally {
    if (context) { try { await context.close(); } catch { /* already closed */ } }
    release();
  }
}

/** For a clean shutdown and for tests. */
async function closeBrowser() { if (browserP) { try { (await browserP).close(); } catch { /* gone */ } browserP = null; } }
const queueState = () => ({ active, waiting: waiting.length, limit: limit() });

module.exports = { renderPdf, available, closeBrowser, queueState };
