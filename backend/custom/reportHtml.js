'use strict';
/** Renders a custom report (customReport.js's shape) as a self-contained HTML page, for the PDF printer
 * (engine/pdf.js) or for showing the report in a browser. Escapes everything: every value here came from an
 * AI model's output, not trusted markup. */
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const linkOf = url => /^https?:\/\//i.test(url) ? `<a href="${esc(url)}">${esc(url)}</a>` : esc(url);

function renderReportHtml(report) {
  const sections = (report.sections || []).map(s => `
    <section>
      <h2>${esc(s.heading)}</h2>
      <p>${esc(s.body)}</p>
      ${s.sourceUrls && s.sourceUrls.length ? `<p class="src">Sources: ${s.sourceUrls.map(linkOf).join(', ')}</p>` : ''}
    </section>`).join('\n');

  const sources = (report.sources || []).map(s => `<li>${esc(s.title)} - ${linkOf(s.url)}</li>`).join('\n');

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${esc(report.query)} - property research</title>
<style>
  body { font-family: sans-serif; color: #1a2330; margin: 0; padding: 24px; }
  h1 { font-size: 20px; } h2 { font-size: 15px; margin-top: 20px; }
  .tier { display: inline-block; font-size: 11px; text-transform: uppercase; color: #52657F; }
  .highlights li { margin-bottom: 4px; }
  .src, .sources { font-size: 11px; color: #52657F; }
  .disclaimer { margin-top: 24px; font-size: 10px; color: #8a97a6; }
</style>
</head>
<body>
  <span class="tier">${esc(report.tier)} report</span>
  <h1>${esc(report.query)}</h1>
  <p>${esc(report.summary)}</p>
  ${report.highlights && report.highlights.length ? `<ul class="highlights">${report.highlights.map(h => `<li>${esc(h)}</li>`).join('')}</ul>` : ''}
  ${sections}
  ${sources ? `<h2>Sources</h2><ul class="sources">${sources}</ul>` : ''}
  <p class="disclaimer">Generated automatically from public web search results (Tavily) and summarized by AI (Groq). Verify independently before relying on it. Research, not advice.</p>
</body>
</html>`;
}

module.exports = { renderReportHtml };
