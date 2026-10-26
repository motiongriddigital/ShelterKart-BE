/**
 * ShelterKart — connector framework.
 *
 * WHY THIS FILE EXISTS AND WHAT IT DELIBERATELY OMITS
 *
 * A connector turns a public record into `evidence` rows. There are
 * ~51 sources registered in seed_sources.sql and every one has a
 * different portal, response shape and identifier format.
 *
 * This file defines the CONTRACT they share. It does not contain
 * working retrieval logic for any specific portal, and that omission
 * is deliberate rather than incomplete work:
 *
 *   Endpoints, DOM selectors and response schemas cannot be written
 *   without opening the live portal and reading it. Code written from
 *   a plausible guess looks correct, passes review, and then fails
 *   silently — returning empty or, far worse, mis-parsed values that
 *   flow into a published finding. For a product whose entire
 *   proposition is that every finding traces to a document, a
 *   confidently wrong parser is the most dangerous artifact we could
 *   ship.
 *
 * So each connector is implemented against the real source, by
 * someone looking at it, and must pass the conformance suite at the
 * bottom of this file before its `sources` row leaves 'unavailable'.
 */

'use strict';

const crypto = require('crypto');
const { guardedFetch, EgressBlocked, buildAllowList } = require('./egress.js');

/* ============================================================
   ERRORS
   Typed, because ingestion_jobs.error_class drives retry policy:
   a rate limit should back off, a layout change should page a human
   and stop retrying, and an auth wall should suspend the job for
   supervised handling rather than hammer the source.
   ============================================================ */
class ConnectorError extends Error {
  constructor(errorClass, message, opts = {}) {
    super(message);
    this.name = 'ConnectorError';
    this.errorClass = errorClass;   // matches ingestion_jobs.error_class
    this.retryable = opts.retryable ?? false;
    this.detail = opts.detail;
  }
}
const ERROR_CLASS = Object.freeze({
  RATE_LIMITED:   'rate_limited',    // retryable, back off
  AUTH_REQUIRED:  'auth_required',   // NOT retryable — needs a human session
  LAYOUT_CHANGED: 'layout_changed',  // NOT retryable — parser is now wrong
  TIMEOUT:        'timeout',         // retryable
  NOT_FOUND:      'not_found',       // terminal, and a legitimate answer
  BLOCKED:        'blocked',         // NOT retryable — quarantine the source
});

/* ============================================================
   THE CONTRACT
   ============================================================ */
class Connector {
  /**
   * @param {object} meta
   *   sourceKey     stable id, e.g. 'in-mh-maharera'
   *   authority     must match the sources row exactly
   *   jurisdiction  ISO-ish code, e.g. 'IN-MH'
   *   accessMode    one of the sources.access_mode values
   *   fields        field_key values this connector can produce
   */
  constructor(meta) {
    if (new.target === Connector) {
      throw new Error('Connector is abstract; extend it.');
    }
    for (const k of ['sourceKey', 'authority', 'jurisdiction', 'accessMode', 'fields']) {
      if (!meta?.[k]) throw new Error(`Connector meta missing required key: ${k}`);
    }
    Object.assign(this, meta);
  }

  /** Find candidate entities. MUST return an array — possibly empty,
   *  never null — because "no match" is a legitimate result that the
   *  report renders as insufficient evidence rather than an error. */
  async search(/* query, opts */) {
    throw new Error(`${this.sourceKey}: search() not implemented`);
  }

  /** Retrieve the raw artifact for one entity. Returns
   *  { buffer, contentType, externalRef, publishedAt, sourceUrl }.
   *  The RAW BYTES matter: they are checksummed and stored so a
   *  citation can later be proven against exactly what was fetched. */
  async fetchDocument(/* externalRef, opts */) {
    throw new Error(`${this.sourceKey}: fetchDocument() not implemented`);
  }

