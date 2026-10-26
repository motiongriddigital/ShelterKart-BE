// ShelterKart: the first live run of the investigator, on three properties in three countries.
//
//   node tools/first_live_run.js --check   which engines and models will take part, what is missing. Spends nothing.
//   node tools/first_live_run.js --dry     the whole pipeline on stand-in data, no network. Spends nothing.
//   node tools/first_live_run.js           the live run, with the spending stop in FIRST_RUN_MAX_USD.
//   add --only=celeste (or london, dubai) to run one property.
//
// Settings come from backend/.env.first-run (copy backend/.env.first-run.example). Results go to tools/samples/live/.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2), has = f => args.includes(f), opt = k => (args.find(a => a.startsWith(`--${k}=`)) || '').split('=')[1];
const mode = has('--check') ? 'check' : has('--dry') ? 'dry' : 'live';

// ---- settings -------------------------------------------------------------------------------------------------
const envFile = path.join(ROOT, 'backend', '.env.first-run');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (!m || line.trim().startsWith('#')) continue;
    if (process.env[m[1]] === undefined || process.env[m[1]] === '') process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} else if (mode === 'live') { console.error(`Missing ${envFile}. Copy backend/.env.first-run.example to it and add the API keys.`); process.exit(2); }
const env = process.env;
const num = (k, d) => (env[k] === undefined || env[k] === '' ? d : Number(env[k]));

const ENGINES = require('../backend/engines');
const INV = require('../backend/engine/investigator');
const H = require('../backend/engine/dossierHtml');
const DB = require('../backend/engine/dossierBrief');
const PDF = require('../backend/engine/pdf');

const PROPERTIES = [
  { id: 'celeste', query: 'Hubtown Celeste', location: 'Worli, Mumbai', market: 'India', country: 'IN', languages: ['English', 'Marathi', 'Hindi'], golden: 'tools/golden/celeste.expected.json' },
  { id: 'london', query: 'The Kensington, Sutton Garden Square', location: 'Sutton, South West London', market: 'United Kingdom', country: 'GB', languages: ['English'], golden: 'tools/golden/london.expected.json' },
  { id: 'dubai', query: 'Creek Bay Tower B', location: 'Dubai Creek Harbour, Dubai', market: 'United Arab Emirates', country: 'AE', languages: ['English', 'Arabic'], golden: 'tools/golden/dubai.expected.json' },
].filter(p => !opt('only') || p.id === opt('only'));

const spent = () => Object.values(ENGINES.meter.snapshot()).reduce((t, v) => t + (v.estimatedCostUsd || 0), 0);
const usd = n => '$' + n.toFixed(2);

// ---- --check ---------------------------------------------------------------------------------------------------
function check() {
  const keys = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'XAI_API_KEY', 'DEEPSEEK_API_KEY'];
  console.log('Settings file:', fs.existsSync(envFile) ? envFile : 'not found (copy backend/.env.first-run.example)');
  console.log('API keys:', keys.map(k => `${k.replace('_API_KEY', '').toLowerCase()} ${env[k] ? 'set' : 'MISSING'}`).join(', '));
  const show = (role, op) => {
    const p = ENGINES.plan(role, env, op);
    console.log(`\n${role === 'research' ? 'Research panel (searches and reads pages)' : 'Reviewer and question writer'}:`);
    for (const c of p.candidates) console.log(`  take part  ${c.engine.padEnd(10)} model ${c.model}`);
    for (const x of p.excluded) console.log(`  left out   ${x.engine.padEnd(10)} ${x.reason}`);
    return p.candidates.length;
  };
  const r = show('research', 'search'), v = show('verify', 'complete');
  console.log(`\nPDF printing: ${PDF.available() ? 'available (Playwright and Chromium found)' : 'NOT available: npm install playwright && npx playwright install chromium'}`);
  console.log(`Delay rate: ${env.DELAY_RATE_PCT ? env.DELAY_RATE_PCT + '% (confirm SBI\'s highest MCLR on sbi.co.in; add 2%)' : 'not set'}`);
  console.log(`Spending stop: ${usd(num('FIRST_RUN_MAX_USD', 75))} for the run; depth ${num('FIRST_RUN_ROUNDS', 3)} rounds of up to ${num('FIRST_RUN_LEADS_PER_ROUND', 5)} leads, ${num('FIRST_RUN_MINUTES', 20)} minutes a property`);
  console.log(`Properties: ${PROPERTIES.map(p => p.query + ' (' + p.market + ')').join('; ')}`);
  const ready = r >= 2 && v >= 1;
  console.log(ready ? '\nReady for the live run.' : '\nNot ready: the research panel needs at least two engines that can search, and one reviewer.');
  return ready;
}

// ---- --dry: stand-in engines that answer from the Celeste research, so every file is produced without a network ----
function standIn() {
  const research = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', 'dossier', 'celeste.research.json'), 'utf8'));
  const qs = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', 'dossier', 'celeste.questions.json'), 'utf8'));
  const sweep = { ...research, questions: qs.questions, leads: [{ kind: 'company', value: 'Nayan Real Estate Private Limited', why: 'the selling company' }] };
  return {
    async runEach(role, op, a) {
      const lead = /Lead: /.test(a.prompt);
      if (role === 'research') return { results: [{ engine: 'stand-in', text: JSON.stringify(lead ? { facts: [] } : sweep), retrieved: research.facts.flatMap(f => f.sources).map(url => ({ url })) }], failed: [] };
      return { results: [{ engine: 'stand-in', text: '{"questions":[],"leads":[]}' }], failed: [] };
    },
  };
}

