'use strict';
/**
 * The marketing dashboard, as pure functions over the data the platform already records.
 * It follows "Metrics, dashboards and decision triggers" in the launch strategy: seven numbers per market reviewed weekly,
 * four early warnings, the Phase 1 gate, the scale / hold / stop rules, the Phase 2 start, pause-everything, the budget rule,
 * and the weekly repeat-change-stop list. Targets stay blank until two weeks of baseline exist.
 *
 * Nothing here invents a number. Where the data to decide something does not exist yet, the answer is `unknown` with the reason
 * and what is needed. A paid report is traced to a channel when its checkout carried the buyer's source (the paid event's detail
 * ends in ':src'); older payments, or ones whose browser sent nothing, count for their market but not for any channel, and the
 * screen shows how many paid reports carry their source.
 */
const { CHANNEL_NAMES } = require('../engine/analytics');
const KNOWN_CHANNELS = new Set([...CHANNEL_NAMES, 'direct', 'other sites']);
const isAttributed = r => r.event === 'purchase_paid' && /:src$/.test(String(r.detail || ''));
const DAY = 864e5;
const ANCHORS = ['IN', 'AE', 'GB', 'SG'];                         // the anchor markets in the launch plan
const BASE_AI_USD = 7.35;                                        // the investor model's Base AI cost per paid report
const MODEL_REFUND_RATE = 0.03;                                   // the investor model's refund assumption: "low" means at or below it
const FEES_RATE = 0.05, MESSAGING_INR = 3;                        // gateway 2% + refunds handled separately; the model's messaging cost
const PAID_MEDIA = /^(cpc|ppc|paid|paidsocial|paid_social|ads?|display|boost)$/i;
const OPEN_RESPONSE = new Set(['in_review', 'held', 'needs_info']);   // awaiting_confirmation is not yet a confirmed submission
const SAMPLE = 30;                                                // visits a post or topic needs before it is judged

const iso = t => new Date(t).toISOString();
const dayOf = t => iso(t).slice(0, 10);
/** Monday (UTC) of the week a date falls in, as YYYY-MM-DD. */
function mondayOf(t) { const d = new Date(typeof t === 'string' && t.length === 10 ? t + 'T00:00:00Z' : t); const wd = (d.getUTCDay() + 6) % 7; return dayOf(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - wd * DAY); }
const addDays = (ymd, n) => dayOf(Date.parse(ymd + 'T00:00:00Z') + n * DAY);
const inRange = (row, from, to) => { const d = row.day || dayOf(row.at); return d >= from && d < to; };
const marketOf = r => String(r.market || '').toUpperCase();
const vd = r => (r.visitor || '') + '|' + (r.day || dayOf(r.at));
const isPaidVisit = r => PAID_MEDIA.test(String(r.utm_medium || ''));
const per100 = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : null);

/** The visitor-days in a period, each with its first source (the first page view carrying a channel or campaign). */
function touches(rows) {
  const first = new Map();
  for (const r of [...rows].filter(r => r.event === 'page_view' && r.visitor && r.visitor !== 'server').sort((a, b) => String(a.at).localeCompare(String(b.at)))) {
    const k = vd(r); if (!first.has(k)) first.set(k, { channel: r.channel || 'direct', campaign: r.utm_campaign || '', source: r.utm_source || '', paid: isPaidVisit(r), market: marketOf(r) });
  }
  return first;
}

