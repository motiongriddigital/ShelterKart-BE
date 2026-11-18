'use strict';
/** Renders a custom report (customReport.js's shape) as a self-contained HTML page, for the PDF printer
 * (engine/pdf.js) or for showing the report in a browser. Escapes everything: every value here came from an
 * AI model's output, not trusted markup. */
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const linkOf = url => /^https?:\/\//i.test(url) ? `<a href="${esc(url)}">${esc(url)}</a>` : esc(url);

function renderReportHtml(report) {
  const keyFacts = (report.keyFacts || []).map(f => `
    <li><strong>${esc(f.label)}:</strong> ${esc(f.value)} ${f.sourceUrl ? `<span class="src">(${linkOf(f.sourceUrl)})</span>` : ''}</li>`).join('\n');

  const differences = (report.differences || []).map(d => `
    <section class="diff">
      <h2>${esc(d.title)} <span class="cat">${esc(d.category)}</span></h2>
      <p><strong>Seller says:</strong> ${esc(d.sellerClaim.value)} - ${esc(d.sellerClaim.detail)} ${d.sellerClaim.sourceUrl ? `<span class="src">(${linkOf(d.sellerClaim.sourceUrl)})</span>` : ''}</p>
      <p><strong>Official record:</strong> ${esc(d.officialRecord.value)} - ${esc(d.officialRecord.detail)} <span class="src">(${linkOf(d.officialRecord.sourceUrl)})</span></p>
      <p class="impact">${esc(d.impact)}</p>
    </section>`).join('\n');

  const questions = (report.questions || []).map(q => `
    <li class="q ${q.priority === 'top' ? 'top' : ''}">
      <strong>${esc(q.category)}:</strong> ${esc(q.question)}<br>
      <span class="why">Why it matters: ${esc(q.whyItMatters)}</span><br>
      <span class="good">Good answer: ${esc(q.goodAnswer)}</span><br>
      <span class="flag">Be careful if: ${esc(q.redFlag)}</span>
    </li>`).join('\n');

  const pricing = (report.pricing || []).length ? `
    <table class="pricing">
      <tr><th>Type</th><th>Size</th><th>Quoted</th><th>Benchmark</th><th>Difference</th></tr>
      ${report.pricing.map(p => `<tr><td>${esc(p.label)}</td><td>${esc(p.size)}</td><td>${esc(p.quotedPrice)}</td><td>${esc(p.benchmarkPrice)}</td><td>${esc(p.differenceNote)}</td></tr>`).join('\n')}
    </table>` : '';

  const sources = (report.sources || []).map(s => `<li>[${esc(s.status)}] ${esc(s.name)} - ${esc(s.detail)} ${linkOf(s.url)}</li>`).join('\n');

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
  .cat { font-size: 11px; font-weight: normal; color: #52657F; }
  .impact { font-style: italic; color: #52657F; }
  .q { margin-bottom: 10px; } .q.top { font-weight: 600; }
  .why, .good, .flag { font-size: 12px; font-weight: normal; color: #3a4a5c; }
  table.pricing { width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 8px; }
  table.pricing th, table.pricing td { border: 1px solid #d7dee6; padding: 4px 8px; text-align: left; }
  .disclaimer { margin-top: 24px; font-size: 10px; color: #8a97a6; }
</style>
</head>
<body>
  <span class="tier">${esc(report.tier)} report</span>
  <h1>${esc(report.query)}</h1>
  <p>${esc(report.summary)}</p>
  ${report.highlights && report.highlights.length ? `<ul class="highlights">${report.highlights.map(h => `<li>${esc(h)}</li>`).join('')}</ul>` : ''}
  ${keyFacts ? `<h2>Key facts</h2><ul>${keyFacts}</ul>` : ''}
  ${differences ? `<h2>Where the brochure and the official record disagree</h2>${differences}` : ''}
  ${questions ? `<h2>Questions to ask before you pay</h2><ul>${questions}</ul>` : ''}
  ${pricing ? `<h2>The numbers, checked</h2>${pricing}` : ''}
  ${sources ? `<h2>Sources</h2><ul class="sources">${sources}</ul>` : ''}
  <p class="disclaimer">Generated automatically from public web search results (Tavily) and summarized by AI (Groq). This is research, not advice - verify independently before relying on it.</p>
</body>
</html>`;
}

module.exports = { renderReportHtml };
