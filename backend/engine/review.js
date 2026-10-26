'use strict';
/**
 * Adverse findings held for a person to check (blind-spot review #3).
 *
 * In the markets listed in ADVERSE_HOLD_MARKETS (codes such as "in,ae", or "all"), a report that contains a negative
 * finding is NOT shown in full until a person approves it in the admin dashboard. Until then, a buyer sees:
 *   - each negative finding replaced by a plain notice that it is being checked,
 *   - the findings held (a finding shown while it is being checked would mislead in either direction),
 *   - the "reading between the lines" section withheld, because it can repeat what the held findings say,
 *   - and the report cannot be unlocked (the quote route refuses), so nobody pays for an incomplete report.
 * With the setting empty, nothing changes. Approval is stored inside the report itself (brief.review).
 */
const HELD_TEXT = 'A finding is being checked by a person before it is shown. You can unlock this report once the check is done.';

const holdMarkets = (env = process.env) => String(env.ADVERSE_HOLD_MARKETS || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
const adverseIndexes = brief => ((brief && brief.findings) || []).map((f, i) => (f && f.stance === 'negative' ? i : -1)).filter(i => i >= 0);

function isHeld(brief, env = process.env) {
  if (!brief) return false;
  const m = holdMarkets(env);
  if (!m.length || !(m.includes('all') || m.includes(String(brief.market || '').toLowerCase()))) return false;
  if (brief.review && brief.review.status === 'approved') return false;
  // A due-diligence dossier always carries adverse material, as questions if not as findings: in a held market a person
  // releases it before it can be sold.
  if (brief.kind === 'dossier') return true;
  return adverseIndexes(brief).length > 0;
}

/** The report as a buyer may see it now. Never mutates the stored report. */
function forBuyer(brief, env = process.env) {
  if (!isHeld(brief, env)) return brief;
  const held = new Set(adverseIndexes(brief));
  const findings = brief.findings.map((f, i) => (held.has(i) ? { topic: f.topic, claim: HELD_TEXT, stance: 'neutral', mark: f.mark, sources: [], sites: 0, held: true } : f));
  const reason = `${held.size === 1 ? 'One finding is' : held.size + ' findings are'} held while a person checks it.`;
  return { ...brief, findings, reading: [], held: { count: held.size, reason: 'adverse_review', note: reason } };
}

module.exports = { isHeld, forBuyer, adverseIndexes, holdMarkets, HELD_TEXT };
