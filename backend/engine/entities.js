'use strict';
/**
 * ShelterKart — entity memory.
 *
 * "Samraat Tropicano", "Samrat Tropicano" and its RERA number are one
 * project. Without this, each spelling ran its own pipeline, paid its
 * own search cost, and learned nothing from the others.
 *
 * Two kinds of alias, with different strength:
 *   id   a registration number, normalised. Strong: it names exactly
 *        one project, so it always resolves.
 *   name a spelling fingerprint. Weaker: two DIFFERENT projects can
 *        share a name ("Green Park" exists in many cities). So a name
 *        alias resolves only when the location doesn't contradict it,
 *        and the moment a second project with the same fingerprint
 *        appears somewhere else, that alias is marked ambiguous and is
 *        never used again. Serving the wrong project's brief is the
 *        worst thing this layer could do; a cache miss costs only time.
 */

const fold = s => String(s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '');

/** Spelling fingerprint: case, accents, punctuation, and doubled
 *  letters ("Samraat" / "Samrat", "Tropicanno" / "Tropicano") all fold
 *  to the same key. Deliberately conservative -- it does not guess at
 *  transliteration beyond collapsing repeated letters. */
function nameFingerprint(s) {
  return fold(s).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean)
    .map(t => t.replace(/(.)\1+/g, '$1')).join(' ');
}

const cleanId = id => String(id || '').replace(/[^\w]/g, '').toUpperCase();
/** Registration-number-shaped tokens: letters and at least 5 digits, 8+ long. */
function idsIn(s) {
  return (String(s || '').match(/\b[A-Z0-9-]{8,20}\b/gi) || [])
    .map(cleanId).filter(x => /\d{5,}/.test(x) && x.length >= 8);
}

class EntityIndex {
  constructor() {
    this.aliases = new Map();
    // Optional hooks, so a durable store can mirror every change without
    // this class knowing anything about storage. Never allowed to throw
    // into the caller.
    this.onChange = null;   // (alias, value) after any alias is set or changed
    this.onForget = null;   // (key) after every alias for a project is dropped
  }

  _set(alias, value) {
    this.aliases.set(alias, value);
    if (this.onChange) { try { this.onChange(alias, value); } catch {} }
  }

  _put(alias, value) {
    const cur = this.aliases.get(alias);
    if (!cur) { this._set(alias, value); return; }
    if (cur.key === value.key) return;
    // Same alias, different project. For a name, that is the ambiguity
    // this layer exists to catch: stop resolving it. For an id, the
    // newest registration wins -- ids are unique, so a conflict means
    // the earlier association was the error.
    if (alias.startsWith('name:')) this._set(alias, { ...cur, ambiguous: true });
    else this._set(alias, value);
  }

  /** Restore an alias from durable storage at startup, without echoing it
   *  back to storage. */
  load(alias, value) { this.aliases.set(alias, value); }

  /** Record every way this project can be searched for. */
  register({ key, market, query, location, project }) {
    const loc = nameFingerprint(location || (project && project.location) || '');
    for (const id of new Set([...(project && project.ids || []).map(cleanId), ...idsIn(query)]))
      if (id) this._put(`id:${market}:${id}`, { key, location: loc });
    for (const n of new Set([query, project && project.name].filter(Boolean).map(nameFingerprint)))
      if (n) this._put(`name:${market}:${n}`, { key, location: loc });
  }

  /** @returns {key, via} or null */
  resolve({ market, query, location }) {
    for (const id of idsIn(query)) {
      const hit = this.aliases.get(`id:${market}:${id}`);
      if (hit) return { key: hit.key, via: 'registration number' };
    }
    const hit = this.aliases.get(`name:${market}:${nameFingerprint(query)}`);
    if (!hit || hit.ambiguous) return null;
    const loc = nameFingerprint(location);
    // A location that doesn't match what we recorded means this may be a
    // different project with the same name. Don't guess.
    if (loc && hit.location && !hit.location.includes(loc) && !loc.includes(hit.location)) return null;
    return { key: hit.key, via: 'name' };
  }

  forgetKey(key) {
    for (const [a, v] of this.aliases) if (v.key === key) this.aliases.delete(a);
    if (this.onForget) { try { this.onForget(key); } catch {} }
  }
}

module.exports = { EntityIndex, nameFingerprint, idsIn, cleanId };