/** The seven weekly numbers (and the early-warning ratios) for one market, or for every market when market is '*'. */
function measures(rows, { from, to, market = '*', spend = [], refunds = null }) {
  const R = rows.filter(r => inRange(r, from, to) && (market === '*' || marketOf(r) === market));
  const t = touches(R), visits = t.size, byChannel = {};
  for (const v of t.values()) byChannel[v.channel] = (byChannel[v.channel] || 0) + 1;
  const count = e => R.filter(r => r.event === e).length;
  const previews = count('report_open'), shares = count('share_whatsapp') + count('guide_share'), checks = count('document_check');
  const paidRows = R.filter(r => r.event === 'purchase_paid'), revenue = {};
  for (const r of paidRows) { const c = r.currency || '?'; revenue[c] = Math.round(((revenue[c] || 0) + Number(r.value || 0)) * 100) / 100; }
  const previewVisitors = new Set(R.filter(r => r.event === 'report_open' && r.visitor && r.visitor !== 'server').map(vd));
  const sp = spend.filter(s => s.week >= from && s.week < to && (market === '*' || s.market === market)), spendBy = {};
  for (const s of sp) spendBy[s.currency] = (spendBy[s.currency] || 0) + Number(s.amount || 0);
  const paid = paidRows.length, costPerPaid = {}, paidByChannel = {};
  for (const r of paidRows.filter(isAttributed)) paidByChannel[r.channel || 'direct'] = (paidByChannel[r.channel || 'direct'] || 0) + 1;
  for (const [c, a] of Object.entries(spendBy)) costPerPaid[c] = paid ? Math.round((a / paid) * 100) / 100 : null;
  return {
    visits, visitsByChannel: byChannel, previews, previewsPer100: per100(previews, visits), shares, sharesPer100: per100(shares, visits), checkRequests: checks,
    paid, attributedPaid: paidRows.filter(isAttributed).length, paidByChannel, revenue, spend: spendBy, costPerPaid, organic: sp.length === 0,
    refunds: refunds == null ? null : refunds, refundRate: refunds == null || !paid ? null : Math.round((refunds / paid) * 1000) / 10,
    audienceQuality: per100([...previewVisitors].filter(k => t.has(k)).length, visits),
  };
}

/** The baseline: the first 14 days of page views in a market. Targets may be set only once it exists. */
function baseline(rows, market) {
  const days = [...new Set(rows.filter(r => r.event === 'page_view' && (market === '*' || marketOf(r) === market)).map(r => r.day || dayOf(r.at)))].sort();
  if (!days.length) return { status: 'no_data', days: 0, need: 14 };
  const first = days[0], span = Math.round((Date.parse(days[days.length - 1]) - Date.parse(first)) / DAY) + 1;
  if (span < 14) return { status: 'collecting', days: span, need: 14, since: first };
  const m = measures(rows, { from: first, to: addDays(first, 14), market });
  return { status: 'ready', since: first, perWeek: { visits: m.visits / 2, previewsPer100: m.previewsPer100, sharesPer100: m.sharesPer100, checkRequests: m.checkRequests / 2, paid: m.paid / 2 } };
}

/** The weekly repeat-change-stop list: each social topic (utm_campaign) and platform (utm_source), judged on the previews its visitors opened. */
function repeatChangeStop(rows, { from, to, market = '*' }) {
  const R = rows.filter(r => inRange(r, from, to) && (market === '*' || marketOf(r) === market)), t = touches(R), groups = new Map();
  for (const [k, v] of t) { if (!v.campaign) continue; const g = v.source + ' · ' + v.campaign; const G = groups.get(g) || { item: g, platform: v.source, campaign: v.campaign, visits: 0, previews: 0, shares: 0 }; G.visits++; groups.set(g, G); }
  const byVd = new Map([...t].map(([k, v]) => [k, v.source + ' · ' + v.campaign]));
  for (const r of R) { if (!r.visitor || r.visitor === 'server') continue; const g = groups.get(byVd.get(vd(r))); if (!g) continue; if (r.event === 'report_open') g.previews++; if (r.event === 'share_whatsapp' || r.event === 'guide_share') g.shares++; }
  const all = measures(rows, { from, to, market }), bar = all.previewsPer100 || 0;
  return [...groups.values()].map(g => {
    const p = per100(g.previews, g.visits);
    const call = g.visits < SAMPLE ? 'too_early' : g.previews === 0 ? 'stop' : p >= bar ? 'repeat' : 'change';
    return { ...g, previewsPer100: p, call };
  }).sort((a, b) => b.visits - a.visits);
}

/** Paid reports per calendar month (YYYY-MM) and market. */
function paidByMonth(rows) {
  const out = {};
  for (const r of rows.filter(r => r.event === 'purchase_paid')) { const m = (r.day || dayOf(r.at)).slice(0, 7), k = marketOf(r) || '?'; (out[m] = out[m] || {})[k] = (out[m][k] || 0) + 1; }
  return out;
}
const total = o => Object.values(o || {}).reduce((a, b) => a + b, 0);

