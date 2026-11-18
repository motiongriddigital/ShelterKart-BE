'use strict';
/**
 * The custom report pipeline: Tavily searches the internet, Groq formats what it found into a report.
 * Deliberately separate from engine/investigator.js and engines/index.js - its own, simpler path, free-tier on
 * both providers. Reports live in memory only (lost on restart); see customStore.js.
 */
const crypto = require('crypto');
const tavily = require('./tavilyClient');
const groq = require('./groqClient');
const gemini = require('./geminiClient');
const { buildPrompt, CAPS } = require('./reportPrompts');

const newRef = () => 'CR-' + crypto.randomBytes(6).toString('hex').toUpperCase();

const QUESTION_PRIORITIES = new Set(['top', 'standard']);
const SOURCE_STATUSES = new Set(['confirmed', 'disagree', 'reported']);

function searchQueryFor({ query, location, market }) {
  return [query, location, market].filter(Boolean).join(' ').trim();
}

/**
 * Groq formats first; if Groq fails for ANY reason (quota, network, bad reply), Gemini retries the exact same
 * system/user prompt as a fallback - same report either way, just a different model. If Gemini also fails, the
 * original Groq error is what the caller sees (it's the primary provider, so its failure is the one worth reporting).
 */
async function formatWithFallback({ system, user, maxTokens }, deps) {
  try {
    const formatted = await groq.format({ system, user, maxTokens }, deps);
    return { formatted, formatter: 'groq' };
  } catch (groqErr) {
    try {
      const formatted = await gemini.format({ system, user, maxTokens }, deps);
      return { formatted, formatter: 'gemini' };
    } catch (geminiErr) {
      throw Object.assign(
        new Error(`Groq failed (${groqErr.code}: ${groqErr.message}); Gemini fallback also failed (${geminiErr.code}: ${geminiErr.message})`),
        { code: groqErr.code, geminiCode: geminiErr.code }
      );
    }
  }
}

/**
 * Both tiers return the same shape (keyFacts/differences/questions/pricing/sources) - 'paid' just searches deeper
 * and is allowed more of each (see reportPrompts.js's CAPS) so it costs more tokens for a richer report.
 * Anything the model returns that isn't backed by a real URL from the search results is dropped, never kept as a
 * guess. Throws with .code set to tavily_* or groq_* (Gemini failing too doesn't change the error code - see
 * formatWithFallback above) on failure - the route maps these to a status.
 */
async function generate({ query, location, market, tier = 'free' } = {}, deps = {}) {
  if (!query || typeof query !== 'string' || !query.trim()) throw Object.assign(new Error('query is required'), { code: 'invalid_query' });
  const wantsPaid = tier === 'paid';
  const caps = wantsPaid ? CAPS.paid : CAPS.free;
  const searchQuery = searchQueryFor({ query, location, market });

  const { results } = await tavily.search({ query: searchQuery, searchDepth: wantsPaid ? 'advanced' : 'basic', maxResults: wantsPaid ? 8 : 5 }, deps);
  const { system, user } = buildPrompt({ query: searchQuery, tier: wantsPaid ? 'paid' : 'free', results });
  const { formatted, formatter } = await formatWithFallback({ system, user, maxTokens: wantsPaid ? 3200 : 2200 }, deps);

  const hasUrl = u => typeof u === 'string' && results.some(r => r.url === u);
  const groundedOrNull = u => (hasUrl(u) ? u : null);

  const keyFacts = (Array.isArray(formatted.keyFacts) ? formatted.keyFacts : [])
    .filter(f => f && hasUrl(f.sourceUrl))
    .slice(0, caps.keyFacts)
    .map(f => ({ label: String(f.label || ''), value: String(f.value || ''), sourceUrl: f.sourceUrl }));

  const differences = (Array.isArray(formatted.differences) ? formatted.differences : [])
    .filter(d => d && d.officialRecord && hasUrl(d.officialRecord.sourceUrl))
    .slice(0, caps.differences)
    .map(d => ({
      title: String(d.title || ''),
      category: String(d.category || ''),
      sellerClaim: {
        value: String((d.sellerClaim && d.sellerClaim.value) || ''),
        detail: String((d.sellerClaim && d.sellerClaim.detail) || ''),
        sourceUrl: groundedOrNull(d.sellerClaim && d.sellerClaim.sourceUrl),
      },
      officialRecord: {
        value: String(d.officialRecord.value || ''),
        detail: String(d.officialRecord.detail || ''),
        sourceUrl: d.officialRecord.sourceUrl,
      },
      impact: String(d.impact || ''),
    }));

  const questions = (Array.isArray(formatted.questions) ? formatted.questions : [])
    .filter(q => q && q.question)
    .slice(0, caps.questions)
    .map(q => ({
      category: String(q.category || ''),
      question: String(q.question || ''),
      whyItMatters: String(q.whyItMatters || ''),
      goodAnswer: String(q.goodAnswer || ''),
      redFlag: String(q.redFlag || ''),
      priority: QUESTION_PRIORITIES.has(q.priority) ? q.priority : 'standard',
    }));

  const pricing = (Array.isArray(formatted.pricing) ? formatted.pricing : [])
    .filter(p => p && hasUrl(p.sourceUrl))
    .slice(0, caps.pricing)
    .map(p => ({
      label: String(p.label || ''), size: String(p.size || ''),
      quotedPrice: String(p.quotedPrice || ''), benchmarkPrice: String(p.benchmarkPrice || ''),
      differenceNote: String(p.differenceNote || ''), sourceUrl: p.sourceUrl,
    }));

  const sources = (Array.isArray(formatted.sources) ? formatted.sources : [])
    .filter(s => s && hasUrl(s.url))
    .slice(0, caps.sources)
    .map(s => ({ name: String(s.name || ''), detail: String(s.detail || ''), status: SOURCE_STATUSES.has(s.status) ? s.status : 'reported', url: s.url }));

  return {
    ok: true,
    ref: newRef(),
    tier: wantsPaid ? 'paid' : 'free',
    query: searchQuery,
    formattedBy: formatter,
    summary: String(formatted.summary || ''),
    highlights: Array.isArray(formatted.highlights) ? formatted.highlights.map(String) : [],
    keyFacts,
    differences,
    questions,
    pricing,
    sources,
    counts: {
      sourcesChecked: results.length,
      confirmedFacts: sources.filter(s => s.status === 'confirmed').length,
      differencesFound: differences.length,
      questionsToAsk: questions.length,
    },
    searchedResultCount: results.length,
    generatedAt: new Date().toISOString(),
  };
}

module.exports = { generate, newRef };
