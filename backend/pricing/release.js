'use strict';
/**
 * ShelterKart -- generating and releasing a price book.
 *
 * The price BOOK is the source of truth for what a buyer pays; the formula
 * below only GENERATES the next version of it. A book can be released only if
 * it passes four guardrails, so prices stay controlled:
 *
 *   margin    the lowest prices stay profitable through the worst fee stack
 *   corridor  one report never differs by more than a set ratio between currencies
 *   drift     every price point stays within a band of its dollar target
 *   step      no price point moves more than a set share from the previous version
 *
 * Nothing here reads a live exchange rate: the book freezes the rates it was
 * generated from, and a quote never uses any other.
 */

/** Round a local amount to a clean price point. The step grows with the amount so rounding never moves a price by more than 5%. */
function roundPrice(x, cur, currencies = {}) {
  const fine = Boolean(currencies[cur] && currencies[cur].fine);        // low-denomination currencies (BHD, OMR) use finer steps
  let step = x < 50 ? 1 : x < 200 ? 5 : x < 1000 ? 10 : x < 3000 ? 50 : x < 10000 ? 100 : 500;
  if (fine && x < 50) step = 0.5;
  return Math.max(step, Math.round(x / step) * step);
}

/** Like roundPrice, but never below x: used where a release promises a minimum rise. */
function ceilPrice(x, cur, currencies = {}) {
  const fine = Boolean(currencies[cur] && currencies[cur].fine);        // low-denomination currencies (BHD, OMR) use finer steps
  let step = x < 50 ? 1 : x < 200 ? 5 : x < 1000 ? 10 : x < 3000 ? 50 : x < 10000 ? 100 : 500;
  if (fine && x < 50) step = 0.5;
  return Math.max(step, Math.ceil(x / step - 1e-9) * step);
}

/** The dollar rungs of the ladder: each ~20% above the last, anchored on the reference fee, capped. */
function rungsUsd(params) {
  const ref = params.refInrAmount / params.fx.INR;
  const out = [];
  for (let k = params.rungFrom; k <= params.rungTo; k++) out.push(Math.round(ref * Math.pow(params.rungRatio, k) * 10) / 10);
  out[out.length - 1] = params.capUsd;
  return out;
}

/** Generate a book from parameters, exchange rates and the currency table. */
function generateBook({ params, fx, currencies, version, now = new Date() }) {
  const p = { ...params, fx: fx.perUsd };
  const rungs = rungsUsd(p);
  const ladders = {};
  for (const cur of Object.keys(currencies)) {
    if (!(cur in fx.perUsd)) throw new Error(`no exchange rate for ${cur}`);
    ladders[cur] = rungs.map(u => roundPrice(u * fx.perUsd[cur], cur, currencies));
  }
  const refUsd = params.refInrAmount / fx.perUsd.INR;
  return {
    version, createdAt: now.toISOString(), status: 'active',
    params: { refUsd: Math.round(refUsd * 100) / 100, refPropertyUsd: Math.round(params.refPropertyInr / fx.perUsd.INR),
      exponent: params.exponent, depth: params.depth, floorUsd: rungs[0], capUsd: params.capUsd, rungRatio: params.rungRatio, quoteMinutes: params.guardrails.quoteMinutes },
    fx: { asOf: fx.asOf, source: fx.source, indicative: fx.indicative, perUsd: fx.perUsd },
    rungsUsd: rungs, ladders,
  };
}

const usdOf = (book, cur, i, perUsd = book.fx.perUsd) => book.ladders[cur][i] / perUsd[cur];

/**
 * The four guardrails. @returns { ok, failures: [{ rule, detail }], report }
 * `ctx.maxTaxRate` is the highest consumption-tax rate in the data (a price must stay profitable after it).
 */
function checkGuardrails(book, ctx = {}) {
  const g = ctx.guardrails, failures = [], report = {};
  const maxTax = ctx.maxTaxRate || 0;
  // 1. margin: the two lowest rungs of every currency, through the worst fee stack
  let worst = 1;
  for (const cur of Object.keys(book.ladders)) for (const i of [0, 1]) {
    const gross = usdOf(book, cur, i), net = gross / (1 + maxTax), fee = g.morFeePct * gross + g.morFeeFixedUsd;
    const share = (net - fee - g.aiCostUsd) / net; worst = Math.min(worst, share);
    if (share < g.marginTarget) failures.push({ rule: 'margin', detail: `${cur} rung ${i + 1} keeps ${(share * 100).toFixed(0)}% of the net price after fees and AI cost; the target is ${(g.marginTarget * 100).toFixed(0)}%` });
  }
  report.margin = { worstShare: Math.round(worst * 1000) / 1000, target: g.marginTarget };
  // 2. corridor: the same rung, across currencies, in dollars
  let widest = 1;
  for (let i = 0; i < book.rungsUsd.length; i++) {
    const v = Object.keys(book.ladders).map(c => usdOf(book, c, i)), r = Math.max(...v) / Math.min(...v);
    widest = Math.max(widest, r);
    if (r > g.corridorRatio) failures.push({ rule: 'corridor', detail: `rung ${i + 1} differs by ${r.toFixed(2)}x between currencies; the limit is ${g.corridorRatio}x` });
  }
  report.corridor = { widest: Math.round(widest * 1000) / 1000, limit: g.corridorRatio };
  // 3. drift: each price point against its dollar target, at the rates the book froze (or at `ctx.currentFx` when checking an active book)
  const perUsd = ctx.currentFx || book.fx.perUsd, band = ctx.currentFx ? g.releaseDriftPct : g.driftBandPct;
  let maxDrift = 0; const drifted = new Set();
  for (const cur of Object.keys(book.ladders)) for (let i = 0; i < book.rungsUsd.length; i++) {
    const d = Math.abs(usdOf(book, cur, i, perUsd) / book.rungsUsd[i] - 1); maxDrift = Math.max(maxDrift, d);
    if (d > band) drifted.add(cur);
  }
  for (const cur of drifted) failures.push({ rule: 'drift', detail: `${cur} has price points more than ${(band * 100).toFixed(0)}% from their dollar targets` });
  report.drift = { max: Math.round(maxDrift * 1000) / 1000, band, drifted: [...drifted] };
  // 4. step: against the previous version
  let maxStep = 0;
  if (ctx.previous) for (const cur of Object.keys(book.ladders)) {
    const before = ctx.previous.ladders[cur]; if (!before) continue;
    for (let i = 0; i < book.ladders[cur].length; i++) {
      const s = Math.abs(book.ladders[cur][i] / before[i] - 1); maxStep = Math.max(maxStep, s);
      if (s > g.maxStepPct) failures.push({ rule: 'step', detail: `${cur} rung ${i + 1} moves ${(s * 100).toFixed(0)}%; the limit is ${(g.maxStepPct * 100).toFixed(0)}%` });
    }
  }
  report.step = { max: Math.round(maxStep * 1000) / 1000, limit: g.maxStepPct };
  return { ok: failures.length === 0, failures, report };
}

module.exports = { roundPrice, ceilPrice, rungsUsd, generateBook, checkGuardrails, usdOf };