/** The Phase 1 gate: all five conditions from the strategy, each met, not met, or unknown with what is missing. */
function gate({ rows, now, settings = {}, refundCount = null, responses = null }) {
  const pm = paidByMonth(rows), cur = dayOf(now).slice(0, 7);
  const months = Object.keys(pm).filter(m => m < cur).sort(), last2 = months.slice(-2), lastM = months[months.length - 1];
  const c1 = last2.length === 2 && last2.every(m => total(pm[m]) >= 100)
    ? { status: 'met' } : { status: 'not_met', detail: last2.length < 2 ? 'Fewer than two complete months of sales.' : `Last two months: ${last2.map(m => total(pm[m])).join(' and ')} paid reports.` };
  const ai = settings.aiCostMeasuredUsd;
  const c2 = ai == null ? { status: 'unknown', detail: 'The AI cost per report has not been measured. Record it after the first live run.' } : ai <= BASE_AI_USD ? { status: 'met', detail: `Measured $${ai} against the Base $${BASE_AI_USD}.` } : { status: 'not_met', detail: `Measured $${ai}, above the Base $${BASE_AI_USD}.` };
  const paidAll = rows.filter(r => r.event === 'purchase_paid').length;
  const legalOpen = responses == null ? null : responses.filter(x => x.kind === 'legal' && OPEN_RESPONSE.has(x.status)).length;
  const rate = refundCount == null || !paidAll ? null : refundCount / paidAll;
  const c3 = refundCount == null || responses == null ? { status: 'unknown', detail: 'Refunds or complaints are not connected (they need the database).' }
    : rate != null && rate <= MODEL_REFUND_RATE && legalOpen === 0 ? { status: 'met', detail: `Refund rate ${(rate * 100).toFixed(1)}%; no open legal complaint.` }
    : { status: 'not_met', detail: `${rate == null ? 'No sales yet' : 'Refund rate ' + (rate * 100).toFixed(1) + '% (the model assumes 3%)'}; ${legalOpen} open legal complaint(s).` };
  const tenPlus = lastM ? Object.entries(pm[lastM]).filter(([, n]) => n >= 10).map(([k]) => k) : [];
  const c4 = tenPlus.length >= 2 ? { status: 'met', detail: tenPlus.join(', ') } : { status: 'not_met', detail: `${tenPlus.length} market(s) with 10 or more paid reports last month.` };
  const paidMarkets = settings.paidMarkets || [], counsel = settings.counselHousingAd || {};
  const c5 = !paidMarkets.length ? { status: 'not_met', detail: 'Name the markets you plan to pay in, and record counsel\'s decision on the Housing ad category for each.' }
    : paidMarkets.every(m => counsel[m]) ? { status: 'met' } : { status: 'not_met', detail: 'No decision yet for: ' + paidMarkets.filter(m => !counsel[m]).join(', ') };
  const conditions = [
    { id: 'sales', label: 'At least 100 paid reports a month for two months in a row', ...c1 },
    { id: 'ai_cost', label: 'AI cost per report measured, at the model\'s Base case or better', ...c2 },
    { id: 'quality', label: 'Refund rate low, and no legal complaint about a published item open', ...c3 },
    { id: 'markets', label: 'At least two markets with 10 or more paid reports a month', ...c4 },
    { id: 'counsel', label: 'Counsel has decided on the Housing ad category in each paid market', ...c5 },
  ];
  return { open: conditions.every(c => c.status === 'met'), conditions };
}

/** Scale, hold or stop from the last four weeks against the market's ceiling: per channel when the spend names a channel the analytics
 *  knows (and paid reports carry their source), otherwise per market, all channels together. */