  /** Turn a retrieved document into candidate field values.
   *  MUST return [{ fieldKey, value, locator, confidence }].
   *  `locator` is what makes a citation clickable — page number,
   *  bounding box, table cell, or selector path. A candidate without
   *  a locator is rejected downstream. */
  async extract(/* document */) {
    throw new Error(`${this.sourceKey}: extract() not implemented`);
  }

  /** Guarded outbound fetch. Connectors MUST use this rather than
   *  calling fetch directly.
   *
   *  Fetching is the product's core loop, which is exactly why it is
   *  the SSRF surface: the server makes requests on behalf of input it
   *  did not author. It compounds with the injection problem — a
   *  hostile filing can embed a URL, so the party being assessed also
   *  chooses the destination.
   *
   *  Routing every fetch through here makes the safe path the default
   *  path. A connector written next year inherits the control without
   *  its author needing to know the threat exists. */
  async fetch(url, opts = {}) {
    if (!this._allowSet) {
      throw new Error(`${this.sourceKey}: allow-list not loaded — call setAllowList() from the sources table first`);
    }
    return guardedFetch(url, { allowSet: this._allowSet, ...opts });
  }

  /** Load permitted hosts from the sources table. */
  setAllowList(sourceRows) {
    this._allowSet = buildAllowList(sourceRows);
    return this;
  }

  /** Cheap liveness probe. The scheduler calls this before a batch so
   *  a portal that has changed or gone down is detected once, rather
   *  than through hundreds of individually failing jobs. */
  async healthCheck() {
    throw new Error(`${this.sourceKey}: healthCheck() not implemented`);
  }
}

/* ============================================================
   GROUNDING
   The structural check that stops a parser (or a model) inventing a
   value. If the extracted string does not appear in the document's
   own text, it did not come from the document. No second model is
   needed to catch this, which is what makes it trustworthy: it is
   arithmetic, not judgement.
   ============================================================ */
function assertGrounded(candidate, documentText) {
  const raw = String(candidate.value ?? '').trim();
  if (!raw) return { grounded: false, reason: 'empty value' };

  const haystack = normalise(documentText);
  const needle = normalise(raw);

  if (haystack.includes(needle)) return { grounded: true };

  // Numbers legitimately reformat between source and extraction
  // (1,23,45,678 -> 12345678). Compare digits only before failing.
  const digits = raw.replace(/\D/g, '');
  if (digits.length >= 4 && haystack.replace(/\D/g, '').includes(digits)) {
    return { grounded: true, note: 'matched on digits after formatting' };
  }
  return { grounded: false, reason: 'value not present in source document' };
}

