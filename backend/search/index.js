'use strict';
/**
 * ShelterKart search: the project index and the matcher.
 *
 * A project: developer (brand, legal companies, aliases) -> project (name, former names) -> phases (each with its registration
 * number and status) -> locality (aliases, neighbours) -> city. A search returns up to five candidates, each with the facts that
 * tell projects apart and a one-line reason it matched, and a confidence:
 *   sure      a registration number, or every name word matched with a clear lead and nothing contradicting the location
 *   likely    a strong match that is not certain
 *   possible  a partial match worth showing
 * The buyer always confirms before research starts. The matcher never calls a model and never fetches anything: it is cheap,
 * deterministic and cannot be talked into a result. Ranking uses only match quality and the project's own registered facts;
 * nothing can be paid for.
 */
const { tokens, fold, sim, PART } = require('./normalize');
const { hints, STOP } = require('./hints');

const GENERIC = new Set(['park', 'tower', 'towers', 'residency', 'residences', 'villa', 'villas', 'heights', 'green', 'greens', 'city', 'garden', 'gardens', 'square', 'plaza',
  'court', 'manor', 'estate', 'estates', 'homes', 'apartments', 'enclave', 'avenue', 'vista', 'grand', 'royal', 'palm', 'palms', 'sky', 'one', 'phase', 'building', 'wing', 'block']);
const CORP = new Set(['builders', 'builder', 'developers', 'developer', 'realty', 'realtors', 'group', 'properties', 'property', 'infra', 'infrastructure', 'constructions',
  'construction', 'estates', 'ltd', 'limited', 'pvt', 'private', 'llp', 'llc', 'inc', 'plc', 'co', 'company', 'housing', 'homes', 'projects', 'venture', 'ventures', 'holdings', 'fze', 'fz']);
const ID_RE = /[A-Z0-9][A-Z0-9/-]{6,24}/gi;
const cleanId = s => String(s || '').replace(/[^0-9A-Za-z]/g, '').toUpperCase();
const idsIn = q => [...new Set((String(q || '').match(ID_RE) || []).map(cleanId).filter(x => x.length >= 8 && /\d{5,}/.test(x)))];
const weight = w => (GENERIC.has(w) || PART.has(w) ? 0.35 : /^\d+$/.test(w) ? 0.8 : 1);
const MARKET_RE = /^[a-z]{2}$/;

function validEntry(e) {
  const p = [];
  if (!e || typeof e !== 'object') return ['not an object'];
  if (!e.id || typeof e.id !== 'string') p.push('id'); if (!MARKET_RE.test(String(e.market || ''))) p.push('market'); if (!e.name || typeof e.name !== 'string') p.push('name');
  for (const k of ['aliases', 'phases', 'regIds', 'configs', 'features', 'neighbours', 'localityAliases']) if (e[k] != null && !Array.isArray(e[k])) p.push(k);
  return p;
}

class ProjectIndex {
  constructor() { this.byId = new Map(); this.byReg = new Map(); this.onChange = null; }
  get size() { return this.byId.size; }

  /** Add or replace a project. Prepared word lists are cached on the entry. */
  add(raw) {
    const bad = validEntry(raw); if (bad.length) { const e = new Error('Not a valid project: ' + bad.join(', ')); e.problems = bad; throw e; }
    const e = { aliases: [], phases: [], regIds: [], configs: [], features: [], neighbours: [], localityAliases: [], developer: {}, city: '', locality: '', status: null, ...raw };
    e.developer = { name: '', legal: [], aliases: [], ...(raw.developer || {}) };
    const old = this.byId.get(e.id); if (old) for (const r of this._regs(old)) this.byReg.delete(r.key);
    const prep = s => tokens(s).filter(w => !STOP.has(w) || GENERIC.has(w));
    Object.defineProperty(e, '_', { enumerable: false, value: {
      names: [e.name, ...e.aliases].map(n => ({ text: n, toks: prep(n), former: n !== e.name })),
      dev: [e.developer.name, ...e.developer.legal, ...e.developer.aliases].filter(Boolean).map(n => tokens(n).filter(w => !CORP.has(w) && !STOP.has(w))).filter(t => t.length),
      loc: [e.locality, ...e.localityAliases].filter(Boolean).map(tokens), near: e.neighbours.map(tokens), city: tokens(e.city || ''),
    } });
    this.byId.set(e.id, e);
    for (const r of this._regs(e)) this.byReg.set(r.key, { id: e.id, phase: r.phase });
    if (this.onChange) { try { this.onChange(e); } catch {} }
    return e;
  }
  _regs(e) { return [...(e.regIds || []).map(r => ({ key: e.market + ':' + cleanId(r), phase: null })), ...(e.phases || []).filter(p => p.regId).map(p => ({ key: e.market + ':' + cleanId(p.regId), phase: p.name || null }))]; }

