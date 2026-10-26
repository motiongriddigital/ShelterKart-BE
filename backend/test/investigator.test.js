'use strict';
/* Tests for the investigator (engine/investigator.js), the dossier reasoning (engine/dossier.js) and the
   report page (engine/dossierHtml.js). The panel is simulated: three engines that each find different things,
   one that fails, leads that reveal more, a reviewer and a question writer. No network. */
const assert = require('assert');
const D = require('../engine/dossier');
const INV = require('../engine/investigator');
const { renderDossier } = require('../engine/dossierHtml');

let passed = 0, failed = 0;
async function t(name, fn) { try { await fn(); passed++; console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e && e.message)); } }

const AURUM = 'https://www.aurumproptech.in/pulse/rera/maharashtra/mumbai-city/hubtown-celeste-P51900008925';
const HOUSIEY = 'https://housiey.com/projects/hubtown-celeste';
const TOFLER = 'https://www.tofler.in/hubtown-limited/company/L45200MH1989PLC050688';
const MAHARERA = 'https://maharera.maharashtra.gov.in/promoter-complaint-report';
const SWEEP = {
  claude: { project: { name: 'Hubtown Celeste', location: 'Worli, Mumbai', country: 'India', brand: 'Hubtown', promoter_legal_name: 'Nayan Real Estate Private Limited', registration_ids: ['P51900008925'], developer_site: 'hubtown.co.in' },
    entities: [{ name: 'Nayan Real Estate Private Limited', role: 'promoter', people: [{ name: 'Hemant M Shah', role: 'Chairperson' }, { name: 'Vyomesh M Shah', role: 'Managing Director' }], email_domains: ['hubtown.co.in'], brand: 'Hubtown', sources: [AURUM] }],
    facts: [{ area: 'identity', field: 'registered promoter', value: 'Nayan Real Estate Private Limited', claim: 'The MahaRERA record names Nayan Real Estate Private Limited as promoter of P51900008925.', sources: [AURUM] },
      { area: 'timeline', field: 'filed completion date', value: '31 Jul 2029', claim: 'Proposed completion on the record is 31 Jul 2029.', sources: [AURUM] },
      { area: 'record', field: 'registration date', value: '19 Aug 2017', claim: 'Registered on 19 Aug 2017.', sources: [AURUM] }],
    units: [{ type: '2BHK', count: 89, carpet: 30.63, unit: 'sq m', source: AURUM }, { type: '2BHK', count: 122, carpet: 30.78, unit: 'sq m', source: AURUM }],
    sanctioned_area: { value: 2623.62, unit: 'sq m', source: AURUM }, filed_completion: { value: '31 Jul 2029', source: AURUM },
    marketed_dates: [{ value: 'December 2027', source: HOUSIEY }],
    listings: [{ label: '330 sq ft, floors 11-20', price: 22000000, currency: 'INR', area_sqft: 330, source: HOUSIEY }],
    leads: [{ kind: 'company', value: 'Nayan Real Estate Private Limited', why: 'the selling company' }],
    questions: [{ question: 'Which company signs my agreement and receives every payment?', why: 'The signer is who you can enforce against.', to: 'legal team', when: 'before booking', good: 'Named in writing with its CIN.', not_accepted: '"It is all Hubtown."', sources: [AURUM] }] },
  openai: { facts: [{ area: 'timeline', field: 'filed completion date', value: '2029-07-31', claim: 'Completion date filed with MahaRERA: 2029-07-31.', sources: ['https://cityair.in/hubtown_-_celeste_project_in_mumbai_ppc.html'] },
      { area: 'timeline', claim: 'Agents advertise possession in December 2027 as the RERA date.', kind: 'developer_claim', sources: [HOUSIEY] },
      { area: 'complaints', claim: 'MahaRERA keeps a promoter-wise complaint list for registered projects.', sources: [MAHARERA] }],
    entities: [{ name: 'Hubtown Limited', role: 'parent', ids: ['L45200MH1989PLC050688'], people: [{ name: 'Hemant Mahipatray Shah', role: 'Director' }], email_domains: ['hubtown.co.in'], brand: 'Hubtown', sources: [TOFLER] }],
    leads: [{ kind: 'case', value: 'M.A.S. No. 5714 of 2015', why: 'a court case reported against the project' }] },
  deepseek: { facts: [{ area: 'record', field: 'registration date', value: '9 September 2021', claim: 'Registration date 9 September 2021.', sources: ['https://example-aggregator.com/celeste'] }],
    questions: [{ question: 'We recommend buying this unit if the price is right.', to: 'sales team', when: 'before booking' }] },
};
const LEADS = {
  'Nayan Real Estate Private Limited': { facts: [{ area: 'money', claim: 'A company-data site reports open charges of about ₹50 crore against Nayan Real Estate Private Limited (CIN U70102MH2010PTC205728).', sources: ['https://www.thecompanycheck.com/company/nayan-real-estate-private-limited/U70102MH2010PTC205728'] }] },
  'M.A.S. No. 5714 of 2015': { unreachable: [{ what: 'Court file for M.A.S. No. 5714 of 2015', why: 'Small Causes Court records are not online', how_to_get_it: 'Certified copy from the Small Causes Court, Mumbai, or ask the promoter' }] },
};
function makeEngines({ failOne = true } = {}) {
  const calls = [];
  return {
    calls,
    async runEach(role, op, args, opts) {
      calls.push({ role, op, prompt: args.prompt, opts, args });
      if (role === 'research') {
        const lead = (args.prompt.match(/Lead: [a-z-]+: (.+)/) || [])[1];
        if (lead) return { results: [{ engine: 'claude', text: JSON.stringify(LEADS[lead.trim()] || {}), retrieved: [] }], failed: [] };
        const results = Object.entries(SWEEP).map(([engine, o]) => ({ engine, text: (engine === 'openai' ? '```json\n' : '') + JSON.stringify(o) + (engine === 'openai' ? '\n```' : ''), retrieved: [{ url: AURUM }, { url: HOUSIEY }] }));
        return { results, failed: failOne ? [{ engine: 'xai', error: 'timeout' }] : [] };
      }
      if (/most demanding partner/.test(args.prompt)) return { results: [{ engine: 'claude', text: JSON.stringify({ leads: [{ kind: 'filing', value: 'Hubtown Limited exchange filings 2026', why: 'group finances' }], questions: [{ question: 'Has any lender to the group taken security over Celeste land or receivables?', why: 'Group debt can reach the project.', to: 'accounts team', when: 'before signing', good: 'Charge register and lender consents.', not_accepted: 'A verbal assurance.' }] }) }], failed: [] };
      if (/Write the question list/.test(args.prompt)) return { results: [{ engine: 'openai', text: JSON.stringify({ questions: [{ question: 'Please share the current MahaRERA certificate and the latest quarterly progress report.', why: 'They are the primary record.', to: 'legal team', when: 'before booking', good: 'Certified copies with dates.', not_accepted: 'Screenshots from agents.', facts: ['F1'] }] }) }], failed: [] };
      return { results: [], failed: [] };
    },
  };
}

