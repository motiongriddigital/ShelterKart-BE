'use strict';
/** The two prompts Groq sees: what the report must contain, and the Tavily results it must stay inside. */

/** free: cheap/shallow caps to keep token spend down. paid: the same schema, just deeper (see customReport.js). */
const CAPS = {
  free: { keyFacts: 4, differences: 3, questions: 8, topQuestions: 3, pricing: 2, sources: 6 },
  paid: { keyFacts: 6, differences: 5, questions: 12, topQuestions: 5, pricing: 4, sources: 10 },
};

const SCHEMA = `Return ONLY a JSON object, no other text, shaped exactly like this. Omit an array entry entirely rather than inventing one:
{
  "summary": "2-3 sentence overview of what was found",
  "highlights": ["short finding 1", "short finding 2"],
  "keyFacts": [{ "label": "e.g. Registered entity", "value": "...", "sourceUrl": "https://..." }],
  "differences": [{
    "title": "short name for the gap",
    "category": "e.g. Timeline, Legal Entity, Area/Approval, Pricing",
    "sellerClaim": { "value": "...", "detail": "...", "sourceUrl": "https://... or null" },
    "officialRecord": { "value": "...", "detail": "...", "sourceUrl": "https://..." },
    "impact": "why this gap matters financially or legally"
  }],
  "questions": [{
    "category": "Legal | Accounts | Promoters | Sales | Engineering | Lawyer Review",
    "question": "...",
    "whyItMatters": "...",
    "goodAnswer": "what a satisfactory answer looks like",
    "redFlag": "an answer that should worry the buyer",
    "priority": "top or standard"
  }],
  "pricing": [{ "label": "e.g. 1 BHK", "size": "...", "quotedPrice": "...", "benchmarkPrice": "...", "differenceNote": "...", "sourceUrl": "https://..." }],
  "sources": [{ "name": "publisher or portal name", "detail": "one line on what it confirmed", "status": "confirmed or disagree or reported", "url": "https://..." }]
}`;

const RULES = [
  'You are building a due-diligence report on a property, builder or location from public web search results.',
  "Use ONLY the search results given below - never invent a fact, number, or URL not present in them.",
  'Every "sourceUrl"/"url" must be copied exactly from the search results below.',
  "A \"differences\" entry needs a real officialRecord.sourceUrl from the results - drop the whole entry if you can't ground the official side. sellerClaim.sourceUrl may be null if the claim is general marketing with no single matching result.",
  "A \"keyFacts\" or \"pricing\" entry needs a real sourceUrl from the results - drop it if you can't ground it.",
  '"questions" are your own analytical judgment, not factual claims - base them on what keyFacts/differences above already show, no new numbers.',
  "If the results don't support a section (e.g. no pricing data), return it as an empty array rather than guessing.",
  'Be factual and neutral: report what sources say. This is research, not investment advice.',
].join(' ');

const resultsBlock = results => results.length
  ? results.map((r, i) => `[${i + 1}] ${r.title}\nURL: ${r.url}\n${r.content}`).join('\n\n')
  : '(no search results were returned)';

/** tier 'free' and 'paid' get the SAME sections; only the depth/caps differ (see customReport.js's search depth too). */
function buildPrompt({ query, tier, results }) {
  const caps = tier === 'paid' ? CAPS.paid : CAPS.free;
  const depthNote = tier === 'paid'
    ? `Be thorough: up to ${caps.keyFacts} keyFacts, ${caps.differences} differences, ${caps.questions} questions (at least ${caps.topQuestions} marked "top"), ${caps.pricing} pricing rows, ${caps.sources} sources.`
    : `Keep it tight: at most ${caps.keyFacts} keyFacts, ${caps.differences} differences, ${caps.questions} questions (at least ${caps.topQuestions} marked "top"), ${caps.pricing} pricing rows, ${caps.sources} sources.`;

  const system = [RULES, SCHEMA, depthNote].join('\n\n');
  const user = `Subject: ${query}\n\nSearch results:\n\n${resultsBlock(results)}`;
  return { system, user };
}

module.exports = { buildPrompt, CAPS };
