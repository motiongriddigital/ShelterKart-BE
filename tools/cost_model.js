#!/usr/bin/env node
'use strict';
/**
 * Prints the cost model (backend/engines/costmodel.js over backend/data/cost-model.json and the engine catalogue).
 *
 *   node tools/cost_model.js                          the headline numbers
 *   node tools/cost_model.js --json out.json          the whole model as machine-readable JSON, with the optimisations priced
 *   node tools/cost_model.js --tables out.md          the model as markdown tables
 *
 * No network, no keys. Change a number in backend/data/cost-model.json and run it again.
 */
const fs = require('fs'), path = require('path');
const M = require(path.join(__dirname, '..', 'backend', 'engines', 'costmodel'));
const CAT = require(path.join(__dirname, '..', 'backend', 'engines', 'catalog'));
const A = M.load(), L = M.LEVELS;
const usd = v => (v == null ? 'n/a' : '$' + (v >= 100 ? v.toFixed(0) : v >= 1 ? v.toFixed(2) : v.toFixed(3)));
const pct = v => (v == null ? 'n/a' : (v * 100).toFixed(1) + '%');
const arg = k => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };

const base = M.model(A);
const paid = k => M.reportModel('paid_report', k, A).routedUsd;
const TYP = paid('typical');

/** What-ifs: each is a patch to the assumptions (or a factor on a step's cost) with the risk (1 low, 5 high) and what it rests on. */
const T = A.scenario;
const scaleLeads = f => ({ scenario: { leadsPerRound: { typical: T.leadsPerRound.typical * f }, reviewerLeads: { typical: T.reviewerLeads.typical * f } } });
const OPT = [
  { id: 'lead_fetch_cap', name: 'Read fewer full pages per lead (leadFetches 6 to 3)', risk: 3, basis: 'a full page read adds about 7k input tokens; at 5 reads a lead call has 35k of its 60k input tokens in page reads',
    patch: { steps: { lead_following: { call: { fetches: { low: 2, typical: 3, high: 3 } } } } }, how: 'DEFAULT_BUDGET.leadFetches, server.js makeInv budget' },
  { id: 'lead_cache', name: 'Cache lead results across reports (company, CIN, person, case), 14 days', risk: 3, basis: 'assumes 25% of lead tasks repeat a developer already investigated (concentrated developers); stale-data risk is handled by the as-of date and a TTL',
    patch: scaleLeads(0.75), how: 'a key of kind plus normalised value in front of runEach in followRound; bypass for premium' },
  { id: 'stop_on_low_yield', name: 'Stop lead rounds when a round adds few new facts', risk: 2, basis: 'assumes the second round is skipped in 30% of reports (1.7 rounds on average instead of 2)',
    patch: { scenario: { leadRounds: { typical: 1.7 } } }, how: 'compare counts.facts before and after each followRound; stop below a threshold' },
  { id: 'single_engine_low_value_leads', name: 'One engine, not two, for low-value leads (person, other); two for company, case, complaint, registration', risk: 3, basis: 'assumes 40% of leads are low value (effective panel 1.6)',
    patch: { scenario: { leadPanel: { typical: 1.6 } } }, how: 'leadPanel per lead kind in followRound' },
  { id: 'lead_dedupe', name: 'De-duplicate leads: Pvt/Private and Ltd/Limited spellings, a company and its own CIN, leads already covered by an entity in the dossier', risk: 1, basis: 'assumes 12% fewer lead tasks; today the key is the kind plus the exact normalised words, so "X Pvt Ltd" and "X Private Limited" are followed twice',
    patch: scaleLeads(0.88), how: 'extractLeads key in engine/dossier.js' },
  { id: 'cap_inside_round', name: 'Check the spending cap before each lead, not only before each round', risk: 1, basis: 'shouldStop is read once per round; a round is up to 12 calls. Saves half a round of overshoot, only in the reports that hit the cap (about 1 in 10 at high depth)',
    patch: null, fixedUsd: 0.1, how: 'investigator.js followRound: check shouldStop() inside the Promise.all map and run leads with a small concurrency' },
  { id: 'truncation_salvage', name: 'Salvage a reply cut off by max_tokens instead of discarding it, and stop paying for the empty one', risk: 1, basis: 'parseLoose returns {} for broken JSON, so a truncated 16,000-token reply is billed and lost; assumes 3% of search calls',
    factor: { steps: ['sweep_preview', 'lead_following'], share: 0.03 }, how: 'repair the JSON tail, or ask for a continuation with the reply so far' },
  { id: 'cache_resend', unverified: true, name: 'Prompt caching for the repeated start of pause_turn continuations', risk: 1, basis: 'UNKNOWN until measured: if each continuation re-bills the whole conversation, resendFactor is above 1. Priced here as if it were 1.3 and caching brought it to 1.03 (cache read is 0.1x input)',
    patch: null, conditional: { description: 'saving only exists if resendFactor > 1', resendFactorBefore: 1.3, resendFactorAfter: 1.03 }, how: 'cache_control on the prompt in engines/anthropic.js search(); keep the 5-minute window' },
  { id: 'preview_dedupe', name: 'Resolve the project name against the search index before the free sweep (and reuse an existing preview)', risk: 2, basis: 'assumes 8% of free previews repeat a project under another spelling; the index already matches by registration number and aliases',
    factor: { steps: ['sweep_preview'], share: 0.08 }, how: 'call SEARCH.index.match in POST /api/investigate; only reuse on confidence "sure"' },
  { id: 'batch_api', unverified: true, name: 'Provider batch API (50% off tokens) for the lead rounds, which run after payment', risk: 4, basis: 'UNVERIFIED for web-search tools and each round waits for the batch (up to 24 hours): four rounds in series would make delivery take days. Token share of the lead call is about 75%',
    factor: { steps: ['lead_following'], share: 0.375 }, how: 'only for the final round or for reviewer and question writer, which are asynchronous anyway' },
  { id: 'cheaper_verify_model', name: 'A small model (Haiku 5.5, nano) for the reviewer and the question writer', risk: 3, basis: 'these roles are already ranked cheapest first (DeepSeek, then Grok); the saving only exists when DeepSeek is not allowed. Set ANTHROPIC_MODEL_VERIFY / OPENAI_MODEL_VERIFY, no code change',
    patch: null, compute: 'verify_models', how: 'per-role model environment variables (engines/index.js modelFor)' },
  { id: 'token_budgets', name: 'Lower max_tokens per role (lead 16,000 to 8,000)', risk: 3, basis: 'only stops runaway replies; a lower cap truncates more JSON, which today is lost whole. Saves about 1% of output tokens in the typical case',
    factor: { steps: ['lead_following'], share: 0.01 }, how: 'DEFAULT_BUDGET.maxTokens' },
  { id: 'retry_policy', name: 'One retry with backoff on 429 and 5xx for a failed engine call', risk: 2, basis: 'saves no money by itself (a retry is a second bill); it protects the spend already made when a panel member fails late. Priced at zero',
    patch: null, fixedUsd: 0, how: 'engines/index.js runEach and run' },
];