function normalise(s) {
  return String(s)
    .toLowerCase()
    .replace(/\u00a0/g, ' ')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Checksum of the raw bytes. Lets us prove months later that the
 *  document behind a citation has not changed underneath it. */
function checksum(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/* ============================================================
   CONFORMANCE SUITE
   A connector must pass this before its sources row is promoted out
   of 'unavailable'. It tests the contract, not the portal — but it
   catches the failure modes that actually occur: null instead of [],
   missing locators, and ungrounded values.
   ============================================================ */
async function runConformance(connector, fixture) {
  const results = [];
  const check = (name, pass, detail) => results.push({ name, pass, detail });

  check('declares a source key', Boolean(connector.sourceKey));
  check('declares a jurisdiction', Boolean(connector.jurisdiction));
  check('declares producible fields',
    Array.isArray(connector.fields) && connector.fields.length > 0);

  // search() must return an array even when nothing matches.
  try {
    const r = await connector.search(fixture.noMatchQuery ?? '___no_such_entity___');
    check('search returns an array on no-match', Array.isArray(r),
      Array.isArray(r) ? `${r.length} results` : `got ${typeof r}`);
  } catch (e) {
    check('search returns an array on no-match',
      e instanceof ConnectorError && e.errorClass === ERROR_CLASS.NOT_FOUND,
      `threw ${e.message}`);
  }

  // Every extracted candidate must carry a locator and be grounded.
  if (fixture.document && fixture.documentText) {
    const candidates = await connector.extract(fixture.document);
    check('extract returns an array', Array.isArray(candidates));

    const missingLocator = (candidates || []).filter(c => !c.locator);
    check('every candidate has a locator', missingLocator.length === 0,
      `${missingLocator.length} without locator`);

    const ungrounded = (candidates || [])
      .map(c => ({ c, g: assertGrounded(c, fixture.documentText) }))
      .filter(x => !x.g.grounded);
    check('every candidate is grounded in the document', ungrounded.length === 0,
      ungrounded.map(x => `${x.c.fieldKey}: ${x.g.reason}`).join('; '));

    const undeclared = (candidates || [])
      .filter(c => !connector.fields.includes(c.fieldKey));
    check('no candidate uses an undeclared field', undeclared.length === 0,
      undeclared.map(c => c.fieldKey).join(', '));
  } else {
    check('extract tested against a fixture', false,
      'no fixture supplied — capture a real document before promoting this source');
  }

  const passed = results.filter(r => r.pass).length;
  return { passed, total: results.length, ok: passed === results.length, results };
}

/* ============================================================
   EXAMPLE — MahaRERA
   Registered so the framework can be exercised, and deliberately
   left unimplemented. Each throw names what a developer must open
   the live portal to determine. Promoting this source to 'healthy'
   before those questions are answered would put invented data behind
   a published score.
   ============================================================ */
class MahaReraConnector extends Connector {
  constructor() {
    super({
      sourceKey: 'in-mh-maharera',
      authority: 'MahaRERA (Maharashtra)',
      jurisdiction: 'IN-MH',
      accessMode: 'human_assisted',
      fields: [
        'registration_number', 'registration_status', 'promoter_legal_name',
        'project_name', 'proposed_completion_date', 'revised_completion_date',
        'total_units', 'booked_units', 'litigation_case', 'occupancy_certificate',
      ],
    });
  }

  async search() {
    throw new ConnectorError(ERROR_CLASS.AUTH_REQUIRED,
      'MahaRERA search not implemented. Open the live portal and determine: ' +
      '(a) which hostname is canonical — maharera.maharashtra.gov.in or ' +
      'maharera.mahaonline.gov.in; (b) whether project search is reachable ' +
      'without a session; (c) the request shape and pagination; ' +
      '(d) whether a CAPTCHA gates results, in which case this source stays ' +
      'human_assisted and jobs pause at awaiting_human_auth.');
  }

  async fetchDocument() {
    throw new ConnectorError(ERROR_CLASS.AUTH_REQUIRED,
      'MahaRERA fetch not implemented. Determine the per-project detail URL ' +
      'and whether disclosure documents are served as PDF or HTML — the ' +
      'extraction strategy differs completely between the two.');
  }

  async extract() {
    throw new ConnectorError(ERROR_CLASS.LAYOUT_CHANGED,
      'MahaRERA extraction not implemented. Field locations must be read off ' +
      'a real retrieved document; guessed selectors are the failure mode this ' +
      'framework exists to prevent.');
  }

  async healthCheck() {
    return { healthy: false, reason: 'connector not implemented' };
  }
}

/* ============================================================
   REGISTRY
   ============================================================ */
const registry = new Map();
function register(connector) {
  if (registry.has(connector.sourceKey)) {
    throw new Error(`Duplicate connector: ${connector.sourceKey}`);
  }
  registry.set(connector.sourceKey, connector);
  return connector;
}
function get(sourceKey) { return registry.get(sourceKey); }
function forJurisdiction(code) {
  return [...registry.values()].filter(c => c.jurisdiction === code);
}

register(new MahaReraConnector());

module.exports = {
  Connector, ConnectorError, ERROR_CLASS, EgressBlocked,
  assertGrounded, checksum, normalise,
  runConformance, register, get, forJurisdiction, registry,
};