// ---- the run ---------------------------------------------------------------------------------------------------
async function run(engines) {
  const out = path.join(ROOT, 'tools', 'samples', mode === 'dry' ? 'live-dry' : 'live');
  fs.mkdirSync(out, { recursive: true });
  const max = num('FIRST_RUN_MAX_USD', 75), rows = [];
  for (const p of PROPERTIES) {
    if (mode === 'live' && spent() >= max) { console.log(`\nSpending stop reached (${usd(spent())}); ${p.query} not started.`); rows.push({ p, skipped: true }); continue; }
    console.log(`\n== ${p.query} (${p.market}) ==`);
    const t0 = Date.now(), before = spent();
    const inv = INV.createInvestigation({ query: p.query, location: p.location, market: p.market, country: p.country, languages: p.languages,
      budget: { rounds: num('FIRST_RUN_ROUNDS', 3), leadsPerRound: num('FIRST_RUN_LEADS_PER_ROUND', 5), minutes: num('FIRST_RUN_MINUTES', 20) } },
    { engines, env, onEvent: e => { if (e.type === 'progress') console.log(`  ${new Date().toISOString().slice(11, 19)}  ${e.message}`); if (e.type === 'update') console.log(`  ${new Date().toISOString().slice(11, 19)}  so far: ${e.dossier.counts.facts} findings, ${e.dossier.counts.questions} questions, ${usd(spent())} spent`); },
      shouldStop: () => mode === 'live' && spent() >= max });
    let d, error = '';
    try { await inv.sweep(); d = await inv.complete(); } catch (e) { error = String((e && e.message) || e); d = inv.dossier; }
    const minutes = (Date.now() - t0) / 60000, cost = spent() - before;
    const row = { p, d, error, minutes, cost, failed: d ? d.panel.failed : [] };
    if (d) {
      fs.writeFileSync(path.join(out, `${p.id}.json`), JSON.stringify(d, null, 1));
      fs.writeFileSync(path.join(out, `${p.id}-report.html`), H.renderDossier(d));
      fs.writeFileSync(path.join(out, `${p.id}-preview.html`), H.renderPreview(DB.previewDossier(d)));
      try { fs.writeFileSync(path.join(out, `${p.id}-report.pdf`), await PDF.renderPdf(H.renderDossier(d), { footer: `ShelterKart report: ${p.query}. Research, not advice.` })); row.pdf = true; } catch (e) { row.pdf = false; }
      if (p.golden) {
        const g = cp.spawnSync('node', [path.join(ROOT, 'tools', 'golden_check.js'), path.join(out, `${p.id}.json`), path.join(ROOT, p.golden)], { encoding: 'utf8' });
        row.golden = { pass: g.status === 0, text: g.stdout.trim() };
      }
    }
    rows.push(row);
    console.log(`  done in ${minutes.toFixed(1)} min, ${usd(cost)}${error ? ', stopped early: ' + error : ''}`);
  }
  // the summary
  const L = [`# First live run, ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC${mode === 'dry' ? ' (DRY RUN: stand-in data, not a real result)' : ''}`, '',
    '| Property | Findings | Sources | Disagreements | Inferences | Questions | Engines | Minutes | Est. cost | PDF |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |'];
  for (const r of rows) {
    if (r.skipped) { L.push(`| ${r.p.query} | not started: spending stop | | | | | | | | |`); continue; }
    if (!r.d) { L.push(`| ${r.p.query} | failed: ${r.error} | | | | | | | | |`); continue; }
    const c = r.d.counts;
    L.push(`| ${r.p.query} | ${c.facts} | ${c.sources} | ${c.conflicts} | ${c.inferences} | ${c.questions} | ${r.d.panel.engines.join(', ')} | ${r.minutes.toFixed(1)} | ${usd(r.cost)} | ${r.pdf ? 'yes' : 'no'} |`);
  }
  L.push('', `Estimated total: ${usd(spent())} (from catalogue prices; only Anthropic's were checked against official documentation).`);
  for (const r of rows) if (r.failed && r.failed.length) L.push('', `Engine failures for ${r.p.query}: ${r.failed.map(f => `${f.engine} (${f.error})`).join('; ')}`);
  for (const r of rows) if (r.golden) L.push('', `## ${r.p.query}: pass-or-fail test ${r.golden.pass ? 'PASS' : 'FAIL'}`, '', '```', r.golden.text, '```');
  L.push('', 'Next: read each report against what you know of the project, compare each with its reference report in tools/samples/ (ShelterKart-Report-*.pdf), then delete the model lines in .env.first-run and run again to compare quality and cost with the cheaper defaults.');
  fs.writeFileSync(path.join(out, 'summary.md'), L.join('\n'));
  console.log('\n' + L.join('\n'));
}

(async () => {
  if (mode === 'check') process.exit(check() ? 0 : 1);
  if (mode === 'live' && !check()) process.exit(1);
  await run(mode === 'dry' ? standIn() : ENGINES);
})();