function priced() {
  const out = [];
  for (const o of OPT) {
    let after = TYP;
    if (o.patch) { const A2 = M.withOverrides(A, o.patch); after = M.reportModel('paid_report', 'typical', A2).routedUsd; }
    else if (o.factor) { const r = M.reportModel('paid_report', 'typical', A); const s = r.steps.filter(x => o.factor.steps.includes(x.step)).reduce((a, x) => a + x.usd, 0); after = TYP - s * o.factor.share; }
    else if (o.conditional) {
      const A1 = M.withOverrides(A, { tokens: { resendFactor: o.conditional.resendFactorBefore } }), A2 = M.withOverrides(A, { tokens: { resendFactor: o.conditional.resendFactorAfter } });
      o.savingNote = 'if resendFactor is really 1.3';
      out.push({ ...o, beforeUsd: M.reportModel('paid_report', 'typical', A1).routedUsd, afterUsd: M.reportModel('paid_report', 'typical', A2).routedUsd });
      continue;
    } else if (o.compute === 'verify_models') {
      const allow = ['xai', 'openai', 'anthropic', 'gemini'], cheap = { anthropic: 'claude-haiku-5-5', openai: 'gpt-5.4-nano', xai: 'grok-4.3', gemini: 'gemini-3.5-flash' };
      const steps = ['reviewer', 'question_writer'].map(s => M.stepModel(s, 'typical', A));
      const cost = (models) => steps.reduce((s, st) => s + ['xai', 'openai'].reduce((a, id) => a + M.callCost(id, A.steps[st.step].call, 'typical', A, models[id]).usd, 0), 0);
      const dflt = Object.fromEntries(allow.map(id => [id, CAT.engine(id).defaultModel]));
      out.push({ ...o, beforeUsd: TYP, afterUsd: TYP - (cost(dflt) - cost({ ...dflt, openai: cheap.openai })), savingNote: 'when DeepSeek is not allowed: the OpenAI half of the panel moves to gpt-5.4-nano' });
      continue;
    } else after = TYP - (o.fixedUsd || 0);
    out.push({ ...o, beforeUsd: TYP, afterUsd: after });
  }
  return out.map(o => { const saving = Math.max(0, o.beforeUsd - o.afterUsd); return { id: o.id, unverified: Boolean(o.unverified), name: o.name, how: o.how, basis: o.basis, risk: o.risk, savingUsdPerPaidReport: Math.round(saving * 1e4) / 1e4,
    savingShareOfPaidReport: Math.round(saving / o.beforeUsd * 1e4) / 1e4, savingPerRisk: Math.round(saving / o.risk * 1e4) / 1e4, note: o.savingNote || '' }; })
    .sort((a, b) => a.unverified - b.unverified || b.savingPerRisk - a.savingPerRisk || a.risk - b.risk);
}

