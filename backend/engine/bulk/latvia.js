'use strict';
/**
 * Latvia: the Register of Enterprises' open data (data.gov.lv, dataset "uz", licence CC0-1.0, refreshed daily by the register).
 * One semicolon-separated file of every registered entity. Columns as read from the live file on 7 Nov 2026.
 *
 * Only companies and organisations are kept. Sole traders (IK), individual enterprises (IND) and farms (ZEM) are named after a person
 * and a due-diligence report on a developer has no use for them, so they are not stored. Nothing about owners or board members is in
 * this file.
 */
const DATASET_URL = 'https://data.gov.lv/dati/dataset/uz';
const FILE_URL = 'https://data.gov.lv/dati/dataset/4de9697f-850b-45ec-8bba-61fa09ce932f/resource/25e80bf3-f107-4ab4-89ef-251b5b9374e9/download/register.csv';
const KEEP = new Set(['SIA', 'AS', 'PS', 'KS', 'KB', 'VU', 'PSV', 'FIL', 'AKF']);   // limited company, joint-stock, general and limited partnership, cooperative, state and municipal enterprise, branches

/** The part of a name worth comparing: accents and punctuation gone, Latvian legal forms removed ("Pillar, SIA" and "PILLAR" meet). */
const keyOf = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ')
  .replace(/\b(sia|as|ps|ks|kb)\b/g, ' ').replace(/\s+/g, ' ').trim();
const date = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '').trim()) ? String(v).trim() : null;

const spec = {
  country: 'lv', url: FILE_URL, hosts: ['data.gov.lv'], delimiter: ';',
  columns: ['regcode', 'name', 'name_in_quotes', 'type', 'type_text', 'registered', 'terminated', 'address'],
  minRows: 50000,
  rowOf(r) {
    if (!KEEP.has(String(r.type).trim()) || !/^\d{11}$/.test(String(r.regcode).trim())) return null;
    const name = String(r.name).trim(), key = keyOf(r.name_in_quotes || name);
    if (!name || !key) return null;
    return { reg_id: String(r.regcode).trim(), name, name_key: key, legal_form: String(r.type_text).trim() || null, registered: date(r.registered), terminated: date(r.terminated),
      address: String(r.address).trim() || null };
  },
};
module.exports = { spec, keyOf, DATASET_URL, FILE_URL };
