'use strict';
/**
 * ShelterKart — the adviser.
 *
 * Turns findings, conflicts and gaps into two things a buyer can act on:
 *   reading   -- patterns in the record, each tied to the findings it
 *                rests on, each ending in a question. Never an accusation.
 *   questions -- exact words to say, to whom, and when, with what a
 *                straight answer and an evasive one sound like.
 *
 * If the model call fails, the built-in library below still guarantees
 * the core questions. A report never ends in a dead end.
 */

const WHEN = ['Before booking', 'Before signing', 'Before each payment', 'Before possession'];

/** Core questions, drafted and agreed across the product-planning rounds. */
const LIBRARY = [
  { match: /regist|rera|licen/i, who: 'Sales team', when: 'Before booking',
    question: 'Please share the regulator\u2019s registration certificate for this project. Which possession date does it show?',
    good: 'A certificate with the registration number and a specific date.', red_flag: 'A verbal date, or \u201cit\u2019s registered\u201d with no document.' },
  { match: /seller|promoter|developer|company|entity/i, who: 'Legal team', when: 'Before booking',
    question: 'Which legal company is the seller on my agreement, and what is its registration number?',
    good: 'A company name and number that match the regulator\u2019s record.', red_flag: 'Only the brand name, with no legal entity.' },
  { match: /possession|completion|date|deliver/i, who: 'Sales team', when: 'Before signing',
    question: 'Is the possession date in my Agreement for Sale the same as the one on the registration?',
    good: 'Yes, both show the same date, and here are copies.', red_flag: '\u201cRoughly the same.\u201d The two should match exactly.' },
  { match: /escrow|account|bank/i, who: 'CRM team', when: 'Before each payment',
    question: 'Is this payment going into the project\u2019s escrow account? Which bank, and can I see a stamped statement from the last 90 days?',
    good: 'A dated statement with the bank\u2019s seal.', red_flag: 'A payment request to an account in another name.' },
  { match: /progress|construct|stage|floor/i, who: 'Sales team', when: 'Before each payment',
    question: 'What percentage of construction is complete, according to the latest progress report filed with the regulator?',
    good: 'A specific, dated figure from the filed report.', red_flag: '\u201cIt\u2019s nearly done,\u201d with no document.' },
  { match: /certificate|occupan|commence|approval|permit/i, who: 'Legal team', when: 'Before signing',
    question: 'Please share the commencement certificate for the full height, and the occupancy or completion certificate if the building is finished.',
    good: 'Dated copies from the local authority.', red_flag: '\u201cApplied for\u201d on a building sold as ready.' },
  { match: /price|cost|charge|fee/i, who: 'CRM team', when: 'Before booking',
    question: 'What is the all-in price for my specific unit, including parking, deposits and every charge, in writing?',
    good: 'A written, itemised breakdown.', red_flag: 'A verbal figure that leaves charges out.' },
  { match: /title|encumbr|land/i, who: 'Your own lawyer', when: 'Before signing',
    question: 'Can I see the title and encumbrance records for my specific unit, not just the project?',
    good: 'Unit-level records showing nothing registered against it.', red_flag: '\u201cThe project\u2019s title is clean, so yours is too.\u201d' }
];

const CORE = [1, 2, 3]; // seller, possession date, escrow -- always asked

function fromLibrary(gaps, conflicts) {
  const picked = new Set(CORE);
  const topics = [...gaps.map(g => g.topic + ' ' + g.why), ...conflicts.map(c => c.topic)].join(' | ');
  LIBRARY.forEach((q, i) => { if (q.match.test(topics)) picked.add(i); });
  return [...picked].map(i => {
    const { match, ...q } = LIBRARY[i];
    return { ...q, source: 'library' };
  });
}

async function advise(g, { env, fetchImpl = globalThis.fetch }) {
  const base = fromLibrary(g.gaps, g.conflicts);
  if (!require('../engines').available('adviser', env)) return { reading: [], questions: base };

  const facts = g.findings.map(f => ({ id: f.id, mark: f.mark, claim: f.claim }));
  const prompt = `You are ShelterKart's buyer adviser: a calm, experienced friend who reads between the lines. You never accuse anyone, never speculate about motives, and never tell the buyer to buy or not buy.
Property: ${g.project.name} ${g.project.location}
Findings (mark = how well supported): ${JSON.stringify(facts)}
Where sources disagree: ${JSON.stringify(g.conflicts.map(c => ({ topic: c.topic, versions: c.versions.map(v => v.value) })))}
Not found: ${JSON.stringify(g.gaps)}

Reply with ONLY this JSON:
{"reading":[{"observation":"a pattern in the findings, max 35 words, stated as what the record shows","based_on":["f1"],"question":"the question it raises, max 22 words"}],
 "questions":[{"who":"Sales team|Legal team|CRM team|Your bank|Your own lawyer|Check it yourself","when":"${WHEN.join('|')}","question":"exact words, max 28 words","good":"max 18 words","red_flag":"max 18 words"}]}
At most 4 reading items and 6 questions. Every reading item must cite finding ids from the list above. Cover disagreements and gaps first.`;

  try {
    const r = await require('../engines').run('adviser', 'complete', { prompt, maxTokens: 2000, label: 'adviser' }, { env, fetchImpl });
    const { parseJSON } = require('./searchLane');
    const out = parseJSON(r.text || '');
    const ids = new Set(g.findings.map(f => f.id));
    const clip = (s, n) => String(s || '').slice(0, n);
    // An inference must rest on findings that exist in this brief.
    const reading = (Array.isArray(out.reading) ? out.reading : [])
      .filter(r => r && r.observation && Array.isArray(r.based_on) && r.based_on.length && r.based_on.every(i => ids.has(String(i))))
      .slice(0, 4).map(r => ({ observation: clip(r.observation, 300), based_on: r.based_on.map(String), question: clip(r.question, 200) }));
    const modelQs = (Array.isArray(out.questions) ? out.questions : []).filter(q => q && q.question).slice(0, 6)
      .map(q => ({ who: clip(q.who, 40) || 'Sales team', when: WHEN.includes(q.when) ? q.when : 'Before booking',
                   question: clip(q.question, 260), good: clip(q.good, 160), red_flag: clip(q.red_flag, 160), source: 'adviser' }));
    // Model questions first; library core questions guaranteed, deduplicated by opening words.
    const seen = new Set(modelQs.map(q => q.question.toLowerCase().slice(0, 40)));
    const questions = [...modelQs, ...base.filter(q => !seen.has(q.question.toLowerCase().slice(0, 40)))].slice(0, 9);
    return { reading, questions };
  } catch {
    return { reading: [], questions: base };
  }
}

module.exports = { advise, fromLibrary, LIBRARY, WHEN };
