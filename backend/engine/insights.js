'use strict';
/** Admin insights: plain sentences about what needs attention, worked out by fixed rules from the numbers the other admin routes already show. Contract: docs/api/openapi.yaml, tag Admin. */

const TONES = ['bad', 'warn', 'info', 'good'];
const RULES = {
  errorsWarn: 20, errorsBad: 100,
  trafficChange: 30, trafficMinPrev: 50,
  ordersChange: 25, ordersMinPrev: 3,
  refundRate: 0.1, refundMinOrders: 5,
  checkoutToPaid: 0.3, checkoutMinStarted: 10,
  wallToCode: 0.5, wallMin: 20,
  costShareWarn: 0.5, costShareBad: 1, costMinReports: 3,
  engineFailure: 0.2, engineMinCalls: 20,
  funnelMinUsers: 20,
  max: 12,
};

const plural = (n, one, many) => `${n} ${n === 1 ? one : many || one + 's'}`;
const pct = v => `${Math.round(v * 1000) / 10}%`;
const sum = (a, k) => a.reduce((n, x) => n + (Number(x[k]) || 0), 0);

/** inputs: any of backups, registers, errors, queues, failedJobs, traffic, sales, funnel, engineHistory, engineCosts (each may be missing). Returns the insights, most urgent first. */
function generate(inputs = {}, rules = RULES) {
  const out = [], add = (id, tone, page, text, extra = {}) => out.push({ id, tone, page, text, ...extra });
  const { backups, registers, errors, queues, failedJobs, traffic, sales, funnel, engineHistory, engineCosts } = inputs;

  if (backups) {
    if (backups.level === 'error') add('backups', 'bad', 'backups', backups.text);
    else if (backups.level === 'warn') add('backups', 'warn', 'backups', backups.text);
    else if (backups.level === 'off') add('backups', 'info', 'backups', backups.text);
  }

  if (Array.isArray(registers)) {
    const down = registers.filter(r => r.state === 'down'), degraded = registers.filter(r => r.state === 'degraded');
    const names = list => list.map(r => r.label || r.market).slice(0, 5).join(', ');
    if (down.length) add('registers-down', 'bad', 'health', `${plural(down.length, 'official register is', 'official registers are')} down: ${names(down)}. Reports for ${down.length === 1 ? 'that market fall' : 'those markets fall'} back to web search.`, { value: down.length });
    if (degraded.length) add('registers-degraded', 'warn', 'health', `${plural(degraded.length, 'register is', 'registers are')} failing intermittently: ${names(degraded)}.`, { value: degraded.length });
  }

  if (errors && errors.totals) {
    const n = Number(errors.totals.error) || 0, top = errors.topSources && errors.topSources[0];
    const tail = top ? ` Most come from ${top.source || top.name || 'one place'}.` : '';
    if (n >= rules.errorsBad) add('errors', 'bad', 'health', `${n} errors in the last ${errors.hours || 24} hours.${tail}`, { value: n });
    else if (n >= rules.errorsWarn) add('errors', 'warn', 'health', `${n} errors in the last ${errors.hours || 24} hours.${tail}`, { value: n });
  }

  if (queues) {
    if (queues.disputes > 0) add('disputes', 'warn', 'disputes', `${plural(queues.disputes, 'dispute is', 'disputes are')} waiting for a decision.`, { value: queues.disputes });
    if (queues.replies > 0) add('replies', 'warn', 'replies', `${plural(queues.replies, 'developer reply is', 'developer replies are')} waiting to be approved or rejected.`, { value: queues.replies });
  }
  if (failedJobs > 0) add('failed-jobs', 'warn', 'health', `${plural(failedJobs, 'paid report or delivery has', 'paid reports or deliveries have')} failed and can be retried.`, { value: failedJobs });

  if (traffic && traffic.previous >= rules.trafficMinPrev) {
    const change = Math.round((traffic.current - traffic.previous) / traffic.previous * 100);
    if (change <= -rules.trafficChange) add('traffic', 'warn', 'traffic', `Visitors are down ${-change}% against the week before (${traffic.current} against ${traffic.previous}).`, { value: change });
    else if (change >= rules.trafficChange) add('traffic', 'good', 'traffic', `Visitors are up ${change}% against the week before (${traffic.current} against ${traffic.previous}).`, { value: change });
  }

  if (sales && sales.current && sales.previous) {
    const c = sales.current, p = sales.previous;
    if (p.orders >= rules.ordersMinPrev) {
      const change = Math.round((c.orders - p.orders) / p.orders * 100);
      if (change <= -rules.ordersChange) add('orders', 'warn', 'sales', `Paid reports are down ${-change}% against the period before (${c.orders} against ${p.orders}).`, { value: change });
      else if (change >= rules.ordersChange) add('orders', 'good', 'sales', `Paid reports are up ${change}% against the period before (${c.orders} against ${p.orders}).`, { value: change });
    }
    if (c.orders >= rules.refundMinOrders && c.refundRate != null && c.refundRate >= rules.refundRate) add('refunds', 'warn', 'sales', `${pct(c.refundRate)} of paid reports were refunded in this period (${c.refunds} of ${c.orders}).`, { value: c.refundRate });
    if (c.checkoutToPaid != null && c.orders + c.unpaidCheckouts >= rules.checkoutMinStarted && c.checkoutToPaid < rules.checkoutToPaid)
      add('checkout', 'warn', 'sales', `Only ${pct(c.checkoutToPaid)} of started checkouts ended in a payment (${c.orders} of ${c.orders + c.unpaidCheckouts}).`, { value: c.checkoutToPaid });
    if (sales.unconvertedOrders > 0) add('rates', 'info', 'sales', `${plural(sales.unconvertedOrders, 'sale is', 'sales are')} in a currency with no exchange rate, so the dollar totals leave ${sales.unconvertedOrders === 1 ? 'it' : 'them'} out.`, { value: sales.unconvertedOrders });
  }

  if (funnel) {
    const stages = funnel.visitors && funnel.visitors.stages || [];
    const wall = stages.find(s => s.label === 'Sign-in wall shown'), code = stages.find(s => s.label === 'Code requested');
    if (wall && code && wall.count >= rules.wallMin && code.count / wall.count < rules.wallToCode)
      add('wall', 'warn', 'funnel', `Only ${pct(code.count / wall.count)} of the people who see the sign-in wall ask for a code (${code.count} of ${wall.count}).`, { value: code.count / wall.count });
    const nu = funnel.newUsers;
    if (nu && nu.stages[0].count >= rules.funnelMinUsers && nu.largestDrop)
      add('funnel-drop', 'info', 'funnel', `New users stop most between "${nu.largestDrop.from}" and "${nu.largestDrop.to}": ${nu.largestDrop.percent}% do not go on (${nu.largestDrop.lost} people).`, { value: nu.largestDrop.percent });
    if (funnel.classes && funnel.classes.users >= rules.funnelMinUsers)
      add('premium-share', 'info', 'funnel', `${pct(funnel.classes.premiumShare / 100)} of ${funnel.classes.users} accounts have paid for a report.`, { value: funnel.classes.premiumShare });
  }

  if (engineHistory && engineHistory.calls >= rules.engineMinCalls && engineHistory.failures / engineHistory.calls >= rules.engineFailure)
    add('engine-failures', 'warn', 'ai-engine', `${pct(engineHistory.failures / engineHistory.calls)} of AI calls failed in the last week (${engineHistory.failures} of ${engineHistory.calls}).`, { value: engineHistory.failures / engineHistory.calls });

  if (Array.isArray(engineCosts)) {
    const priced = engineCosts.filter(r => r.priceUsd > 0);
    if (priced.length >= rules.costMinReports) {
      const share = sum(priced, 'costUsd') / sum(priced, 'priceUsd');
      if (share >= rules.costShareBad) add('cost', 'bad', 'ai-engine', `Recent paid reports cost ${pct(share)} of what buyers paid for them in AI: they lose money.`, { value: share });
      else if (share >= rules.costShareWarn) add('cost', 'warn', 'ai-engine', `Recent paid reports cost ${pct(share)} of what buyers paid for them in AI.`, { value: share });
    }
  }

  out.sort((a, b) => TONES.indexOf(a.tone) - TONES.indexOf(b.tone) || a.id.localeCompare(b.id));
  const kept = out.slice(0, rules.max);
  return kept.length ? kept : [{ id: 'quiet', tone: 'good', page: 'overview', text: 'Nothing needs attention right now.' }];
}

function mountInsightsAdmin(app, { adminAuth, wrap, rateLimit, sources, now = () => Date.now() }) {
  const A = [rateLimit({ windowMs: 15 * 60e3, max: 120, message: { ok: false, error: 'Too many requests. Please try again later.' } }), adminAuth];
  app.get('/api/admin/insights', ...A, wrap(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const names = Object.keys(sources), missing = [], inputs = {};
    await Promise.all(names.map(async k => {
      try { const v = await sources[k](); if (v !== undefined) inputs[k] = v; else missing.push(k); }
      catch (e) { missing.push(k); console.error('[insights] ' + k + ' could not be read:', e && e.message); }
    }));
    res.json({ ok: true, at: new Date(now()).toISOString(), insights: generate(inputs), missing: missing.sort() });
  }));
}

module.exports = { generate, mountInsightsAdmin, RULES };
