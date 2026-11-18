'use strict';
/** The two prompts Groq sees: what the report must contain, and the Tavily results it must stay inside. */

const SCHEMA = `Return ONLY a JSON object, no other text, shaped exactly like this:
{
  "summary": "2-3 sentence overview of what was found",
  "highlights": ["short finding 1", "short finding 2"],
  "sections": [{ "heading": "section title", "body": "a few sentences", "sourceUrls": ["https://..."] }],
  "sources": [{ "title": "...", "url": "https://..." }]
}`;

const RULES = [
  'You are summarizing public web search results about a property, builder or location for a due-diligence report.',
  'Use ONLY the search results given below. Never invent a fact, a URL, or a detail not present in them.',
  'Every URL you cite (in sourceUrls or sources) must be copied exactly from the search results - never shortened, guessed, or constructed.',
  'If the results do not answer something, say so plainly instead of guessing.',
  'Be factual and neutral: report what sources say, not an opinion on whether to buy.',
].join(' ');

const resultsBlock = results => results.length
  ? results.map((r, i) => `[${i + 1}] ${r.title}\nURL: ${r.url}\n${r.content}`).join('\n\n')
  : '(no search results were returned)';

/** tier 'free': a short teaser only (summary + up to 2 highlights, no sections). tier 'paid': the full breakdown. */
function buildPrompt({ query, tier, results }) {
  const depthNote = tier === 'paid'
    ? 'Write the FULL report: a summary, 4-6 highlights, and 2-4 sections covering legal/registration status, pricing signals, and any risks or red flags, each with its own sourceUrls. Populate "sources" with every URL used anywhere above.'
    : 'Write a SHORT TEASER only: a summary and at most 2 highlights. Leave "sections" as an empty array and "sources" empty - the full detail is the paid report.';

  const system = [RULES, SCHEMA, depthNote].join('\n\n');
  const user = `Subject: ${query}\n\nSearch results:\n\n${resultsBlock(results)}`;
  return { system, user };
}

module.exports = { buildPrompt };