const CHECK = [
  { engine: 'anthropic', model: 'claude-sonnet-5-5', catalogue: '$2 in / $10 out', public: '$2 / $10 (Sonnet 5.5)', verdict: 'matches' },
  { engine: 'anthropic', model: 'claude-opus-5-5', catalogue: '$4 / $20', public: '$4 / $20', verdict: 'matches' },
  { engine: 'anthropic', model: 'claude-haiku-5-5', catalogue: '$0.10 / $0.50 (over 100k prompt: $0.50 / $2.50)', public: '$0.10 / $0.50, over 100k $0.50 / $2.50', verdict: 'matches' },
  { engine: 'anthropic', model: 'web search', catalogue: '$10 per 1,000', public: '$10 per 1,000; web fetch has no extra charge; cache read 0.1x input, 5-minute write 1.25x; batch API 50% off', verdict: 'matches. The catalogue has no cache or batch prices' },
  { engine: 'openai', model: 'gpt-5.5', catalogue: '$5 / $30', public: '$5 / $30 (up to 272k context; cached input $0.50)', verdict: 'matches' },
  { engine: 'openai', model: 'gpt-5.4-mini', catalogue: '$0.75 / $4.50', public: '$0.75 / $4.50 (cached $0.075)', verdict: 'matches' },
  { engine: 'openai', model: 'gpt-5.4-nano', catalogue: '$0.20 / $1.25', public: '$0.20 / $1.25 (cached $0.02)', verdict: 'matches' },
  { engine: 'openai', model: 'web search', catalogue: '$10 per 1,000', public: '$10 per 1,000 calls plus search-content tokens at the model rate', verdict: 'matches' },
  { engine: 'gemini', model: 'gemini-3.5-flash (the default)', catalogue: '$1.50 / $9', public: 'NO model of that name on the pricing page. Listed: Gemini 3.5 Flash-Lite $0.30 / $2.50; Gemini 3.6 Flash and 3.8 Flash $0.75 / $3.75 until 31 Dec 2026, then $1.50 / $7.50', verdict: 'DIFFERS: the default model id is not on the page; the catalogue price matches neither the Flash-Lite nor the 3.6/3.8 Flash price' },
  { engine: 'gemini', model: 'gemini-3.1-pro-preview', catalogue: '$2 / $12', public: '$2 / $12 up to 200k tokens ($4 / $18 above)', verdict: 'matches' },
  { engine: 'gemini', model: 'Google Search grounding', catalogue: '$14 per 1,000, 5,000 free a month', public: '$14 per 1,000 after 5,000 free a month shared across Gemini 3 and newer; daily cap 1,500 requests', verdict: 'matches. costOf ignores the free allowance, and the 1,500 a day cap is not modelled' },
  { engine: 'xai', model: 'grok-4.5', catalogue: '$2 / $6', public: '$2 / $6 under 200k prompt tokens ($4 / $12 above); cached $0.30', verdict: 'matches' },
  { engine: 'xai', model: 'grok-4.3 (the default)', catalogue: '$1.25 / $2.50', public: '$1.25 / $2.50 under 200k ($2.50 / $5 above); cached $0.20', verdict: 'matches' },
  { engine: 'xai', model: 'web search', catalogue: '$5 per 1,000', public: 'not stated on the pages read (docs.x.ai tools pages link to a separate price)', verdict: 'UNVERIFIED. Grok is the cheapest search engine in this model, so this one number decides the ranking' },
  { engine: 'deepseek', model: 'deepseek-v4-flash (the default)', catalogue: '$0.14 / $0.28', public: '$0.15 / $0.60 off-peak, $0.30 / $1.20 peak (UTC 01-04 and 06-10, Mon-Fri); cache hit $0.003 / $0.006. The page now calls it deepseek-flash; the old name is still billed at the Flash price', verdict: 'DIFFERS: output is 2.1x to 4.3x the catalogue, input 1.07x to 2.1x' },
  { engine: 'deepseek', model: 'deepseek-v4-pro', catalogue: '$1.74 / $3.48 (note: another snapshot lists $1.32 / $3.96)', public: '$0.66 / $1.98 off-peak, $1.32 / $3.96 peak', verdict: 'DIFFERS: the catalogue input is 2.6x the off-peak price; the second figure in its note is the peak price' },
];

