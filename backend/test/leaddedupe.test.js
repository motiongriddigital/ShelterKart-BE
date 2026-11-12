'use strict';
const assert = require('assert');
const D = require('../engine/dossier');
const INV = require('../engine/investigator');
let passed = 0, failed = 0;
async function t(name, fn) { try { await fn(); passed++; console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e && e.message)); } }

const CHARGE_A = 'A charge of about 85 crore rupees in favour of a non-banking lender is registered against Marigold Realty Ventures Private Limited.';
const CHARGE_B = 'An 85 crore rupee charge in favour of a non-banking lender is registered against U70100PN2018PTC176001.';
const DIR_A = 'Rakesh K Bhandari and Meera Bhandari are the directors of Marigold Realty Ventures Private Limited.';
const DIR_B = 'The directors of U70100PN2018PTC176001 are Rakesh K Bhandari and Meera Bhandari.';
const PROMOTER = 'Marigold Realty Ventures Private Limited', CIN = 'U70100PN2018PTC176001', PARENT = 'Sunrise Group Developers Limited', REG = 'P52100099001';
const fact = (id, claim, area = 'money') => ({ id, claim, value: '', area });

(async () => {
  console.log('reworded duplicates');
  await t('the same fact in other words is one fact: the charge and the directors, as found in the sandbox run', () => {
    assert.strictEqual(D.sameClaim(CHARGE_A, CHARGE_B), true); assert.strictEqual(D.sameClaim(DIR_A, DIR_B), true);
    assert.strictEqual(D.sameClaim('The completion date filed with MahaRERA is 31 December 2026.', 'MahaRERA records the filed completion date as 31 December 2026.'), true);
  });
  await t('different figures are two facts, on both merge paths (85 crore against 850 crore; one date against another; 2021 against 2026)', () => {
    assert.strictEqual(D.sameClaim(CHARGE_A, CHARGE_A.replace('85 crore', '850 crore')), false);
    assert.strictEqual(D.sameClaim('The completion date filed with MahaRERA is 31 December 2026.', 'The completion date filed with MahaRERA is 30 June 2027.'), false);
    assert.strictEqual(D.sameClaim('A charge of 85 crore was registered in 2021 against the promoter company by a lender.', 'A charge of 85 crore was registered in 2026 against the promoter company by a lender.'), false);
  });
  await t('a claim and its negation are two facts, whichever way they are worded', () => {
    assert.strictEqual(D.sameClaim('A charge in favour of a non-banking lender is registered against the promoter company.', 'No charge in favour of a non-banking lender is registered against the promoter company.'), false);
    assert.strictEqual(D.sameClaim('The complaint against the project was dismissed by the regulator after a hearing in 2025.', 'The complaint against the project was upheld by the regulator after a hearing in 2025.'), false);
    assert.strictEqual(D.sameClaim('The promoter has delivered every earlier project on time according to its annual report.', 'The promoter has not delivered every earlier project on time according to its annual report.'), false);
  });
  await t('short claims and unrelated claims stay apart', () => {
    assert.strictEqual(D.sameClaim('The land is 9,840 sq m.', 'The plot is 9,840 square metres.'), false);
    assert.strictEqual(D.sameClaim(CHARGE_A, DIR_A), false); assert.strictEqual(D.sameClaim(DIR_A, 'Four complaints are listed against the project, three about delay.'), false);
  });
  await t('merging a pair keeps both sources, both finders and the longer wording', () => {
    const { facts } = D.mergeFacts([{ area: 'money', claim: CHARGE_A, sources: ['https://a.example/1'], foundBy: ['x'] }, { area: 'money', claim: CHARGE_B, sources: ['https://b.example/2'], foundBy: ['y'] }]);
    assert.strictEqual(facts.length, 1); assert.deepStrictEqual(facts[0].sources.map(s => s.url).sort(), ['https://a.example/1', 'https://b.example/2']);
    assert.deepStrictEqual(facts[0].foundBy.sort(), ['x', 'y']); assert.strictEqual(facts[0].claim, CHARGE_A);
  });
  await t('two facts that must not merge stay two through mergeFacts', () => {
    const raw = [{ area: 'money', claim: CHARGE_A, sources: ['https://a.example/1'] }, { area: 'money', claim: CHARGE_A.replace('85 crore', '850 crore'), sources: ['https://b.example/2'] }, { area: 'money', claim: CHARGE_A.replace('is registered', 'is not registered'), sources: ['https://c.example/3'] }];
    assert.strictEqual(D.mergeFacts(raw).facts.length, 3);
  });
  await t('different areas never merge', () => { assert.strictEqual(D.mergeFacts([{ area: 'money', claim: DIR_A, sources: ['https://a.example/1'] }, { area: 'identity', claim: DIR_B, sources: ['https://b.example/2'] }]).facts.length, 2); });
  await t('a fact with a field still merges by its value, as before', () => {
    const { facts, conflicts } = D.mergeFacts([{ area: 'timeline', field: 'filed completion date', value: '31 Dec 2026', claim: 'x one', sources: ['https://a.example/1'] }, { area: 'timeline', field: 'filed completion date', value: '30 Jun 2027', claim: 'y two', sources: ['https://b.example/2'] }]);
    assert.strictEqual(facts.length, 2); assert.strictEqual(conflicts.length, 1);
  });

  console.log('duplicate leads');
  const entities = [{ name: PROMOTER, ids: [CIN] }, { name: PARENT, ids: ['L45200PN2005PLC121001'] }];
  const ctx = { projectIds: [REG], entities, promoter: PROMOTER };
  const facts = [fact('F1', 'The MahaRERA record for ' + REG + ' names ' + PROMOTER + ' as the promoter.', 'identity')];
  const bot = [{ kind: 'company-id', value: CIN, why: "the promoter's filings" }, { kind: 'complaint', value: 'CC006000000451', why: 'the delay complaint' }, { kind: 'company', value: PARENT, why: 'the listed parent' }];
  const kinds = m => [...m.values()].map(l => l.kind + ':' + l.value);
  await t('without the context nothing changes: five leads, as in the sandbox run', () => {
    assert.deepStrictEqual(kinds(D.extractLeads(facts, bot)), ['registration:' + REG, 'company:' + PROMOTER, 'company-id:' + CIN, 'complaint:CC006000000451', 'company:' + PARENT]);
  });
  await t('with it: the project\'s own registration number is not a lead, and the promoter by name and by number is one lead, the number\'s', () => {
    const m = D.extractLeads(facts, bot, new Map(), ctx);
    assert.deepStrictEqual(kinds(m), ['company-id:' + CIN, 'complaint:CC006000000451', 'company:' + PARENT]);
    const promoter = [...m.values()][0]; assert.match(promoter.why, /the promoter's filings/); assert.match(promoter.why, /the company: Marigold Realty Ventures Private Limited/);
  });
  await t('the same when the number comes first and the name later', () => {
    const m = D.extractLeads([], [bot[0], { kind: 'company', value: PROMOTER, why: 'named' }], new Map(), ctx);
    assert.deepStrictEqual(kinds(m), ['company-id:' + CIN]);
  });
  await t('the registration number matches however it is written; another registration number is kept', () => {
    for (const v of ['p52100099001', 'P5 2100 099001', 'P52100099001.']) assert.deepStrictEqual(kinds(D.extractLeads([], [{ kind: 'registration', value: v, why: 'x' }], new Map(), ctx)), [], v);
    assert.deepStrictEqual(kinds(D.extractLeads([], [{ kind: 'registration', value: 'P52100077777', why: 'a neighbouring project' }], new Map(), ctx)), ['registration:P52100077777']);
  });
  await t('"Pvt Ltd" and "Private Limited" are the same company', () => {
    assert.deepStrictEqual(kinds(D.extractLeads([], [{ kind: 'company', value: 'Marigold Realty Ventures Pvt. Ltd.', why: 'x' }, bot[0]], new Map(), ctx)), ['company-id:' + CIN]);
  });
  await t('a company that is not a known entity is kept; so are people, cases and complaints', () => {
    const m = D.extractLeads([], [{ kind: 'company', value: 'Zeta Holdings Private Limited', why: 'a lender' }, { kind: 'person', value: 'Rakesh K Bhandari', why: 'other boards' }, { kind: 'case', value: 'M.A.S. No. 5714 of 2015', why: 'a court case' }], new Map(), ctx);
    assert.strictEqual(m.size, 3);
  });
  await t('a lead already being followed or followed blocks a second one for the same company, and is not replaced', () => {
    const first = D.extractLeads([], [{ kind: 'company', value: PROMOTER, why: 'x' }], new Map(), ctx); [...first.values()][0].state = 'followed';
    const second = D.extractLeads([], [bot[0]], first, ctx);
    assert.deepStrictEqual(kinds(second), ['company:' + PROMOTER]); assert.strictEqual([...second.values()][0].state, 'followed');
  });
  await t('with only the name of the promoter known (no entity record), the name is still matched, and a number is kept as its own lead', () => {
    const m = D.extractLeads([], [{ kind: 'company', value: PROMOTER, why: 'x' }, { kind: 'company', value: 'marigold realty ventures pvt ltd', why: 'again' }, bot[0]], new Map(), { projectIds: [], entities: [], promoter: PROMOTER });
    assert.deepStrictEqual(kinds(m), ['company:' + PROMOTER, 'company-id:' + CIN]);
  });
  await t('the lead map handed back is a new one: the known one is not changed', () => {
    const known = new Map(); D.extractLeads(facts, bot, known, ctx); assert.strictEqual(known.size, 0);
  });

  console.log('through the investigation');
  const REGURL = 'https://maharera.maharashtra.gov.in/project/' + REG;
  const SWEEP = { project: { name: 'Marigold Heights', location: 'Wakad, Pune', promoter_legal_name: PROMOTER, registration_ids: [REG] },
    entities: [{ name: PROMOTER, role: 'promoter', ids: [CIN] }, { name: PARENT, role: 'parent', ids: ['L45200PN2005PLC121001'] }],
    facts: [{ area: 'identity', claim: 'The MahaRERA record for ' + REG + ' names ' + PROMOTER + ' as the promoter.', sources: [REGURL] }], leads: bot };
  const engines = () => { const calls = []; return { calls, async runEach(role, op, args) { calls.push({ role, op, args });
    return { results: [{ engine: 'claude', text: role === 'research' && args.stage === 'sweep' ? JSON.stringify(SWEEP) : role === 'research' ? '{}' : JSON.stringify({ questions: [], leads: [], challenges: [] }), retrieved: [] }], failed: [] }; } }; };
  const leadCalls = e => e.calls.filter(c => c.args.stage === 'leads');
  await t('the sandbox scenario: three lead calls instead of five, the promoter asked about once, by its company number', async () => {
    const e = engines(); await INV.investigate({ query: 'Marigold Heights', budget: { rounds: 1 } }, { engines: e, env: {} });
    const prompts = leadCalls(e).map(c => (c.args.prompt.match(/Lead: ([a-z-]+): (.+)/) || []).slice(1, 3).join(': '));
    assert.deepStrictEqual(prompts.sort(), ['company-id: ' + CIN, 'company: ' + PARENT, 'complaint: CC006000000451'].sort());
    assert.match(leadCalls(e).find(c => /company-id/.test(c.args.prompt)).args.prompt, /the company: Marigold Realty Ventures Private Limited/);
  });
  await t('INVESTIGATE_LEAD_DEDUPE=off gives the old five calls', async () => {
    const e = engines(); await INV.investigate({ query: 'Marigold Heights', budget: { rounds: 1 } }, { engines: e, env: { INVESTIGATE_LEAD_DEDUPE: 'off' } });
    assert.strictEqual(leadCalls(e).length, 5);
  });
  await t('the dossier lists the leads that were followed, not the dropped ones', async () => {
    const e = engines(); const d = await INV.investigate({ query: 'Marigold Heights', budget: { rounds: 1 } }, { engines: e, env: {} });
    assert.ok(!d.leads.some(l => l.kind === 'registration')); assert.strictEqual(d.leads.filter(l => /Marigold Realty/.test(l.value) || l.value === CIN).length, 1);
  });
  console.log(`\n${passed} passed, ${failed} failed`); process.exitCode = failed ? 1 : 0;
})();