(async () => {
  console.log('investigator and dossier');
  const events = [];
  const engines = makeEngines();
  const d = await INV.investigate({ query: 'Hubtown Celeste', location: 'Worli, Mumbai', market: 'India' }, { engines, env: { DELAY_RATE_PCT: '11.10' }, onEvent: e => events.push(e) });

  await t('every engine on the panel investigates; one failing does not stop the others', () => {
    assert.deepStrictEqual(d.panel.engines.sort(), ['claude', 'deepseek', 'openai']);
    assert.ok(d.panel.failed.some(f => f.engine === 'xai'));
  });
  await t('the same fact found by two engines is merged, with both credited', () => {
    const f = d.sections.flatMap(s => s.facts).find(x => x.field === 'filed completion date');
    assert.ok(f && f.foundBy.length === 2, JSON.stringify(f && f.foundBy));
  });
  await t('engines that disagree produce a conflict with every version kept', () => {
    const c = d.conflicts.find(x => x.field === 'registration date');
    assert.ok(c && c.versions.length === 2 && c.versions.some(v => /2021/.test(v.value)));
  });
  await t('leads are followed in rounds, and what they reveal is added', () => {
    assert.ok(d.panel.rounds >= 1);
    assert.ok(d.sections.flatMap(s => s.facts).some(f => /open charges/.test(f.claim)));
    assert.ok(engines.calls.some(c => /Lead: company: Nayan Real Estate Private Limited/.test(c.prompt)));
  });
  await t('a lead that cannot be reached tells the buyer how to get it', () => {
    assert.ok(d.unreachable.some(u => /Small Causes Court/.test(u.how_to_get_it)));
  });
  await t('common control is inferred from a shared person and e-mail domain, with the reasoning shown', () => {
    const i = d.inferences.find(x => x.kind === 'common control');
    assert.ok(i && i.strength === 'strong' && i.steps.length >= 2, JSON.stringify(i));
    assert.ok(/not the same as legal liability/.test(i.text));
  });
  await t('the area arithmetic is checked: 211 units do not fit the sanctioned area', () => {
    assert.strictEqual(d.checks.area.count, 211); assert.strictEqual(d.checks.area.reconciles, false); assert.strictEqual(d.checks.area.ratio, 2.47);
  });
  await t('the gap between marketed and filed dates is measured, and a delay is priced', () => {
    assert.strictEqual(d.checks.gaps[0].months, 19);
    assert.strictEqual(d.checks.delay.monthly, 92500);
  });
  await t('unverified facts are kept and labelled; official sources are marked verified', () => {
    const facts = d.sections.flatMap(s => s.facts);
    assert.ok(facts.some(f => f.status === 'reported'));
    assert.ok(facts.some(f => f.status === 'verified' && f.sources.some(s => /maharera/.test(s.url))));
    assert.ok(facts.some(f => f.status === 'claim' || f.status === 'reported'));
  });
  await t('questions come from the panel, the reviewer, the writer and the reasoning, with no cap', () => {
    const qs = d.questions.map(q => q.question).join('\n');
    assert.ok(/Which company signs my agreement/.test(qs));
    assert.ok(/lender to the group/.test(qs));
    assert.ok(/MahaRERA certificate/.test(qs));
    assert.ok(/approved area statement/.test(qs));
    assert.ok(/guarantee/.test(qs));
    assert.ok(/months/.test(qs));
    assert.ok(d.questions.length >= 7, String(d.questions.length));
  });
  await t('the report never tells the buyer whether to buy', () => {
    assert.ok(!d.questions.some(q => D.hasVerdict(q.question)));
    const html = renderDossier(d);
    assert.ok(!/proceed with conditions|we recommend buying|do not buy/i.test(html));
  });
  await t('progress streams: progress, updates after each stage, and done', () => {
    assert.ok(events.some(e => e.type === 'progress' && e.stage === 'sweep'));
    assert.ok(events.filter(e => e.type === 'update').length >= 2);
    assert.ok(events.at(-1).type === 'done' && events.at(-1).dossier.questions.length === d.questions.length);
  });
  await t('engines are asked to read pages and answer at length', () => {
    const sweep = engines.calls.find(c => c.role === 'research' && !/Lead:/.test(c.prompt));
    assert.ok(sweep.args.fetchPages === true && sweep.args.maxTokens >= 16000);
  });
  await t('a deadline stops the investigation cleanly', async () => {
    let clock = 0; const eng = makeEngines();
    const d2 = await INV.investigate({ query: 'Hubtown Celeste', budget: { minutes: 1 } }, { engines: eng, env: {}, now: () => (clock += 120000) });
    assert.ok(d2.kind === 'shelterkart-dossier' && d2.panel.rounds === 0);
  });
  await t('a spending stop halts new rounds, the review and the question pass, and still returns the report so far', async () => {
    const eng = makeEngines();
    const d3 = await INV.investigate({ query: 'Hubtown Celeste' }, { engines: eng, env: {}, shouldStop: () => true });
    assert.ok(d3.kind === 'shelterkart-dossier' && d3.panel.rounds === 0 && d3.sections.length > 0);
    assert.ok(!eng.calls.some(c => c.role === 'verify'));
  });
  await t('country knowledge reaches the investigator for the new markets, framed as leads to verify', async () => {
    const eng = makeEngines();
    await INV.investigate({ query: 'Some Residence', location: 'Kuala Lumpur', country: 'MY' }, { engines: eng, env: {} });
    const sweep = eng.calls.find(c => c.role === 'research' && !/Lead:/.test(c.prompt)).prompt;
    assert.ok(/Country knowledge for Malaysia/.test(sweep) && /TEDUH/.test(sweep) && /These are LEADS/.test(sweep));
    for (const cc of ['IN', 'GB', 'AE', 'CA', 'MY', 'US']) assert.ok(INV.playbookFor(cc).length > 200, cc);
    assert.strictEqual(INV.playbookFor('ZZ'), '');
  });
  await t('a saved investigation resumes from its state and does not pay for the sweep again', async () => {
    const e1 = makeEngines(); const inv1 = INV.createInvestigation({ query: 'Hubtown Celeste' }, { engines: e1, env: {} });
    await inv1.sweep();
    const saved = JSON.parse(JSON.stringify(inv1.exportState()));          // exactly what goes to disk
    const e2 = makeEngines(); const inv2 = INV.createInvestigation({ query: 'Hubtown Celeste' }, { engines: e2, env: {}, resume: saved });
    const d = await inv2.complete();
    const sweeps = e2.calls.filter(c => c.role === 'research' && !/Lead: /.test(c.prompt)).length, leads = e2.calls.filter(c => /Lead: /.test(c.prompt || '')).length;
    assert.ok(sweeps === 0 && leads >= 1 && d.phase === 'complete' && d.counts.facts >= saved.dossier.counts.facts);
  });
  await t('every engine result is priced and added to the job that asked for it', async () => {
    const { costedEngines } = require('../engine/jobCosts'); let total = 0;
    const E = { runEach: async () => ({ results: [{ engine: 'anthropic', model: 'claude-sonnet-5-5', usage: { input: 100000, output: 5000 }, searches: 6 }], failed: [] }) };
    await costedEngines(E, usd => { total += usd; }).runEach('research', 'search', {});
    assert.ok(total > 0);
  });
  await t('a vague request is refused', async () => {
    await assert.rejects(() => INV.investigate({ query: 'x' }, { engines: makeEngines() }), /name the property/);
  });
  await t('lenient parsing: code fences, extra keys and a trailing comma do not lose the reply', () => {
    assert.deepStrictEqual(INV.parseLoose('```json\n{"facts":[{"claim":"a"},],"extra":1}\n```').facts, [{ claim: 'a' }]);
    assert.deepStrictEqual(INV.parseLoose('no json here'), {});
  });

  await t('a reasoning question that an expert question already covers is merged, not repeated', () => {
    const qs = D.assembleQuestions([[{ question: 'Your agents advertise December 2027, but the record shows 31 July 2029. Which date will my agreement carry?', when: 'before booking', to: 'sales team', sources: [] }],
      D.questionsFromReasoning({ gaps: [{ value: 'December 2027', filed: '31 Jul 2029', months: 19, sources: [{ url: 'https://h.com' }] }] })]);
    assert.strictEqual(qs.length, 1); assert.ok(qs[0].sources.some(s => s.url === 'https://h.com'));
    assert.ok(D.anchorIn('31 Jul 2029', 'the record shows 31 July 2029') && D.anchorIn('G+38', 'tower as G+38, G+22') && !D.anchorIn('1.000 acre', 'a 5 acre plot'));
  });
  console.log('report page');
  const html = renderDossier(d);
  await t('the page leads with the questions, then reasoning, conflicts, checks, findings and every question', () => {
    const order = ['At a glance', 'Start here', 'What the facts add up to', 'Where sources disagree', 'The numbers, checked', 'What we found', 'Every question, by stage', 'Your question tracker', 'Sources</h2>'].map(h => html.search(new RegExp('<h2[^>]*>' + h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))));
    assert.ok(order.every((v, i) => v > 0 && (i === 0 || v > order[i - 1])), JSON.stringify(order));
  });
  await t('every finding shows where it appears and its status', () => {
    assert.ok(/Where it appears:/.test(html) && /Reported, with link/.test(html) && /Verified at an official source/.test(html));
  });
  await t('text from the web is escaped', () => {
    const evil = INV.build({ project: { ids: [] }, raw: [{ area: 'other', claim: '<script>alert(1)</script>', sources: ['https://x.com'] }], entities: [], units: [], sanctioned: [], filed: [], marketed: [], listings: [], botLeads: [], questions: [], unreachable: [], retrieved: new Set(), leads: new Map(), used: new Set(), failed: [], round: 0 }, { query: 'Q' });
    assert.ok(!/<script>alert/.test(renderDossier(evil)));
  });

  await t('the full report opens with a cover and a contents page, and has a tracker with boxes to tick', () => {
    assert.ok(html.indexOf('class="cover"') < html.indexOf('id="sec-contents"') && /Independent due-diligence report/.test(html));
    assert.ok(/Your question tracker/.test(html) && /class="box"/.test(html) && /SK-P51900008925-/.test(html));
    assert.ok(d.glance.some(g => g.label === 'Registered promoter' && /Nayan/.test(g.values[0])) && d.promises.length >= 2);
  });
  console.log('free preview');
  const { renderPreview, renderDossier: _r } = require('../engine/dossierHtml');
  const pv = renderPreview(d, { price: { display: '₹3,600', line: 'Set by the property value.' } });
  await t('the preview shows the promise-versus-record pairs, exactly three questions in full, and the price', () => {
    assert.ok(/Where the marketing and the record part ways/.test(pv) && /₹3,600/.test(pv) && /Unlock the full report/.test(pv));
    assert.strictEqual((pv.match(/class="q" id="Q\d+"/g) || []).length, 3);
  });
  await t('the preview does not give away the locked questions, and never gives a verdict', () => {
    const locked = d.questions.slice(3).map(q => q.question);
    assert.ok(locked.every(q => !pv.includes(q.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'))));
    assert.ok(new RegExp(String(d.questions.length - 3) + ' more questions').test(pv) && !D.hasVerdict(pv));
  });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
