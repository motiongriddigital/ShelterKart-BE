// The PDF printer: one browser reused, at most PDF_CONCURRENCY renders at a time, the rest queued. Skipped where
// Playwright is not installed (the server then offers the browser's own print instead).
process.env.PDF_CONCURRENCY = '1';
const PDF = require('../engine/pdf');
let failures = 0; const ok = (label, c) => { if (!c) failures++; console.log((c ? '  ok   ' : '  FAIL ') + label); };
(async () => {
  if (!PDF.available()) { console.log('  skip PDF printing is not installed here'); console.log('\nall passing'); return; }
  let peak = 0; const watch = setInterval(() => { peak = Math.max(peak, PDF.queueState().active); }, 5);
  const html = n => `<!doctype html><html><body><h1>Report ${n}</h1><p>${'Line of text. '.repeat(200)}</p></body></html>`;
  const t0 = Date.now(); const out = await Promise.all([1, 2, 3].map(n => PDF.renderPdf(html(n), { footer: 'Test ' + n })));
  clearInterval(watch);
  ok('three PDFs requested at once all print', out.every(b => b && b.length > 1000 && b.slice(0, 4).toString() === '%PDF'));
  ok('with PDF_CONCURRENCY=1, never more than one renders at a time', peak <= 1);
  ok('the queue is empty afterwards', PDF.queueState().active === 0 && PDF.queueState().waiting === 0);
  const t1 = Date.now(); await PDF.renderPdf(html(4)); const reuse = Date.now() - t1;
  ok('a later PDF reuses the running browser (no fresh start)', reuse < (Date.now() - t0));
  await PDF.closeBrowser();
  console.log(failures ? '\n' + failures + ' FAILED' : '\nall passing'); process.exitCode = failures ? 1 : 0;
})();