function channelDecisions({ rows, spend = [], ceilings = {}, weeks }) {
  const groups = new Map();
  for (const s of spend) { const ch = String(s.channel || '').toLowerCase(), key = KNOWN_CHANNELS.has(ch) ? s.market + '|' + ch : s.market + '|*'; groups.set(key, { market: s.market, channel: KNOWN_CHANNELS.has(ch) ? ch : null }); }
  return [...groups.values()].map(({ market: mk, channel }) => {
    const scope = channel || 'whole market (all spend over all paid reports)', ce = ceilings[mk];
    if (!ce || !ce.amount) return { market: mk, scope, call: 'unknown', detail: 'Set a cost ceiling for this market first.' };
    const series = weeks.map(w => {
      const to = addDays(w, 7), sp = spend.filter(s => s.market === mk && s.week === w && s.currency === ce.currency && (channel ? String(s.channel).toLowerCase() === channel : true)).reduce((a, s) => a + Number(s.amount || 0), 0);
      const paid = rows.filter(r => r.event === 'purchase_paid' && inRange(r, w, to) && marketOf(r) === mk && (channel ? isAttributed(r) && (r.channel || 'direct') === channel : true)).length;
      return { week: w, spend: sp, paid, cost: paid ? sp / paid : null };
    });
    const last4 = series.slice(-4), cum = last4.reduce((a, s) => ({ spend: a.spend + s.spend, paid: a.paid + s.paid }), { spend: 0, paid: 0 });
    const ratio = s => (s.cost == null ? (s.spend > 0 ? Infinity : null) : s.cost / ce.amount), out = (call, detail) => ({ market: mk, scope, call, detail, series });
    if (cum.paid === 0 && cum.spend >= 2 * ce.amount) return out('stop', `Spent ${cum.spend} ${ce.currency}, twice the ceiling, with no sale.`);
    if (last4.length === 4 && last4.every(s => ratio(s) != null && ratio(s) > 1.5)) return out('stop', 'Above 1.5 times the ceiling for four weeks.');
    if (last4.length === 4 && last4.every(s => ratio(s) != null && ratio(s) < 1)) return out('scale', 'Under the ceiling for four weeks: raise its share by up to a third.');
    const now = ratio(series[series.length - 1]);
    if (now != null && now >= 1 && now <= 1.5) return out('hold', 'Between 1 and 1.5 times the ceiling: change one variable and retest for two weeks.');
    return out('watch', 'Not enough weeks or spend to decide.');
  });
}

/** Pause everything: a legal notice, a platform strike, or a factual error not yet corrected. */
function pauseCheck({ settings = {}, responses = null, incidents = [] }) {
  const reasons = [];
  for (const n of settings.legalNotices || []) if (!n.closed) reasons.push(`Legal notice: ${n.note || n.market || 'open'}`);
  for (const i of incidents) if (/strike|platform_warning/i.test(String(i.type || i.kind || '')) && !i.resolvedAt) reasons.push(`Platform strike: ${i.platform || ''} ${i.reason || ''}`.trim());
  if (responses) for (const r of responses) if (r.kind === 'error' && OPEN_RESPONSE.has(r.status)) reasons.push(`Factual error reported on ${r.report_ref}, not yet corrected`);
  return { triggered: reasons.length > 0, reasons, connected: { responses: responses != null } };
}

/** Phase 2: two channels pay back inside 45 days, and organic is at least half of previews.
 *  Payback: in the last 45 days, the contribution of the paid reports traced to a channel covers what was spent on it. */