  /** A project ShelterKart researched becomes searchable: its name, developer, location and registration numbers. */
  addBrief(brief, market) {
    if (!brief || !brief.ref || !brief.project || !brief.project.name || !MARKET_RE.test(String(market || ''))) return null;
    const p = brief.project, id = 'r:' + brief.ref, prev = this.byId.get(id);
    return this.add({ id, market, name: p.name, aliases: prev ? prev.aliases : [], city: prev ? prev.city : '', locality: p.location || '', developer: { name: p.developer || '' },
      regIds: (p.ids || []).map(x => (typeof x === 'string' ? x : x && (x.value || x.id))).filter(Boolean), origin: 'researched', source: { label: 'ShelterKart report ' + brief.ref, date: brief.generatedAt || brief.date || null } });
  }

  /** Is this word a place we know in this market (a locality, its alias, a neighbour or a city)? */
  _isPlace(market, w) {
    for (const e of this.byId.values()) { if (e.market !== market) continue; const _ = e._; if ([..._.loc, ..._.near, _.city].some(t => t.some(x => sim(x, w) >= 0.9))) return true; }
    return false;
  }

  /** Candidates for a query. */
  match({ query = '', location = '', market, remember = null, limit = 5 } = {}) {
    const q = String(query || '').slice(0, 200), mk = String(market || '').toLowerCase();
    if (!MARKET_RE.test(mk)) return { ok: false, error: 'market' };
    const skeleton = /[\u0600-\u06FF]/.test(q + location);
    const out = new Map(), put = (e, c) => { const cur = out.get(e.id); if (!cur || c.score > cur.score) out.set(e.id, { e, ...c }); };

    for (const id of idsIn(q)) { const hit = this.byReg.get(mk + ':' + id); if (hit) put(this.byId.get(hit.id), { score: 1, via: 'registration', phase: hit.phase, reg: id }); }

    const parsed = hints(q), qn = parsed.name.filter(w => !idsIn(w).length);
    const locToks = tokens(location).filter(w => !STOP.has(w));
    const rememberYear = remember && Number(remember.year) || null;
    for (const e of this.byId.values()) {
      if (e.market !== mk || out.has(e.id) && out.get(e.id).via === 'registration') continue;
      const _ = e._, best = (w, lists) => Math.max(0, ...lists.map(t => Math.max(0, ...t.map(x => sim(w, x, { skeleton })))));
      let nameW = 0, nameGot = 0, nameAll = true, devHit = 0, locHit = 0, nearHit = 0, used = [], former = null, phaseNum = null, phaseWord = null;
      const nameLists = _.names.map(n => n.toks);
      for (let i = 0; i < qn.length; i++) {
        const w = qn[i];
        // "phase 2", "tower b", "wing c": a pointer to part of a project, not a name word
        if (PART.has(w) && qn[i + 1] && (/^\d+$/.test(qn[i + 1]) || /^[a-z]$/.test(qn[i + 1]))) { phaseWord = w; phaseNum = qn[i + 1]; i++; continue; }
        const sN = best(w, nameLists), sD = best(w, _.dev), sL = best(w, [..._.loc, _.city]), sNear = best(w, _.near);
        const top = Math.max(sN, sD, sL, sNear * 0.9);
        if (top >= 0.78 && sN === top && sN > 0) { nameW += weight(w); nameGot += weight(w) * sN; used.push(w); if (sN < 0.9) nameAll = false; }
        else if (top >= 0.78 && sD === top) devHit++;
        else if (top >= 0.78 && sL === top) locHit++;
        else if (top >= 0.78) nearHit++;
        else { nameW += weight(w); nameAll = false; }                                       // a word that fits nothing counts against the name
      }
      for (const n of _.names) if (n.former && n.toks.length && n.toks.every(t => qn.some(w => sim(w, t) >= 0.9))) former = n.text;
      for (const w of locToks) { if (best(w, [..._.loc, _.city]) >= 0.86) locHit++; else if (best(w, _.near) >= 0.86) nearHit++; }
      const nameCover = (() => { const nt = _.names.find(n => !n.former) || _.names[0]; const tw = nt.toks.reduce((a, t) => a + weight(t), 0); const got = nt.toks.filter(t => used.some(u => sim(u, t) >= 0.78)).reduce((a, t) => a + weight(t), 0); return tw ? got / tw : 0; })();
      const spare = qn.filter(w => !used.includes(w));                                   // a word used for the name is not also evidence of the developer
      const devFull = _.dev.some(t => t.every(x => spare.some(w => sim(w, x) >= 0.86)));
      let score = 0, via = '';
      if (nameW > 0 && nameGot > 0) { score = 0.65 * (nameGot / nameW) + 0.35 * nameCover; via = former ? 'former' : nameAll ? 'name' : 'spelling'; }
      else if (devFull || devHit) { score = 0.5; via = 'developer'; }
      else if (locHit || nearHit) { score = locHit ? 0.3 : 0.2; via = 'area'; }
      if (!score) continue;
      if (devFull || devHit) score += via === 'developer' ? 0 : 0.12;
      if (locHit) score += 0.08; else if (nearHit) score += 0.04;
      if (via === 'developer' && (locHit || nearHit)) { via = 'developer_area'; score += locHit ? 0.1 : 0.05; }
      let phase = null;
      if (phaseNum) { const ph = e.phases.find(p => { const t = tokens(p.name || ''); return t.includes(phaseNum) && (!phaseWord || t.some(x => sim(x, phaseWord) >= 0.9) || t.length === 1); }); if (ph) { phase = ph.name; score += 0.03; } else if (e.phases.length) score -= 0.1; }
      // A query of generic words only ("Park", "Royal Heights") is too thin to be more than a possibility.
      // ...unless those words are the project's whole name and the developer or the area confirms it ('Park Royal, Chembur').
      if ((via === 'name' || via === 'spelling' || via === 'former') && nameW > 0 && nameW < 1 && !(nameCover >= 0.99 && (locHit || devHit || devFull))) score = Math.min(score, 0.6);
      const h = parsed.hints; let bonus = 0;
      if (h.status && e.status === h.status) bonus += 0.02; if (h.config.some(c => e.configs.includes(c))) bonus += 0.02; if (h.features.some(f => e.features.includes(f))) bonus += 0.02;
      if (rememberYear && e.phases.some(p => Number(p.possession) === rememberYear)) bonus += 0.03;
      score += Math.min(bonus, 0.06);
      const contradiction = locToks.length > 0 && !locHit && !nearHit && locToks.some(w => this._isPlace(mk, w));
      if (contradiction) score -= 0.35;
      score = Math.max(0, Math.min(1, score));
      if (score >= 0.2) put(e, { score, via, phase, former, nameAll: nameW > 0 && nameAll && nameGot / nameW >= 0.9, contradiction, devMatch: Boolean(devFull || devHit), locMatch: Boolean(locHit || nearHit) });
    }

    const all = [...out.values()].sort((a, b) => b.score - a.score || a.e.name.localeCompare(b.e.name));
    const shown = all.filter(c => c.score >= 0.35).slice(0, limit), top = shown[0], second = shown[1];
    let confidence = 'none';
    if (top) {
      if (top.via === 'registration' && !(second && second.via === 'registration')) confidence = 'sure';
      else if (top.score >= 0.9 && top.nameAll && !top.contradiction && (!second || top.score - second.score >= 0.15)) confidence = 'sure';
      else if (top.score >= 0.7 && !top.contradiction) confidence = 'likely';
      else confidence = 'possible';
    }
    const card = c => ({ id: c.e.id, name: c.e.name, developer: c.e.developer.name || null, locality: c.e.locality || null, city: c.e.city || null, status: c.e.status || null,
      phase: c.phase || null, registration: c.reg || (c.e.phases.find(p => p.name === c.phase) || {}).regId || c.e.regIds[0] || (c.e.phases[0] || {}).regId || null,
      phases: c.e.phases.map(p => ({ name: p.name, registration: p.regId || null, status: p.status || null })), score: Math.round(c.score * 100) / 100,
      why: reason(c, q), source: c.e.source || null, origin: c.e.origin || null });
    const res = { ok: true, market: mk, confidence, candidates: shown.map(card), hints: parsed.hints };
    if (!shown.length) res.notFound = { closest: all.slice(0, 3).map(card), ask: ['developer', 'locality', 'year'], researchAnyway: q.trim().length >= 2 };
    return res;
  }

  /** "Tell us what you remember": the developer, the area, the year, the size, and any part of the name. */
  remember({ market, developer = '', locality = '', year = '', config = '', name = '' } = {}) {
    const query = [name, developer, config].map(s => String(s || '').slice(0, 80)).join(' ').trim();
    return this.match({ query: query || locality, location: locality, market, remember: { year } });
  }

  toJSON() { return [...this.byId.values()]; }
  load(list) { for (const e of list || []) { try { this.add(e); } catch {} } return this; }
}

function reason(c, q) {
  switch (c.via) {
    case 'registration': return { code: 'registration', text: 'Matched by registration number', detail: c.reg };
    case 'former': return { code: 'former', text: 'Matched a former name', detail: c.former };
    case 'name': return { code: 'name', text: c.devMatch || c.locMatch ? 'Name matched, with the developer or area' : 'Name matched' };
    case 'spelling': return { code: 'spelling', text: 'Close to what you typed' };
    case 'developer': return { code: 'developer', text: 'A project by the developer you named' };
    case 'developer_area': return { code: 'developer_area', text: 'A project by that developer, in that area' };
    default: return { code: 'area', text: 'A project in the area you named' };
  }
}

module.exports = { ProjectIndex, idsIn, cleanId, GENERIC };
