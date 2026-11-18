'use strict';
/**
 * The custom report pipeline: Tavily searches the internet, Groq formats what it found into a report.
 * Deliberately separate from engine/investigator.js and engines/index.js - its own, simpler path, free-tier on
 * both providers. Reports live in memory only (lost on restart); see customStore.js.
 */
const crypto = require('crypto');
const tavily = require('./tavilyClient');
const groq = require('./groqClient');
const { buildPrompt } = require('./reportPrompts');

const newRef = () => 'CR-' + crypto.randomBytes(6).toString('hex').toUpperCase();

function searchQueryFor({ query, location, market }) {
  return [query, location, market].filter(Boolean).join(' ').trim();
}

/**
 * tier 'free': a cheap, shallow search (basic depth, 5 results) and a teaser report.
 * tier 'paid': a deeper search (advanced depth, 8 results) and the full report.
 * Throws with .code set to tavily_* or groq_* on failure (see those clients) - the route maps these to a status.
 */
async function generate({ query, location, market, tier = 'free' } = {}, deps = {}) {
  if (!query || typeof query !== 'string' || !query.trim()) throw Object.assign(new Error('query is required'), { code: 'invalid_query' });
  const wantsPaid = tier === 'paid';
  const searchQuery = searchQueryFor({ query, location, market });

  const { results } = await tavily.search({ query: searchQuery, searchDepth: wantsPaid ? 'advanced' : 'basic', maxResults: wantsPaid ? 8 : 5 }, deps);
  const { system, user } = buildPrompt({ query: searchQuery, tier: wantsPaid ? 'paid' : 'free', results });
  const formatted = await groq.format({ system, user }, deps);

  return {
    ok: true,
    ref: newRef(),
    tier: wantsPaid ? 'paid' : 'free',
    query: searchQuery,
    summary: String(formatted.summary || ''),
    highlights: Array.isArray(formatted.highlights) ? formatted.highlights.map(String) : [],
    sections: wantsPaid && Array.isArray(formatted.sections) ? formatted.sections.map(s => ({
      heading: String(s.heading || ''), body: String(s.body || ''),
      sourceUrls: Array.isArray(s.sourceUrls) ? s.sourceUrls.filter(u => results.some(r => r.url === u)) : [],
    })) : [],
    sources: wantsPaid && Array.isArray(formatted.sources) ? formatted.sources.filter(s => s && results.some(r => r.url === s.url)).map(s => ({ title: String(s.title || ''), url: s.url })) : [],
    searchedResultCount: results.length,
    generatedAt: new Date().toISOString(),
  };
}

module.exports = { generate, newRef };