function phase2({ rows, from, to, spend = [], fx = {}, aiCostUsd = BASE_AI_USD }) {
  const R = rows.filter(r => inRange(r, from, to)), t = touches(R); let paidPrev = 0, allPrev = 0;
  for (const r of R) if (r.event === 'report_open' && r.visitor && r.visitor !== 'server') { allPrev++; const v = t.get(vd(r)); if (v && v.paid) paidPrev++; }
  const organicShare = allPrev ? (allPrev - paidPrev) / allPrev : null;
  const since = addDays(to, -45), chSpend = spend.filter(s => s.week >= since && s.week < to && KNOWN_CHANNELS.has(String(s.channel || '').toLowerCase()));
  let payback = 'unknown', paybackDetail = 'No spend recorded against a channel in the last 45 days.', channels = [];
  if (chSpend.length) {
    const inr = (amt, cur) => (cur === 'INR' ? amt : fx[cur] ? amt * fx[cur] : null), need = [...new Set([...chSpend.map(s => s.currency), 'USD'])].filter(c => c !== 'INR' && !fx[c]);
    if (need.length) paybackDetail = 'Set an exchange rate for: ' + need.join(', ');
    else {
      const keys = [...new Set(chSpend.map(s => s.market + '|' + String(s.channel).toLowerCase()))];
      channels = keys.map(k => {
        const [mk, ch] = k.split('|'), spent = chSpend.filter(s => s.market === mk && String(s.channel).toLowerCase() === ch).reduce((a, s) => a + inr(Number(s.amount || 0), s.currency), 0);
        const paid = rows.filter(r => isAttributed(r) && inRange(r, since, to) && marketOf(r) === mk && (r.channel || 'direct') === ch);
        const contribution = paid.reduce((a, r) => a + inr(Number(r.value || 0), r.currency || 'INR') * (1 - FEES_RATE) - (aiCostUsd * fx.USD + MESSAGING_INR), 0);
        return { market: mk, channel: ch, spent: Math.round(spent), contribution: Math.round(contribution), paysBack: contribution >= spent && spent > 0 };
      });
      const ok = channels.filter(c => c.paysBack).length; payback = ok >= 2 ? 'met' : 'not_met';
      paybackDetail = `${ok} channel(s) paid back their spend inside 45 days; two are needed.`;
    }
  }
  return { organicShareOfPreviews: organicShare == null ? null : Math.round(organicShare * 1000) / 10, organicHalf: organicShare == null ? 'unknown' : organicShare >= 0.5 ? 'met' : 'not_met', payback, paybackDetail, channels };
}

/** Contribution for a month (revenue after fees, AI cost, messaging and refunds), in INR, and the budget rule. */
function budget({ rows, month, fx = {}, aiCostUsd = BASE_AI_USD, refundsInr = 0 }) {
  const paid = rows.filter(r => r.event === 'purchase_paid' && (r.day || dayOf(r.at)).slice(0, 7) === month);
  const missing = [...new Set(paid.map(r => r.currency || '?').filter(c => c !== 'INR' && !fx[c]))];
  if (missing.length) return { month, contribution: null, detail: 'Set an exchange rate for: ' + missing.join(', ') };
  const usd = fx.USD; if (!usd) return { month, contribution: null, detail: 'Set the USD rate to convert the AI cost.' };
  const rev = paid.reduce((a, r) => a + Number(r.value || 0) * (r.currency === 'INR' ? 1 : fx[r.currency]), 0);
  const contribution = Math.round(rev * (1 - FEES_RATE) - paid.length * (aiCostUsd * usd + MESSAGING_INR) - refundsInr);
  const b = Math.max(0, Math.round(contribution * 0.3));
  return { month, revenueInr: Math.round(rev), paid: paid.length, contribution, budget: b, split: { best: Math.round(b * 0.7), tests: Math.round(b * 0.2), reserve: Math.round(b * 0.1) }, aiCostUsd };
}

/** Monthly: markets ranked by paid reports per hour of effort. */
function rankByEffort({ rows, month, effort = {} }) {
  const pm = paidByMonth(rows)[month] || {}, mk = new Set([...Object.keys(pm), ...Object.keys(effort)]);
  return [...mk].filter(m => m !== '?').map(m => { const h = Number(effort[m] || 0), p = pm[m] || 0; return { market: m, paid: p, hours: h || null, perHour: h ? Math.round((p / h) * 100) / 100 : null }; })
    .sort((a, b) => (b.perHour ?? -1) - (a.perHour ?? -1));
}

