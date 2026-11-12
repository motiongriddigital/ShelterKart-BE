'use strict';
const D = require('./dossier');

const GROUPS = ['Legal', 'Accounts', 'Promoters', 'Sales', 'Engineering', 'Lawyer'];
const GROUP_OF = { 'legal team': 'Legal', 'accounts team': 'Accounts', promoters: 'Promoters', 'sales team': 'Sales', 'site and engineering team': 'Engineering', 'your own lawyer': 'Lawyer' };
const LIMIT = { ledger: 5, discrepancies: 3, questions: 8, rows: 6, checklist: 10, sources: 8 };
const FREE_QUESTIONS = 3;
const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const LEDGER_FIRST = ['Registered promoter', 'Sold as', 'Filed completion date', 'Marketed possession', 'Registered units', 'Sanctioned built-up area', 'Registration number'];
const DISCREPANCY_TITLE = { 'Who sells it': 'Who sells it, and who signs the contract', 'When you get it': 'The finish date does not match the record', 'What is registered': 'The size registered does not fit the size approved' };
const SOURCE_STATUS = { verified: { label: 'Confirmed in an official record', tone: 'green' }, reported: { label: 'Reported by other sources', tone: 'blue' }, claim: { label: "Developer's own claim", tone: 'slate' } };
const STATUS_RANK = { verified: 0, reported: 1, claim: 2 };

