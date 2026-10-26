'use strict';
/**
 * ShelterKart — the report as a document (screen and A4 print/PDF), in two forms:
 *
 *   renderDossier(d)            the full paid report: cover, contents, one-glance summary, promise versus record,
 *                               the questions that matter most, reasoning, disagreements, the numbers checked,
 *                               every finding with its link, every question by stage, a tracker, what we could
 *                               not reach, sources, and notes on how to read it.
 *   renderPreview(d, { price }) the free first look a buyer sees before paying: what we found, three questions
 *                               in full, what the full report adds, and the price.
 *
 * The questions are the product, so they lead. Every finding shows where it appears and its status. Inferences
 * show their reasoning. The page never tells the buyer whether to buy.
 */
const D = require('./dossier');

const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const link = (url, text) => `<a href="${esc(url)}" rel="noopener noreferrer">${esc(text || D.host(url))}</a>`;
const LABEL = { verified: 'Verified at an official source', reported: 'Reported, with link', claim: "Developer's own claim", inference: 'Our inference', conflict: 'Sources disagree' };
const ID = s => `<span class="id">${esc(s)}</span>`;
const BOXES = '<span class="trk"><span class="box"></span>Asked <span class="box"></span>Answered <span class="box"></span>Document in hand</span>';
const rupees = n => '₹' + Number(n).toLocaleString('en-IN');
const cap = s => String(s).charAt(0).toUpperCase() + String(s).slice(1);
/** "the legal team", but "your own lawyer": a team name with its article. */
const who = t => (/^(your|the)\b/i.test(String(t)) ? String(t) : 'the ' + t);
const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const longDate = iso => { const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${Number(m[3])} ${MONTH[Number(m[2]) - 1]} ${m[1]}` : String(iso || ''); };

/** A readable label for a page with no title: its site and the meaningful end of its path. */
function shortUrl(url) {
  try {
    const u = new URL(url); const tail = decodeURIComponent(u.pathname).replace(/\/+$/, '').split('/').filter(Boolean).slice(-2).join('/');
    const raw = tail || u.search.replace(/^\?/, ''); const t = raw.length > 56 ? raw.slice(0, 55) + '…' : raw;
    return u.hostname.replace(/^www\./, '') + (t ? ' / ' + t : '');
  } catch { return url; }
}
/** The first sentence of a question, for the tracker and the preview lists. */
function firstSentence(q, max = 150) {
  const t = String(q).replace(/\s+/g, ' ').trim(); const m = t.match(/^(.+?[.?])(\s|$)/); const s = m ? m[1] : t;
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1), sp = cut.lastIndexOf(' ');
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:.-]+$/, '') + '…';
}
const sourcesLine = (srcs = []) => (srcs.length ? `<p class="where">Where it appears: ${srcs.slice(0, 6).map(s => link(s.url, shortUrl(s.url))).join(', ')}${srcs.length > 6 ? ` and ${srcs.length - 6} more` : ''}${srcs.some(s => s.seen === false) ? ' <span class="note">(a cited link the search did not return; open it to check)</span>' : ''}</p>` : '');

/** One question in full, with how it is closed and a place to track it. */
function question(q, { track = true } = {}) {
  return `<li class="q" id="${esc(q.id)}">
  <p class="q-head">${ID(q.id)} <span class="q-to">Ask ${esc(who(q.to))}, ${esc(q.when)}</span></p>
  <p class="q-text">${esc(q.question)}</p>
  ${q.why ? `<p class="q-why"><b>Why it matters.</b> ${esc(q.why)}</p>` : ''}
  ${q.good || q.notAccepted ? `<dl class="q-test">${q.good ? `<dt>A good answer</dt><dd>${esc(q.good)}</dd>` : ''}${q.notAccepted ? `<dt>Does not close it</dt><dd>${esc(q.notAccepted)}</dd>` : ''}</dl>` : ''}
  ${sourcesLine(q.sources)}
  ${track ? `<p class="trk-line">${BOXES}</p>` : ''}
</li>`;
}
/** A compact question for "start here": who to ask, the question, why. */
function questionCompact(q) {
  return `<li class="qc"><p class="q-head">${ID(q.id)} <span class="q-to">Ask ${esc(who(q.to))}, ${esc(q.when)}</span></p><p class="q-text">${esc(q.question)}</p>${q.why ? `<p class="q-why">${esc(q.why)}</p>` : ''}</li>`;
}
function fact(f, ref) {
  const st = f.inConflict ? 'conflict' : f.status;
  return `<li class="f st-${st}"><p class="f-text">${ID(f.id)} ${esc(f.claim)}</p><p class="f-status">${esc(LABEL[st])}${f.foundBy && f.foundBy.length > 1 ? `, found by ${f.foundBy.length} engines` : ''}</p>${sourcesLine(f.sources)}<p class="f-reply"><a href="#" data-reply="${esc(f.id)}" data-ref="${esc(ref || '')}" data-claim="${esc(f.claim)}">Developer Right of Reply</a></p></li>`;
}
const promiseCard = p => `<div class="pr"><p class="pr-label">${esc(p.label)}</p><div class="pr-grid"><div class="pr-a"><span>Promised or marketed</span><p>${esc(p.promise)}</p></div><div class="pr-b"><span>The record shows</span><p>${esc(p.record)}</p></div></div>${p.note ? `<p class="pr-note">${esc(p.note)}</p>` : ''}</div>`;

const CSS = `
:root{--ink:#0A1C33;--ink-2:#2F4460;--ink-3:#52657F;--paper:#FAF8F5;--rule:#E4DDD1;--gold:#B8892F;--gold-deep:#8A6321;--gold-wash:#FBF6EA;
--v:#1D6338;--r:#865E1D;--cl:#3B5B85;--inf:#0A2243;--inf-bg:#EEF1F6;--cf:#A32B1C;--cf-bg:#F7E3DF}
*{box-sizing:border-box}
html{-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.55 'IBM Plex Sans','Carlito','Liberation Sans',system-ui,-apple-system,'Segoe UI',sans-serif}
main{max-width:46rem;margin:0 auto;padding:0 1.5rem 4rem}
h1,h2,h3{font-family:'Fraunces',Georgia,'Liberation Serif',serif;font-weight:600;color:var(--ink);line-height:1.2}
h2{font-size:1.5rem;margin:3.2rem 0 .8rem;padding-top:1.1rem;border-top:1px solid var(--rule)}
h3{font-size:1.12rem;margin:1.4rem 0 .4rem}
a{color:var(--ink-2);text-decoration-color:var(--gold);text-underline-offset:2px}
a:focus-visible{outline:2px solid var(--gold-deep);outline-offset:2px}
p{margin:.4rem 0}
.meta{color:var(--ink-3);font-size:.92rem}.note{color:var(--ink-3);font-style:italic}
.id{font-family:'IBM Plex Mono','Liberation Mono',ui-monospace,monospace;font-size:.78em;color:var(--gold-deep);margin-right:.35rem}
ul.plain,ol.plain{list-style:none;margin:0;padding:0}
.cover{padding:3.2rem 0 2.4rem;border-bottom:1px solid var(--rule);margin-bottom:1rem}
.cover .brand{font-family:'Fraunces',Georgia,serif;font-size:1.25rem;color:var(--gold-deep);margin:0}
.cover .kind{color:var(--ink-3);margin:.1rem 0 0;font-size:.95rem}
.cover-main{margin:5.5rem 0 4.5rem}
.cover h1{font-size:3.1rem;margin:0 0 .5rem;letter-spacing:-.015em;line-height:1.05}
.cover .where{font-size:1.15rem;color:var(--ink-2);margin:0 0 1.6rem}
.cover .pitch{font-family:'Fraunces',Georgia,serif;font-size:1.5rem;line-height:1.3;color:var(--ink);max-width:34rem;border-left:3px solid var(--gold);padding-left:1.1rem;margin:0}
.cover dl{display:grid;grid-template-columns:8.5rem 1fr;gap:.3rem 1rem;margin:0 0 1.3rem;font-size:.95rem}
.cover dt{color:var(--ink-3)}.cover dd{margin:0;font-weight:500}
.cover .small{font-size:.85rem;color:var(--ink-3);max-width:36rem}
.toc{list-style:none;margin:.6rem 0 0;padding:0}
.toc li{display:flex;align-items:baseline;gap:.5rem;padding:.38rem 0;border-bottom:1px dotted var(--rule)}
.toc a{text-decoration:none;color:var(--ink);flex:1}.toc .pg{color:var(--ink-3);font-variant-numeric:tabular-nums}.toc .ds{display:block;color:var(--ink-3);font-size:.85rem}
.howto{background:var(--gold-wash);padding:1rem 1.2rem;margin:1.8rem 0 0;font-size:.95rem;border-left:3px solid var(--gold)}
.legend{display:grid;grid-template-columns:1fr 1fr;gap:.45rem 1.4rem;font-size:.86rem;color:var(--ink-2);margin:1.2rem 0 0;padding:0;list-style:none}
.legend li{padding-left:.7rem;border-left:3px solid var(--rule)}
.legend .lv{border-color:var(--v)}.legend .lr{border-color:#C99A3F}.legend .lc{border-color:#6E8CB3}.legend .li{border-color:var(--inf)}.legend .lf{border-color:var(--cf)}
.glance{width:100%;border-collapse:collapse;font-size:.95rem;margin:.6rem 0}
.glance th{width:11rem;text-align:left;font-weight:500;color:var(--ink-3);vertical-align:top;padding:.36rem .8rem .36rem 0;border-bottom:1px solid var(--rule)}
.glance td{vertical-align:top;padding:.36rem 0;border-bottom:1px solid var(--rule)}
.glance .cfl{display:inline-block;font-size:.74rem;color:var(--cf);background:var(--cf-bg);padding:.02rem .4rem;margin-left:.3rem;white-space:nowrap}
.glance td div{margin:.05rem 0}
.prs{display:grid;gap:.6rem;margin:.6rem 0}
.pr{border:1px solid var(--rule);background:#fff;padding:.6rem 1rem;break-inside:avoid}
.pr-label{margin:0 0 .25rem;font-size:.8rem;color:var(--gold-deep);font-weight:600}
.pr-grid{display:grid;grid-template-columns:1fr 1fr;gap:0}
.pr-a,.pr-b{padding:.15rem 1rem .15rem 0}
.pr-b{border-left:2px solid var(--gold);padding-left:1rem}
.pr-a span,.pr-b span{font-size:.78rem;color:var(--ink-3)}
.pr-a p{color:var(--ink-3);font-size:1rem;margin:0}
.pr-b p{color:var(--ink);font-weight:600;font-size:1rem;margin:0}
.pr-note{font-size:.86rem;color:var(--ink-2);margin:.35rem 0 0}
.q,.qc{padding:1rem 0 1.05rem;border-bottom:1px solid var(--rule);break-inside:avoid}
.q-head{margin:0;font-size:.86rem;color:var(--ink-3)}.q-to{font-weight:500}
.q-text{font-size:1.05rem;font-weight:500;margin:.25rem 0 .4rem}
.q-why{color:var(--ink-2);font-size:.93rem}
.q-test{display:grid;grid-template-columns:9.5rem 1fr;gap:.2rem 1rem;margin:.5rem 0 0;font-size:.92rem}.q-test dt{color:var(--ink-3)}.q-test dd{margin:0}
.where{font-size:.84rem;color:var(--ink-3);margin-top:.35rem;overflow-wrap:anywhere}
.trk-line{margin:.55rem 0 0;font-size:.82rem;color:var(--ink-3)}
.trk{display:inline-flex;align-items:center;gap:.35rem}
.box{display:inline-block;width:.78rem;height:.78rem;border:1.3px solid var(--ink-3);border-radius:2px;vertical-align:-.1em;margin-right:.1rem}
.f{padding:.6rem 0 .65rem .9rem;border-left:3px solid var(--rule);margin:.55rem 0;break-inside:avoid}
.f-text{margin:0}.f-status{margin:.15rem 0 0;font-size:.82rem;font-weight:500}
.st-verified{border-color:var(--v)}.st-verified .f-status{color:var(--v)}
.st-reported{border-color:#C99A3F}.st-reported .f-status{color:var(--r)}
.st-claim{border-color:#6E8CB3}.st-claim .f-status{color:var(--cl)}
.st-conflict{border-color:var(--cf)}.st-conflict .f-status{color:var(--cf)}
.inf{background:var(--inf-bg);padding:.95rem 1.1rem;margin:.9rem 0;break-inside:avoid;border-left:3px solid var(--inf)}
.inf ol{margin:.5rem 0 0;padding-left:1.2rem}.inf li{margin:.2rem 0}.inf .kind{font-size:.82rem;color:var(--inf);font-weight:600;margin:0}
table{width:100%;border-collapse:collapse;font-size:.9rem;margin:.6rem 0}
th,td{text-align:left;vertical-align:top;padding:.45rem .6rem .45rem 0;border-bottom:1px solid var(--rule)}th{font-weight:500;color:var(--ink-3)}
.wrap{overflow-x:auto}
table.tk{font-size:.82rem}table.tk td.n{white-space:nowrap}table.tk .bx{white-space:nowrap}
.lock{border:1px solid var(--rule);background:#fff;padding:1.1rem 1.3rem;margin:1rem 0;break-inside:avoid}
.lock h3{margin:.1rem 0 .5rem}.lock ul{margin:.4rem 0 0;padding-left:1.1rem}.lock li{margin:.25rem 0}
.guide-box{border:1px solid var(--rule,#E4DDD1);border-left:4px solid #D3A245;background:#FBF6EA;padding:1rem 1.2rem;margin:1.4rem 0;break-inside:avoid}
.guide-box .gk{font-size:.72rem;letter-spacing:.14em;text-transform:uppercase;color:#8A6321;font-weight:700;margin:0 0 .3rem}
.guide-box h3{margin:0 0 .3rem;font-size:1.1rem}.guide-box p{margin:.25rem 0}.guide-box a{color:var(--ink);font-weight:600}
.f-reply{margin:6px 0 0;font-size:.82rem}.f-reply a{color:var(--ink-2);text-decoration:underline;text-underline-offset:2px}
.unlock{background:var(--ink);color:#fff;padding:1.4rem 1.6rem;margin:1.6rem 0;break-inside:avoid}
.unlock h3{color:#fff;margin:0 0 .4rem;font-size:1.3rem}.unlock p{color:#dfe5ee;margin:.3rem 0}
.unlock .price{font-family:'Fraunces',Georgia,serif;font-size:2.1rem;color:#F2DCA8;margin:.4rem 0}
.unlock .btn{display:inline-block;background:#F2DCA8;color:var(--ink);font-weight:600;padding:.6rem 1.2rem;margin-top:.5rem;text-decoration:none}
.notice{margin-top:2.4rem;font-size:.85rem;color:var(--ink-3)}
@media print{.guide-box{display:none}
 body{background:#fff;font-size:10.3pt}main{max-width:none;padding:0}
 h2{break-after:avoid;margin-top:2.2rem}h3{break-after:avoid}a{color:var(--ink)}
 .cover{height:252mm;display:flex;flex-direction:column;justify-content:space-between;padding:0;margin:0;border:0;break-after:page}
 .cover-main{margin:0}
 .pagebreak{break-before:page}
}
@media (max-width:40rem){.cover h1{font-size:2.2rem}.q-test{grid-template-columns:1fr}.pr-grid,.legend{grid-template-columns:1fr}.pr-b{border-left:0;border-top:2px solid var(--gold);padding:.5rem 0 0;margin-top:.4rem}}
`;

const SECTIONS = [
  ['glance', 'At a glance', 'Who sells it, the key dates and numbers, and where the marketing and the record part ways'],
  ['start', 'Start here: the questions that matter most', 'The eight to put first'],
  ['reasoning', 'What the facts add up to', 'Conclusions from connecting the facts, with the reasoning'],
  ['conflicts', 'Where sources disagree', 'Each version, side by side'],
  ['numbers', 'The numbers, checked', 'Areas, dates, delay cost and prices'],
  ['findings', 'What we found', 'Every finding, with where it appears and its status'],
  ['allq', 'Every question, by stage', 'The full list, to put to each team in writing'],
  ['tracker', 'Your question tracker', 'One page to tick off as answers and documents arrive'],
  ['unreached', 'What we could not reach, and how you can', 'Records that are not online'],
  ['sources', 'Sources', 'Every page we relied on'],
  ['about', 'About this report', 'How to read it, and what it is not'],
];

/* Page header. Every report and preview is private or a sales page, so it is not indexed. A published sample is indexed
   on purpose (indexable: true). Share tags describe the page without any finding, so a shared link shows only the title. */
const SHARE_DESC = 'Questions to ask before you pay, with each finding linked to its public source. Research, not advice.';
const headOf = (title, { indexable = false } = {}) => {
  const base = String(process.env.PUBLIC_BASE_URL || process.env.SITE_URL || '').replace(/\/+$/, '');
  const img = base ? `<meta property="og:image" content="${esc(base + '/share-card.png')}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">` : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(SHARE_DESC)}">
<meta property="og:type" content="website"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(SHARE_DESC)}">${img}
<meta name="twitter:card" content="summary_large_image">
${indexable ? '' : '<meta name="robots" content="noindex,nofollow">'}
<style>${CSS}</style></head><body><main>`;
};
const head = (title, opts) => headOf(title, opts);

/** A short, plain pointer to the free Home Buying Guide. The links carry data-guide so the website opens its own reader. */
function guideBox() {
  return `<aside class="guide-box"><p class="gk">Free guide</p><h3>The ShelterKart Home Buying Guide</h3>
<p>What to check, what to ask, and what a good answer sounds like, chapter by chapter, for any property in any country.</p>
<p><a href="/guide#ch2" data-guide="ch2">Who is actually selling to you</a> &middot; <a href="/guide#ch6" data-guide="ch6">The possession date</a> &middot; <a href="/guide" data-guide="">The whole guide</a> &middot; <a href="/guide/pdf" data-guide-pdf>PDF</a></p></aside>`;
}

function renderDossier(d, { title = 'ShelterKart due-diligence report', pages = {}, indexable = false } = {}) {
  const p = d.project || {}, name = p.name || d.query, c = d.counts || {};
  const top = d.questions.slice(0, 8);
  // The record, counted: how the findings stand, from the report's own counts. No overall number is given.
  // A count the report does not hold is shown as a dash, never as a guess.
  const n = v => (v == null ? '\u2014' : String(v));
  const official = c.confirmed != null ? c.confirmed : c.verified;
  const disputed = c.disputed != null ? c.disputed : c.conflicts;
  const sourcesCount = c.sources != null ? c.sources : (d.pages || []).length;
  const ledgerRows = [
    ['Confirmed at an official source', n(official)],
    ['Reported by several independent sites', n(c.reported)],
    ['Single source', n(c.single)],
    ['The developer\u2019s own claim', n(c.developer)],
    ['Sources disagree', n(disputed)],
    ['Questions to put to the developer', String((d.questions || []).length)],
  ];
  const ledgerHtml = `<section class="ledger" aria-label="The record, counted"><h2 id="sec-ledger" style="margin-top:0">The record, counted</h2>
<table class="glance"><tbody>${ledgerRows.map(([k, v]) => `<tr><th scope="row">${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</tbody></table>
<p class="small">Counted from the findings below, read on ${esc(longDate(d.asOf))} from ${esc(n(sourcesCount))} sources. A dash means the record does not hold that count. Every finding links to its source.</p></section>`;
  const byStage = D.WHEN.map(w => ({ w, qs: d.questions.filter(q => q.when === w) })).filter(x => x.qs.length);
  const area = d.checks && d.checks.area, delay = d.checks && d.checks.delay, gaps = (d.checks && d.checks.gaps) || [], prices = (d.checks && d.checks.prices) || [];
  const has = { glance: (d.glance || []).length || (d.promises || []).length, start: top.length, reasoning: d.inferences.length, conflicts: d.conflicts.length,
    numbers: area || gaps.length || delay || prices.length, findings: d.sections.length, allq: d.questions.length, tracker: d.questions.length,
    unreached: d.unreachable && d.unreachable.length, sources: d.sources.length, about: true };
  const toc = SECTIONS.filter(([id]) => has[id]);
  const H = (id, t) => `<h2 id="sec-${id}">${esc(t)}</h2>`;
  const team = {}; for (const q of d.questions) team[q.to] = (team[q.to] || 0) + 1;
  const teamLine = Object.entries(team).sort((a, b) => b[1] - a[1]).map(([t, n]) => `${n} for ${who(t)}`).join(', ');

  return head(`${name} — ${title}`, { indexable }) + `
<section class="cover" aria-label="Cover">
  <div><p class="brand">ShelterKart</p><p class="kind">Independent due-diligence report</p></div>
  <div class="cover-main"><h1>${esc(name)}</h1><p class="where">${esc([d.location, d.market].filter(Boolean).join(' · '))}</p>
    <p class="pitch">Who you are really paying, what the record shows, and ${c.questions || 0} questions to ask before you pay.</p></div>
  <div class="cover-foot"><dl>${p.ids && p.ids.length ? `<dt>Registration</dt><dd>${esc(p.ids.join(', '))}</dd>` : ''}<dt>Research to</dt><dd>${esc(longDate(d.asOf))}</dd><dt>Reference</dt><dd>${esc(d.ref || '')}</dd></dl>
    <p class="small">${c.facts || 0} findings from ${c.sources || 0} sources, ${c.conflicts || 0} disagreements between sources and ${c.inferences || 0} conclusions drawn by reasoning. Research, not advice: this report states what public sources show and what to ask. It does not tell you whether to buy.</p></div>
</section>

${ledgerHtml}

<section class="pagebreak"><h2 id="sec-contents" style="margin-top:0;border-top:0;padding-top:0">Contents</h2>
<ol class="toc">${toc.map(([id, t, ds]) => `<li><a href="#sec-${id}">${esc(t)}<span class="ds">${esc(ds)}</span></a><span class="pg">${pages[id] || ''}</span></li>`).join('')}</ol>
<div class="howto"><p><b>How to use this report.</b> Put each question to the team named beside it, in writing, and keep every answer and document in one file. A question is closed only by the document described under "A good answer". Use the tracker to see what is still open, and ask your own lawyer to review anything legal before you pay.</p></div>
<ul class="legend" aria-label="How each finding is marked"><li class="lv">Verified at an official source</li><li class="lr">Reported, with link</li><li class="lc">Developer's own claim</li><li class="li">Our inference, with the reasoning</li><li class="lf">Sources disagree</li></ul>
<p class="meta" style="margin-top:1.2rem">The questions are for ${esc(teamLine) || "the developer's teams"}.</p></section>

${has.glance ? `<section class="pagebreak">${H('glance', 'At a glance')}
${(d.glance || []).length ? `<table class="glance"><tbody>${d.glance.map(g => `<tr><th scope="row">${esc(g.label)}</th><td>${esc(g.values.join('  ·  '))}${g.conflict ? ' <span class="cfl">sources disagree</span>' : ''}</td></tr>`).join('')}</tbody></table>` : ''}
${(d.promises || []).length ? `<h3>Where the marketing and the record part ways</h3><div class="prs">${d.promises.map(promiseCard).join('')}</div>` : ''}</section>` : ''}

<section class="pagebreak">${H('start', 'Start here: the questions that matter most')}
<p class="meta">Eight to put first. The full wording, the closing test and a place to track each are in "Every question, by stage".</p>
<ol class="plain">${top.map(questionCompact).join('')}</ol>
${d.questions.length > top.length ? `<p class="meta">All ${d.questions.length} questions follow the findings.</p>` : ''}</section>

${d.inferences.length ? `<section>${H('reasoning', 'What the facts add up to')}<p class="meta">Conclusions we reached by connecting facts. Each shows its reasoning; check it yourself.</p>${d.inferences.map(i => `<div class="inf"><p class="kind">${esc(cap(i.kind))}${i.strength ? `, ${esc(i.strength)} link` : ''}</p><p>${esc(i.text)}</p>${i.steps && i.steps.length ? `<ol>${i.steps.map(s => `<li>${esc(s.text)}${s.sources && s.sources.length ? ' ' + s.sources.slice(0, 3).map(x => link(x.url, shortUrl(x.url))).join(', ') : ''}</li>`).join('')}</ol>` : ''}${sourcesLine(i.sources)}</div>`).join('')}</section>` : ''}

${d.conflicts.length ? `<section>${H('conflicts', 'Where sources disagree')}<p class="meta">Each version as published. None is averaged; the primary document settles it.</p><div class="wrap"><table><thead><tr><th>What</th><th>Versions and where each appears</th></tr></thead><tbody>${d.conflicts.map(cf => `<tr><td>${esc(cap(cf.label || cf.field))}</td><td>${cf.versions.map(v => `<p>${esc(v.value)}: ${v.sources.slice(0, 3).map(s => link(s.url, shortUrl(s.url))).join(', ') || 'no link'}</p>`).join('')}</td></tr>`).join('')}</tbody></table></div></section>` : ''}

${has.numbers ? `<section>${H('numbers', 'The numbers, checked')}
${area ? `<h3>Areas</h3><p>${esc(area.text)}</p>` : ''}
${gaps.length ? `<h3>Dates</h3><ul>${gaps.map(g => `<li>Marketed "${esc(g.value)}" is ${Math.abs(g.months)} months ${g.months > 0 ? 'earlier' : 'later'} than the filed completion date of ${esc(g.filed)}.</li>`).join('')}</ul>` : ''}
${delay ? `<h3>What a delay is worth</h3><p>At ${esc(delay.annualRatePct)}% a year${delay.basis ? ' (' + esc(delay.basis) + ')' : ''}, delay interest is about ${rupees(delay.monthly)} a month for every ${rupees(delay.perAmount)} you have paid. Use the rate in force on the date of delay.</p>` : ''}
${prices.length ? `<h3>Prices on one basis</h3><div class="wrap"><table><thead><tr><th>Listing</th><th>Price</th><th>Area (sq ft)</th><th>Per sq ft</th><th>Source</th></tr></thead><tbody>${prices.map(r => `<tr><td>${esc(r.label)}</td><td>${esc(r.currency)} ${Number(r.price).toLocaleString('en-IN')}</td><td>${esc(r.area)}</td><td>${Number(r.perSqft).toLocaleString('en-IN')}</td><td>${r.source ? link(r.source, shortUrl(r.source)) : ''}</td></tr>`).join('')}</tbody></table></div><p class="meta">Advertised prices, not transactions or a valuation.</p>` : ''}</section>` : ''}

<section class="pagebreak">${H('findings', 'What we found')}
${d.sections.map(s => `<h3>${esc(s.title)}</h3><ul class="plain">${s.facts.map(f => fact(f, d.ref)).join('')}</ul>`).join('')}</section>

<section class="pagebreak">${H('allq', 'Every question, by stage')}
${byStage.map(x => `<h3>${esc(cap(x.w))}</h3><ol class="plain">${x.qs.map(q => question(q)).join('')}</ol>`).join('')}</section>

<section class="pagebreak">${H('tracker', 'Your question tracker')}
<p class="meta">Tick each box as you go. A question is closed when you hold the document in the "closes it" column.</p>
<div class="wrap"><table class="tk"><thead><tr><th>#</th><th>Question</th><th>Ask</th><th>When</th><th>Closes it</th><th>Status</th></tr></thead><tbody>${d.questions.map(q => `<tr><td class="n">${ID(q.id)}</td><td>${esc(firstSentence(q.question, 150))}</td><td>${esc(q.to)}</td><td>${esc(q.when)}</td><td>${esc(firstSentence(q.good || '', 130))}</td><td class="bx"><span class="box"></span> <span class="box"></span> <span class="box"></span></td></tr>`).join('')}</tbody></table></div>
<p class="meta">Boxes, left to right: asked, answered, document in hand.</p></section>

${d.unreachable && d.unreachable.length ? `<section>${H('unreached', 'What we could not reach, and how you can')}<div class="wrap"><table><thead><tr><th>What</th><th>Why</th><th>How to get it</th></tr></thead><tbody>${d.unreachable.map(u => `<tr><td>${esc(u.what)}</td><td>${esc(u.why)}</td><td>${esc(u.how_to_get_it || '')}</td></tr>`).join('')}</tbody></table></div></section>` : ''}

<section>${H('sources', 'Sources')}
<div class="wrap"><table><thead><tr><th>Source</th><th>Status</th></tr></thead><tbody>${d.sources.map(s => `<tr><td>${link(s.url, s.title || shortUrl(s.url))}</td><td>${esc(LABEL[s.status] || s.status)}</td></tr>`).join('')}</tbody></table></div>
${d.panel && d.panel.engines && d.panel.engines.length ? `<p class="meta">Investigated by ${d.panel.engines.length} AI engine${d.panel.engines.length > 1 ? 's' : ''} working independently, over ${d.panel.rounds} round${d.panel.rounds === 1 ? '' : 's'} of lead-following.</p>` : ''}</section>

<section>${H('about', 'About this report')}
<h3>What it is</h3><p>A buyer-side investigation of public information about this project and the companies behind it, turned into the questions to ask before you pay. Findings marked "reported" have not been confirmed at an official source; they are included so you can ask about them.</p>
<h3>What it is not</h3><p>It is not legal, financial or valuation advice, a title certificate or an engineer's inspection, and it does not tell you whether to buy. Ask your own lawyer to review the agreement and run the title and charge searches.</p>
<h3>Independence</h3><p>ShelterKart is paid only by buyers. No developer can pay for, influence or remove anything in this report. A developer may send a reply, which we show beside the finding it answers.</p>
<h3>If something is wrong</h3><p>Tell us what and where, with a document if you have one. We check it and correct the report, and keep a public record of corrections.</p>
${guideBox()}
<p class="notice">${esc(d.notice || '')} Reference ${esc(d.ref || '')}.</p></section>
</main></body></html>`;
}

/** The free first look: what we found, three questions in full, what the full report adds, and the price. */
function renderPreview(d, { price = null, unlockUrl = '#unlock' } = {}) {
  const p = d.project || {}, name = p.name || d.query, c = d.counts || {};
  const top = d.questions.slice(0, 3), rest = d.questions.slice(3);
  const team = {}; for (const q of rest) team[q.to] = (team[q.to] || 0) + 1;
  const teamList = Object.entries(team).sort((a, b) => b[1] - a[1]);
  return head(`${name} — free preview`) + `
<section style="padding:2.6rem 0 .5rem">
  <p style="font-family:'Fraunces',Georgia,serif;font-size:1.25rem;color:var(--gold-deep);margin:0">ShelterKart</p>
  <p class="meta" style="margin:.1rem 0 1.6rem">Free preview. The full report unlocks below.</p>
  <h1 style="font-size:2.5rem;margin:.2rem 0 .3rem;letter-spacing:-.01em">${esc(name)}</h1>
  <p class="meta">${esc([d.location, d.market].filter(Boolean).join(' · '))}${p.ids && p.ids.length ? ' · ' + esc(p.ids.join(', ')) : ''} · research to ${esc(longDate(d.asOf))}</p>
  <p style="font-size:1.1rem;color:var(--ink-2);max-width:38rem;margin-top:1rem">We found ${c.facts || 0} things from ${c.sources || 0} sources and ${c.conflicts || 0} places where sources disagree, and turned them into ${c.questions || 0} questions for the developer's teams. Here is what stood out first.</p>
</section>
${(d.promises || []).length ? `<h2 style="margin-top:2rem">Where the marketing and the record part ways</h2><div class="prs">${d.promises.map(promiseCard).join('')}</div>` : ''}
<h2 class="pagebreak" style="margin-top:0;border-top:0;padding-top:0">Three questions to start with</h2>
<p class="meta">Put these to the developer in writing. Each says who should answer and what a good answer looks like.</p>
<ol class="plain">${top.map(q => question(q, { track: false })).join('')}</ol>
${rest.length ? `<div class="lock"><h3>${rest.length} more questions are in the full report</h3>
<p>${teamList.map(([t, n]) => `${n} for ${esc(who(t))}`).join(', ')}. Each names the document that closes it.</p></div>` : ''}
<div class="lock"><h3>What the full report adds</h3><ul>
<li>All ${c.questions || 0} questions, by stage (before booking, signing, each payment and possession), with why each matters, a good answer, and what does not close it</li>
<li>${c.inferences || 0} conclusions drawn by connecting the facts, with the reasoning shown step by step</li>
<li>The ${c.conflicts || 0} disagreements between sources, side by side, and the numbers checked: areas, dates, price per sq ft and what a delay is worth</li>
<li>Every one of the ${c.facts || 0} findings with a link to where it appears and a clear status</li>
<li>A one-page tracker for answers and documents, and what to request where records are not online</li>
<li>A PDF to keep, and a live page that is refreshed if we find something new</li></ul></div>
<div class="unlock" id="unlock"><h3>Unlock the full report</h3>
${price ? `<p class="price">${esc(price.display)}</p><p>${esc(price.line)}</p>` : ''}
<p>One payment. No subscription. We e-mail the PDF and a link as soon as it is ready, and you can read it on this page while it completes.</p>
<a class="btn" href="${esc(unlockUrl)}">Unlock the full report</a></div>
${guideBox()}
<p class="notice">Research, not advice. This report states what public sources show and what to ask. It does not tell you whether to buy. ShelterKart is paid only by buyers; no developer can influence it.</p>
</main></body></html>`;
}

module.exports = { renderDossier, renderPreview, SECTIONS, esc, firstSentence, CSS, head };