/** Everything the screen shows, for a week. */
function build({ rows, now = Date.now(), week, weeksBack = 6, markets = [], settings = {}, spend = [], refundRows = null, responses = null, posts = [], incidents = [], citations = [] }) {
  const thisWeek = week || mondayOf(now), weeks = Array.from({ length: weeksBack }, (_, i) => addDays(thisWeek, -7 * (weeksBack - 1 - i)));
  const lastWeek = addDays(thisWeek, -7), to = addDays(thisWeek, 7);
  const refundsIn = (from, upto) => (refundRows == null ? null : refundRows.filter(r => { const d = dayOf(r.created_at); return d >= from && d < upto; }).length);
  const marketRow = mk => ({ market: mk, thisWeek: measures(rows, { from: thisWeek, to, market: mk, spend }), lastWeek: measures(rows, { from: lastWeek, to: thisWeek, market: mk, spend }), baseline: baseline(rows, mk), targets: (settings.targets || {})[mk] || null });
  const weekPosts = posts.filter(p => p.week === thisWeek && p.status !== 'canary'), held = weekPosts.filter(p => p.status === 'held' || (p.check && p.check.verdict && p.check.verdict !== 'pass')), why = {};
  for (const p of held) for (const f of (p.check && p.check.findings) || []) why[f.rule || f.id || 'unknown'] = (why[f.rule || f.id || 'unknown'] || 0) + 1;
  const resp = responses || [], openResp = resp.filter(r => OPEN_RESPONSE.has(r.status)), done = resp.filter(r => r.resolved_at && dayOf(r.resolved_at) >= thisWeek && dayOf(r.resolved_at) < to);
  const daysToResolve = done.map(r => (Date.parse(r.resolved_at) - Date.parse(r.created_at)) / DAY).sort((a, b) => a - b);
  const lastMonth = dayOf(Date.parse(thisWeek.slice(0, 7) + '-01T00:00:00Z') - DAY).slice(0, 7), latestCitMonth = citations.map(c => c.month).sort().slice(-1)[0];
  const cit = citations.filter(c => c.month === latestCitMonth);
  return {
    week: thisWeek, weeks, phase: settings.phase || 0, anchors: ANCHORS,
    connected: { analytics: true, refunds: refundRows != null, responses: responses != null, socialDesk: posts.length > 0 || incidents.length > 0 },
    total: { thisWeek: measures(rows, { from: thisWeek, to, market: '*', spend, refunds: refundsIn(thisWeek, to) }), lastWeek: measures(rows, { from: lastWeek, to: thisWeek, market: '*', spend, refunds: refundsIn(lastWeek, thisWeek) }), baseline: baseline(rows, '*') },
    anchorMarkets: ANCHORS.map(marketRow),
    allMarkets: markets.map(m => ({ name: m.name || m.code, ...marketRow(m.code) })),
    unattributed: measures(rows, { from: thisWeek, to, market: '' }),
    trend: weeks.map(w => ({ week: w, ...(({ visits, previews, paid }) => ({ visits, previews, paid }))(measures(rows, { from: w, to: addDays(w, 7), market: '*', spend })) })),
    earlyWarnings: {
      aiCitations: latestCitMonth ? { month: latestCitMonth, checked: cit.length, cited: cit.filter(c => c.cited).length } : null,
      repliesAndCorrections: responses == null ? null : { open: openResp.length, resolvedThisWeek: done.length, medianDaysToResolve: daysToResolve.length ? Math.round(daysToResolve[Math.floor(daysToResolve.length / 2)] * 10) / 10 : null },
      audienceQuality: measures(rows, { from: thisWeek, to, market: '*' }).audienceQuality,
      contentHealth: { posts: weekPosts.length, held: held.length, heldShare: per100(held.length, weekPosts.length), reasons: Object.entries(why).sort((a, b) => b[1] - a[1]).slice(0, 5) },
    },
    decisions: {
      gate: gate({ rows, now, settings, refundCount: refundRows == null ? null : refundRows.length, responses }),
      channels: channelDecisions({ rows, spend, ceilings: settings.ceilings || {}, weeks }),
      phase2: phase2({ rows, from: addDays(thisWeek, -42), to, spend, fx: settings.fx || {}, aiCostUsd: settings.aiCostMeasuredUsd ?? BASE_AI_USD }),
      pause: pauseCheck({ settings, responses, incidents }),
      budget: budget({ rows, month: lastMonth, fx: settings.fx || {}, aiCostUsd: settings.aiCostMeasuredUsd ?? BASE_AI_USD }),
    },
    channels: [...KNOWN_CHANNELS],
    repeatChangeStop: repeatChangeStop(rows, { from: thisWeek, to }),
    monthlyRanking: rankByEffort({ rows, month: lastMonth, effort: (settings.effortHours || {})[lastMonth] || {} }),
  };
}

module.exports = { isAttributed, KNOWN_CHANNELS, build, measures, baseline, repeatChangeStop, gate, channelDecisions, pauseCheck, phase2, budget, rankByEffort, paidByMonth, mondayOf, addDays, ANCHORS, BASE_AI_USD, MODEL_REFUND_RATE, SAMPLE };