const fmtN = n => Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const money = (n, currency) => (!currency || currency === 'INR' ? '₹' + Number(n).toLocaleString('en-IN') : `${currency} ${Number(n).toLocaleString('en-US')}`);
const longDate = iso => { const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${Number(m[3])} ${MONTH[Number(m[2]) - 1]} ${m[1]}` : String(iso || ''); };
const who = t => (/^(your|the)\b/i.test(String(t)) ? String(t) : 'the ' + t);
const cap = s => String(s).charAt(0).toUpperCase() + String(s).slice(1);
const groupOf = to => GROUP_OF[to] || 'Legal';
const countBy = qs => { const out = Object.fromEntries(GROUPS.map(g => [g, 0])); for (const q of qs) out[groupOf(q.to)]++; return out; };
const shortUrl = url => { try { const u = new URL(url); const tail = decodeURIComponent(u.pathname).replace(/\/+$/, '').split('/').filter(Boolean).slice(-2).join('/'); return u.hostname.replace(/^www\./, '') + (tail ? ' / ' + tail : ''); } catch { return String(url); } };
const factsOf = d => (d.sections || []).flatMap(s => s.facts || []);
const factValue = (d, field) => { const f = factsOf(d).find(x => x.field === D.norm(field)); return f ? String(f.value || f.claim || '') : ''; };

const statsOf = c => [
  { label: 'Things we found', value: c.facts || 0, tone: 'slate', hint: `Facts gathered from ${c.sources || 0} sources` },
  { label: 'Confirmed officially', value: c.verified || 0, tone: 'green', hint: 'Seen in an official record' },
  { label: 'Reported elsewhere', value: c.reported || 0, tone: 'blue', hint: 'Found in news, listings and reviews only' },
  { label: 'Sources disagree', value: c.conflicts || 0, tone: 'amber', hint: 'Two records say different things' },
  { label: 'Our own conclusions', value: c.inferences || 0, tone: 'violet', hint: 'Worked out by us from the facts' },
  { label: 'Questions to ask', value: c.questions || 0, tone: 'slate', hint: "To put to the developer's teams" },
];

const ledgerOf = d => {
  const all = d.glance || [];
  const rank = g => { const i = LEDGER_FIRST.indexOf(g.label); return i < 0 ? LEDGER_FIRST.length : i; };
  return all.map((g, i) => ({ g, i })).sort((a, b) => rank(a.g) - rank(b.g) || a.i - b.i).slice(0, LIMIT.ledger)
    .map(({ g }) => ({ label: g.label, value: g.values.join(' / '), highlight: Boolean(g.conflict) }));
};

const discrepancyOf = (p, i) => ({
  tag: p.label, code: 'D' + (i + 1), title: DISCREPANCY_TITLE[p.label] || p.label,
  claimed: { label: 'Promised or marketed', title: p.promise, note: '' },
  official: { label: 'The record shows', title: p.record, note: '' },
  footer: { label: 'Why it matters', text: p.note || '' },
});

const questionOf = q => ({ id: q.id, category: groupOf(q.to), question: q.question, why: q.why || '', good: q.good || '', notClose: q.notAccepted || '', when: q.when });

const checklistItemOf = (q, i) => ({
  no: i + 1, group: groupOf(q.to), id: q.id, question: q.question,
  direction: `${cap('ask ' + who(q.to))}, ${q.when}.${q.good ? ' A good answer: ' + q.good : ''}`,
  status: 'Pending Response',
});

const numbersOf = d => {
  const ck = d.checks || {}, rows = (ck.prices || []).slice(0, LIMIT.rows).map(p => ({
    typology: p.label || '', area: p.area ? `${fmtN(p.area)} sq ft` : '', quoted: money(p.price, p.currency), effective: `${money(p.perSqft, p.currency)} / sq ft`, benchmark: '', variance: '',
  }));
  const checks = [
    ...(ck.area ? [{ label: 'Area', text: ck.area.text }] : []),
    ...(ck.gaps || []).map(g => ({ label: 'Dates', text: `Marketed ${g.value}; filed with the regulator ${g.filed} (${Math.abs(g.months)} months ${g.months > 0 ? 'later' : 'earlier'}).` })),
  ];
  const dl = ck.delay;
  return {
    title: 'The numbers', badge: rows.length ? 'From public listings' : '', rows, checks, footnote: rows.length ? 'Prices are as listed by sellers. No registered-price benchmark is held.' : '',
    statutory: dl ? { rule: 'Delay interest', title: 'What a delay could cost you', intro: `Delay interest runs at ${dl.annualRatePct}% a year on what you have paid${dl.basis ? ', ' + dl.basis : ''}.`,
      rows: [{ label: 'Rate', value: `${dl.annualRatePct}% a year` }, { label: `Each month, on ${money(dl.perAmount)} paid`, value: money(dl.monthly), strong: true }], outro: '' } : null,
  };
};

const sourcesOf = d => (d.sources || []).map((s, i) => ({ s, i })).sort((a, b) => (STATUS_RANK[a.s.status] ?? 3) - (STATUS_RANK[b.s.status] ?? 3) || a.i - b.i).slice(0, LIMIT.sources)
  .map(({ s }) => ({ authority: s.host || '', document: s.title || shortUrl(s.url), url: D.safeUrl(s.url), status: SOURCE_STATUS[s.status] || SOURCE_STATUS.reported,
    note: s.seen === false ? 'A cited link the search did not return; open it to check.' : '' }));

/** The investigator's dossier as the property report page draws it. `locked` is the free view: only what the preview page already shows. */
function reportView(d, { locked = true, ref = '' } = {}) {
  const p = d.project || {}, c = d.counts || {}, all = d.questions || [], name = p.name || d.query || '';
  const rest = all.slice(FREE_QUESTIONS);
  const list = locked ? all.slice(0, FREE_QUESTIONS) : all.slice(0, LIMIT.questions);
  const items = locked ? [] : all.slice(LIMIT.questions, LIMIT.questions + LIMIT.checklist).map((q, i) => checklistItemOf(q, LIMIT.questions + i));
  const view = {
    slug: D.norm(name).replace(/ /g, '-').slice(0, 60) || String(ref || d.ref || '').toLowerCase(),
    ref: ref || d.ref || '',
    researchedTo: longDate(d.asOf),
    registration: { id: (p.ids || [])[0] || '', registeredOn: locked ? '' : factValue(d, 'registration date'), jurisdiction: p.country || d.market || '' },
    name,
    address: d.location || p.location || '',
    headline: `Who you are really paying, what the record shows, and ${c.questions || 0} questions to ask before you pay.`,
    summary: `${c.facts || 0} findings from ${c.sources || 0} sources. ${c.conflicts || 0} disagreements between sources and ${c.inferences || 0} conclusions drawn by reasoning. ${d.notice || ''}`.trim(),
    ledger: locked ? [] : ledgerOf(d),
    stats: statsOf(c),
    discrepancies: (d.promises || []).slice(0, LIMIT.discrepancies).map(discrepancyOf),
    questions: list.map(questionOf),
    numbers: locked ? { title: 'The numbers', badge: '', rows: [], checks: [], footnote: '', statutory: null } : numbersOf(d),
    checklist: locked
      ? { items, groupCounts: countBy(rest), more: rest.length }
      : { items, groupCounts: countBy(all), more: Math.max(0, all.length - LIMIT.questions - items.length) },
    sources: locked ? [] : sourcesOf(d),
    counts: c,
    phase: d.phase || '',
    locked,
  };
  if (locked) view.lockedCounts = { questions: rest.length, facts: c.facts || 0, sources: c.sources || 0, conflicts: c.conflicts || 0, inferences: c.inferences || 0 };
  return view;
}

module.exports = { reportView, GROUPS };
