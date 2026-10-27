#!/usr/bin/env node
'use strict';
/**
 * Market acceptance, offline: for every market the site lists, which gates can be proven here without a network, an AI key or a payment account.
 * A gate that needs a live run, a delivery account or a person is printed as "not run", never as passed.
 *   node tools/market_acceptance.js [out.md] [out.json]      exits 1 if a market fails an offline gate (research wiring, pricing)
 */
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const { MARKETS } = require(path.join(root, 'backend', 'engine', 'markets.js'));
const P = require(path.join(root, 'backend', 'pricing'));
const R = require(path.join(root, 'backend', 'engine', 'research.js'));
const { CONNECTORS } = require(path.join(root, 'backend', 'engine', 'registry.js'));
const PLAYBOOKS = require(path.join(root, 'backend', 'data', 'playbooks.json'));
const { languagesForMarket } = require(path.join(root, 'backend', 'engine', 'languages.js'));

const MERCHANT = { DODO_API_KEY: 'k', DODO_WEBHOOK_KEY: 'whsec_QUJD' };
const PRICING_ENV = { NODE_ENV: 'demo', TAX_GATE: 'off', GSTIN: 'DEMO', RAZORPAY_INTERNATIONAL: 'true', ACCESS_TOKEN_SECRET: 'demo' };
const iso = (m, k) => String(m.registry || k).toUpperCase();

const res = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body, text: async () => JSON.stringify(body) });
const SOURCES = [['https://register.example.org/entry', 'Official register'], ['https://developer.example.com/project', 'Developer site']];
const MODEL_OUT = {
  project: { name: 'Acceptance Test Tower', location: 'Test City', developer: 'Test Developer Ltd', ids: [] },
  sources: SOURCES.map(s => s[0]),
  findings: [
    { id: 'f1', topic: 'registration', claim: 'An entry for the project exists in the register.', kind: 'fact', src: [0] },
    { id: 'f2', topic: 'other', claim: 'The developer site describes the project.', kind: 'developer_claim', src: [1] }
  ],
  conflicts: [], gaps: [{ topic: 'Escrow account', why: 'Not published' }]
};
const stubModel = async (url, opts) => {
  const body = JSON.parse(opts.body);
  if (body.tools) return res(200, { stop_reason: 'end_turn', content: [{ type: 'server_tool_use', name: 'web_search' }, { type: 'web_search_tool_result', content: SOURCES.map(([u, t]) => ({ type: 'web_search_result', url: u, title: t })) }, { type: 'text', text: JSON.stringify(MODEL_OUT) }] });
  return res(200, { content: [{ type: 'text', text: JSON.stringify({ reading: [], questions: [] }) }] });
};
const stubHttp = async () => ({ status: 200, ok: true, text: async () => '', json: async () => ({}) });

const cell = (pass, detail) => ({ pass, detail: detail || '' });

async function researchGate(key, label) {
  try {
    const b = await R.runResearch({ query: 'Acceptance Test Tower', location: label, market: key }, { env: { ANTHROPIC_API_KEY: 'k' }, fetchImpl: stubModel, http: stubHttp });
    const n = (b.findings || []).length;
    return cell(n > 0 && Array.isArray(b.questions), n + ' findings, ' + (b.questions || []).length + ' questions');
  } catch (e) { return cell(false, String(e && e.message || e).slice(0, 120)); }
}

function pricedGate(data, code) {
  try {
    const e = P.previewFee(data, { counts: {}, project: {}, findings: [] }, P.resolveBuyer(data, { selected: code }));
    return { ...cell(e.price > 0 && Boolean(e.currency), e.price + ' ' + e.currency), currency: e.currency, price: e.price };
  } catch (e) { return cell(false, String(e && e.message || e).slice(0, 120)); }
}

function payable(env, products, code) {
  const data = P.load(env); if (products) data.morProducts = products;
  const c = data.countries.get(code);
  const s = c ? P.saleStatus(data, code) : { onSale: false, reason: 'not_in_pricing_data' };
  return cell(s.onSale, s.onSale ? '' : String(s.reason).replace(/_/g, ' '));
}

async function evaluate(markets = MARKETS) {
  const priceData = P.load(PRICING_ENV);
  const rows = [];
  for (const key of Object.keys(markets)) {
    const m = markets[key], code = iso(m, key);
    let languages = []; try { languages = languagesForMarket(key).map(x => x.code || x); } catch (e) { languages = []; }
    rows.push({
      key, code, label: m.label, status: m.status,
      registry: Boolean(m.registry && CONNECTORS[m.registry]),
      playbook: Boolean(PLAYBOOKS[code]),
      languages,
      research: await researchGate(key, m.label),
      priced: pricedGate(priceData, code),
      payableToday: payable({}, null, code),
      payableMerchant: payable({ ...MERCHANT }, { USD: 'pdt_usd' }, code),
      liveRun: 'not run', delivered: 'not run', reviewed: 'not run'
    });
  }
  return rows;
}

const failing = rows => rows.filter(r => !r.research.pass || !r.priced.pass);
const mark = c => (c.pass ? 'pass' : 'FAIL' + (c.detail ? ' (' + c.detail + ')' : ''));
function render(rows, date = new Date().toISOString().slice(0, 10)) {
  const n = f => rows.filter(f).length;
  return [
    '# ShelterKart: market acceptance (offline)', '',
    `Generated ${date}. Offline gates only: research wiring with a stubbed model and registers, pricing from the price book, and the sale gate. Nothing here proves a live run, delivery or a review; those columns say "not run".`, '',
    `- Markets: ${rows.length}. Research wiring passes: ${n(r => r.research.pass)}. Priced: ${n(r => r.priced.pass)}.`,
    `- Registry connector: ${n(r => r.registry)}. Playbook: ${n(r => r.playbook)}.`,
    `- Payable today: ${n(r => r.payableToday.pass)} of ${rows.length}. With the merchant of record live (keys and a USD product): ${n(r => r.payableMerchant.pass)} of ${rows.length}.`, '',
    '| Market | Code | Data status | Registry | Playbook | Research wiring (stub) | Priced | Payable today | Payable with merchant | Live run | Delivered | Reviewed |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|',
    ...rows.map(r => `| ${r.label} | ${r.code} | ${r.status} | ${r.registry ? 'yes' : '-'} | ${r.playbook ? 'yes' : '-'} | ${mark(r.research)} | ${mark(r.priced)} | ${r.payableToday.pass ? 'pass' : r.payableToday.detail} | ${r.payableMerchant.pass ? 'pass' : r.payableMerchant.detail} | ${r.liveRun} | ${r.delivered} | ${r.reviewed} |`)
  ].join('\n') + '\n';
}

module.exports = { evaluate, render, failing };

if (require.main === module) {
  (async () => {
    const rows = await evaluate(), md = render(rows), [outMd, outJson] = process.argv.slice(2);
    if (outMd) { fs.writeFileSync(outMd, md); console.log('wrote ' + outMd); } else console.log(md);
    if (outJson) { fs.writeFileSync(outJson, JSON.stringify({ generated: new Date().toISOString(), rows }, null, 1)); console.log('wrote ' + outJson); }
    const bad = failing(rows);
    console.log(bad.length ? `${bad.length} market(s) fail an offline gate: ${bad.map(r => r.label).join(', ')}` : `all ${rows.length} markets pass the offline gates`);
    process.exit(bad.length ? 1 : 0);
  })().catch(e => { console.error('market acceptance could not run:', e.message); process.exit(1); });
}
