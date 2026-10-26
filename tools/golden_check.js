// Check a ShelterKart dossier against a golden case. Fails if a must-find item is missing, if a lead that is not
// verified is stated as a fact, or if the report tells the buyer whether to buy. Passes if all must-find items are there.
//   node tools/golden_check.js tools/samples/dossier-celeste.json tools/golden/celeste.expected.json
const fs = require('fs');
const D = require('../backend/engine/dossier');
const { renderDossier } = require('../backend/engine/dossierHtml');
const [dPath, ePath] = process.argv.slice(2);
const d = JSON.parse(fs.readFileSync(dPath, 'utf8')), exp = JSON.parse(fs.readFileSync(ePath, 'utf8'));
const facts = d.sections.flatMap(s => s.facts);
const factText = facts.map(f => f.claim + ' ' + f.value).join('\n');
const allText = [factText, ...d.inferences.map(i => i.text + ' ' + (i.steps || []).map(s => s.text).join(' ')), ...d.questions.map(q => q.question)].join('\n');
const has = alt => alt.split('|').some(a => allText.includes(a));
const checks = { areaNotReconciled: () => d.checks.area && d.checks.area.reconciles === false, floorsConflict: () => d.conflicts.some(c => /floor/.test(c.field)) };
let fails = 0;
for (const m of exp.mustFind) {
  const ok = m.check ? checks[m.check]() : m.all ? m.all.every(has) : m.any.some(has);
  if (!ok) fails++; console.log(`${ok ? '  found ' : '  MISSED'} ${m.id}. ${m.what}`);
}
for (const l of exp.leadsNotFacts) {
  const asFact = factText.includes(l), asked = d.questions.some(q => q.question.includes(l)) || (d.unreachable || []).some(u => (u.what + u.why).includes(l)) || allText.includes(l);
  const ok = !asFact && asked; if (!ok) fails++;
  console.log(`${ok ? '  ok    ' : '  FAIL  '} lead "${l}" ${asFact ? 'is stated as a fact' : asked ? 'is asked about, not stated as fact' : 'is missing'}`);
}
const verdict = D.hasVerdict(renderDossier(d)); if (verdict) fails++;
console.log(`${verdict ? '  FAIL  ' : '  ok    '} no buy-or-avoid verdict`);
console.log(fails ? `\nFAIL: ${fails} problem(s)` : `\nPASS: all ${exp.mustFind.length} must-find items${exp.leadsNotFacts.length ? ', leads kept as leads' : ''}, no verdict`);
process.exit(fails ? 1 : 0);