const model = { ...base, optimisations: priced(), catalogueCheck: CHECK,
  funnel: { _basis: 'Every free preview is paid for by the shop; a paid report carries the previews of buyers who did not buy. The conversion rates are placeholders: the admin funnel (S5) will have the real one.',
    previewTypicalUsd: base.reports.preview.typical.routedUsd, paidReportTypicalUsd: TYP,
    costPerSaleUsd: Object.fromEntries([0.02, 0.05, 0.1, 0.2].map(c => [c, Math.round((TYP + (1 / c - 1) * base.reports.preview.typical.routedUsd) * 1e4) / 1e4])) },
  models: base.models };
model.assumptions = A;

function tables() {
  const o = [];
  const eng = Object.keys(CAT.catalog().engines);
  o.push('### Catalogue prices used (USD per million tokens; search per 1,000)\n', '| Engine | Model | Input | Output | Search per 1k | Default |', '| --- | --- | --- | --- | --- | --- |');
  for (const id of eng) { const e = CAT.engine(id); for (const [m, p] of Object.entries(e.models)) o.push(`| ${id} | ${m} | ${p.in} | ${p.out} | ${e.searchPer1kUsd == null ? 'none' : e.searchPer1kUsd} | ${m === e.defaultModel ? 'yes' : ''} |`); }
  o.push('', '### Cost per step (typical level): calls, tokens of one call, cost of one call on each engine, and the step as routed (cheapest engines first)\n');
  o.push('| Step | Kind | Calls | In tokens | Out tokens | Searches | Fetches | ' + eng.join(' | ') + ' | Routed step cost | Routed on |', '| --- | --- | --- | --- | --- | --- | --- | ' + eng.map(() => '---').join(' | ') + ' | --- | --- |');
  for (const s of Object.keys(A.steps)) {
    const x = base.steps[s].typical;
    if (!A.steps[s].call) { o.push(`| ${A.steps[s].label} | no model | 0 | | | | | ${eng.map(() => '').join(' | ')} | $0 | |`); continue; }
    o.push(`| ${A.steps[s].label} | ${x.searchCapable ? 'search-capable' : x.op === 'read' ? 'reads a file' : 'text only'} | ${x.calls} | ${x.usage.input} | ${x.usage.output} | ${x.usage.searches} | ${x.usage.fetches} | ${eng.map(id => x.perCall[id] ? usd(x.perCall[id].usd) : 'cannot').join(' | ')} | ${usd(x.routedUsd)} | ${x.routedEngines.join(', ')} |`);
  }
  o.push('', '### Cost of one call at each level (low / typical / high)\n', '| Step | ' + eng.join(' | ') + ' |', '| --- | ' + eng.map(() => '---').join(' | ') + ' |');
  for (const s of Object.keys(A.steps)) if (A.steps[s].call) o.push(`| ${A.steps[s].label} | ${eng.map(id => { const c = L.map(l => base.steps[s][l].perCall[id]); return c[0] ? c.map(x => usd(x.usd)).join(' / ') : 'cannot'; }).join(' | ')} |`);
  o.push('', '### Cost per step as routed, by level\n', '| Step | Calls (low / typical / high) | Low | Typical | High |', '| --- | --- | --- | --- | --- |');
  for (const s of Object.keys(A.steps)) o.push(`| ${A.steps[s].label} | ${L.map(l => base.steps[s][l].calls).join(' / ')} | ${L.map(l => usd(base.steps[s][l].routedUsd)).join(' | ')} |`);
  o.push('', '### Cost per report\n', '| Report | Low | Typical | High | All on anthropic (typical) | All on openai | All on gemini | All on xai |', '| --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const k of Object.keys(A.reports)) o.push(`| ${k} | ${L.map(l => usd(base.reports[k][l].routedUsd)).join(' | ')} | ${['anthropic', 'openai', 'gemini', 'xai'].map(id => usd(base.reports[k].typical.singleEngineUsd[id])).join(' | ')} |`);
  o.push('', '### Share of the buyer\'s net price (the AI cap is 30% of net: AI_CAP_SHARE)\n', '| Buyer price | Net | Net in USD | AI cap USD | Preview typical | Paid report low | typical | high | Premium search typical |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  base.net.rungs.forEach((r, i) => o.push(`| ${r.currency} ${r.gross} | ${r.net} | ${usd(r.netUsd)} | ${usd(r.aiCapUsd)} | ${pct(base.shares.preview.typical[i].share)} | ${L.map(l => pct(base.shares.paid_report[l][i].share)).join(' | ')} | ${pct(base.shares.premium_search.typical[i].share)} |`));
  o.push('', '### Cost per sale when free previews are paid for (typical paid report, typical preview)\n', '| Preview to paid conversion | Cost per sale | Share of net, INR 3,700 |', '| --- | --- | --- |');
  for (const [c, v] of Object.entries(model.funnel.costPerSaleUsd)) o.push(`| ${pct(Number(c))} | ${usd(v)} | ${pct(v / base.net.rungs.find(r => r.gross === 3700).netUsd)} |`);
  o.push('', '### Optimisations, ranked by saving divided by risk (typical paid report)\n', '| Rank | Optimisation | Saving per paid report | Share | Risk (1-5) | Saving / risk |', '| --- | --- | --- | --- | --- | --- |');
  model.optimisations.forEach((x, i) => o.push(`| ${x.unverified ? 'unranked (unverified)' : i + 1} | ${x.name} | ${usd(x.savingUsdPerPaidReport)} | ${pct(x.savingShareOfPaidReport)} | ${x.risk} | ${usd(x.savingPerRisk)} |`));
  o.push('', '### Catalogue against the providers\' public price pages (checked 2026-11-04)\n', '| Engine | Model | Catalogue | Public page | Verdict |', '| --- | --- | --- | --- | --- |');
  for (const c of CHECK) o.push(`| ${c.engine} | ${c.model} | ${c.catalogue} | ${c.public} | ${c.verdict} |`);
  return o.join('\n') + '\n';
}

if (arg('--json')) fs.writeFileSync(arg('--json'), JSON.stringify(model, null, 1) + '\n');
if (arg('--tables')) fs.writeFileSync(arg('--tables'), tables());
if (!arg('--json') && !arg('--tables')) {
  for (const k of Object.keys(A.reports)) console.log(k.padEnd(16), L.map(l => usd(base.reports[k][l].routedUsd).padStart(8)).join(' '));
  for (const x of model.optimisations) console.log(`${usd(x.savingUsdPerPaidReport).padStart(8)}  risk ${x.risk}  ${x.name}`);
}
