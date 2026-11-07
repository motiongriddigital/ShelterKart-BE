'use strict';
/**
 * ShelterKart — the registry lane.
 *
 * Only connectors whose REAL response shape has been seen are built:
 *   gb  Companies House API   (terms read: automated access permitted)
 *   fr  recherche-entreprises (live JSON seen; Etalab Licence Ouverte 2.0)
 *   no  Enhetsregisteret API  (official docs read; NLOD, no registration)
 *   sg  ACRA on data.gov.sg   (official column legend read; Open Data Licence)
 *   fi  PRH YTJ API v3        (official OpenAPI schema read; CC BY 4.0)
 *   cz  ARES                  (Finance Ministry: open to anyone, <=500 req/min)
 *   au  ABN Lookup            (official JSON service; free key = terms accepted)
 *   ie  CRO open data         (CRO data dictionary read; CKAN; CC BY 4.0)
 *   tw  MOEA GCIS open data   (official Swagger read; usage notification required)
 *   in  IBBI claims register  (per-CIN pages; insolvency only)
 *   pl  KRS Open API          (live extract seen 7 Nov 2026; by KRS number only, no name search)
 *   lv  Register of Enterprises bulk file (CC0; loaded daily by engine/bulk, looked up locally)
 *   us  SEC EDGAR             (documented endpoints; field names NOT yet seen live; off until SEC_USER_AGENT is set)
 * NOT built, because no real response structure could be confirmed from
 * an official source: New Zealand (raw API fields undocumented publicly).
 * A guessed parser is what this file exists to prevent.
 *
 * Parsers are defensive: a field that is missing or of an unexpected
 * type produces NO claim, never a wrong one.
 * Every other market uses the search lane. A connector guessed from a
 * plausible-looking shape fails silently, and that is the most
 * dangerous thing a trust product can ship.
 *
 * Every connector takes an injected `http(url, {headers})` returning
 * {status, json()} -- in production that is the egress-guarded fetch,
 * in tests a mock. Nothing here touches the network directly.
 */

// Only legal FORMS are stripped. "Group" and "Holdings" were stripped in
// the first version, which erased exactly the words that tell
// "Berkeley Group Holdings" apart from "Berkeley Solaris Consulting".
const LEGAL_SUFFIX = /\b(limited|ltd|plc|llp|private|pvt|p\.?l\.?c|s\.?a\.?s?|sarl|as|asa|gmbh|the|co|company|inc|llc|pte|bv|nv|ab|oy|oyj|aps|sro|s\.r\.o|a\.s|pty)\b\.?/gi;

function clean(name) {
  return String(name || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(LEGAL_SUFFIX, ' ').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Symmetric name similarity (F1 over words). The first version only
 *  asked whether the searched words appeared in the candidate, so
 *  "Berkeley" scored 1.0 against "Berkeley Solaris Consulting" and the
 *  connector matched the wrong company -- the name-alike trap, caught by
 *  this file's own tests. Extra words in either name now count against
 *  the match. */
const CJK = /[\u3400-\u9fff]/;
// Taiwan's register holds Chinese legal names, which the word-based
// score below strips out entirely. Chinese names are compared as whole
// strings once standard company-form suffixes are removed.
const CJK_FORMS = /(股份有限公司|有限公司|股份公司|公司)$/;
function cjkScore(a, b) {
  const x = String(a).replace(/\s+/g, '').replace(CJK_FORMS, ''), y = String(b).replace(/\s+/g, '').replace(CJK_FORMS, '');
  if (!x || !y) return 0;
  if (x === y) return 1;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return long.includes(short) ? short.length / long.length : 0;
}

function nameScore(query, candidate) {
  if (CJK.test(query) && CJK.test(candidate)) return cjkScore(query, candidate);
  const q = [...new Set(clean(query).split(' ').filter(Boolean))];
  const c = new Set(clean(candidate).split(' ').filter(Boolean));
  if (!q.length || !c.size) return 0;
  const overlap = q.filter(t => c.has(t)).length;
  return (2 * overlap) / (q.length + c.size);
}

/** "Zero results" is not "not found": retry with simpler wordings before
 *  reporting a gap. France's own documented example query returned
 *  nothing for a company that exists; a plain query found it. */
function queryVariants(q) {
  const base = String(q || '').trim();
  const stripped = base.replace(LEGAL_SUFFIX, ' ').replace(/\s+/g, ' ').trim();
  const firstTwo = stripped.split(' ').slice(0, 2).join(' ');
  return [...new Set([base, stripped, firstTwo].filter(s => s && s.length >= 2))];
}

const MIN_MATCH = 0.6;

function pickBest(candidates, query, nameOf) {
  let best = null, bestScore = 0;
  for (const c of candidates) {
    const s = nameScore(query, nameOf(c));
    if (s > bestScore) { best = c; bestScore = s; }
  }
  return bestScore >= MIN_MATCH ? { item: best, score: bestScore } : null;
}

const fmtDate = d => {
  if (!d) return '';
  const x = new Date(d);
  return isNaN(x) ? String(d) : x.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
};

/* ---------------------------------------------------------------- UK */
const companiesHouse = {
  market: 'gb',
  hosts: ['api.company-information.service.gov.uk'],
  async lookup(name, { http, env }) {
    const key = env.COMPANIES_HOUSE_API_KEY;
    if (!key) return { skipped: 'COMPANIES_HOUSE_API_KEY not set' };
    const headers = { Authorization: 'Basic ' + Buffer.from(key + ':').toString('base64') };
    const API = 'https://api.company-information.service.gov.uk';
    let hit = null;
    for (const q of queryVariants(name)) {
      const r = await http(`${API}/search/companies?q=${encodeURIComponent(q)}&items_per_page=10`, { headers });
      if (r.status !== 200) continue;
      const items = ((await r.json()).items || []);
      hit = pickBest(items, name, i => i.title);
      if (hit) break;
    }
    if (!hit) return { match: null, findings: [], pages: [] };
    const num = hit.item.company_number;
    const r = await http(`${API}/company/${encodeURIComponent(num)}`, { headers });
    if (r.status === 410) return { gone: true, match: null, findings: [], pages: [] };
    if (r.status !== 200) return { match: null, findings: [], pages: [] };
    const p = await r.json();
    const url = `https://find-and-update.company-information.service.gov.uk/company/${num}`;
    const title = `Companies House: ${p.company_name}`;
    const F = (id, topic, claim) => ({ id, topic, claim, kind: 'fact', urls: [url], lane: 'registry' });
    const findings = [
      F('r1', 'developer', `${p.company_name} (company ${num}) is registered at Companies House, incorporated ${fmtDate(p.date_of_creation)}. Status: ${p.company_status}.`)
    ];
    if (p.has_insolvency_history) findings.push(F('r2', 'legal', `Companies House records insolvency history for ${p.company_name}.`));
    else findings.push(F('r2', 'legal', `Companies House records no insolvency history for ${p.company_name}.`));
    if (p.accounts && p.accounts.overdue) findings.push(F('r3', 'financial', `${p.company_name}'s accounts are overdue at Companies House.`));
    else if (p.accounts && p.accounts.last_accounts && p.accounts.last_accounts.made_up_to)
      findings.push(F('r3', 'financial', `${p.company_name}'s latest filed accounts run to ${fmtDate(p.accounts.last_accounts.made_up_to)}.`));
    if (p.has_charges) findings.push(F('r4', 'financial', `Companies House records charges (secured lending) against ${p.company_name}.`));
    return { match: { name: p.company_name, id: num, url, score: hit.score }, findings, pages: [{ url, title }] };
  }
};

/* ------------------------------------------------------------ FRANCE */
const franceSirene = {
  market: 'fr',
  hosts: ['recherche-entreprises.api.gouv.fr'],
  async lookup(name, { http }) {
    let hit = null;
    for (const q of queryVariants(name)) {
      const r = await http(`https://recherche-entreprises.api.gouv.fr/search?q=${encodeURIComponent(q)}&per_page=10`, {});
      if (r.status !== 200) continue;
      hit = pickBest((await r.json()).results || [], name, i => i.nom_complet);
      if (hit) break;
    }
    if (!hit) return { match: null, findings: [], pages: [] };
    const e = hit.item;
    const url = `https://annuaire-entreprises.data.gouv.fr/entreprise/${e.siren}`;
    const F = (id, topic, claim) => ({ id, topic, claim, kind: 'fact', urls: [url], lane: 'registry' });
    const active = e.etat_administratif === 'A';
    const findings = [
      F('r1', 'developer', `${e.nom_complet} (SIREN ${e.siren}) is registered in France's official company register, created ${fmtDate(e.date_creation)}. Status: ${active ? 'active' : 'ceased'}${!active && e.date_fermeture ? ' on ' + fmtDate(e.date_fermeture) : ''}.`)
    ];
    if (e.activite_principale === '41.10A') findings.push(F('r2', 'developer', `Its registered activity is residential property development (code 41.10A).`));
    const years = e.finances ? Object.keys(e.finances).sort() : [];
    if (years.length) {
      const y = years[years.length - 1], fin = e.finances[y] || {};
      if (fin.ca != null) findings.push(F('r3', 'financial', `Filed figures for ${y}: turnover €${Number(fin.ca).toLocaleString('en-GB')}${fin.resultat_net != null ? ', net result €' + Number(fin.resultat_net).toLocaleString('en-GB') : ''}.`));
    }
    return { match: { name: e.nom_complet, id: e.siren, url, score: hit.score }, findings, pages: [{ url, title: `Annuaire des Entreprises: ${e.nom_complet}` }] };
  }
};

/* ------------------------------------------------------------ NORWAY */
const norwayBrreg = {
  market: 'no',
  hosts: ['data.brreg.no'],
  async lookup(name, { http }) {
    let hit = null;
    for (const q of queryVariants(name)) {
      const r = await http(`https://data.brreg.no/enhetsregisteret/api/enheter?navn=${encodeURIComponent(q)}&size=10`, {});
      if (r.status !== 200) continue;
      const body = await r.json();
      hit = pickBest((body._embedded && body._embedded.enheter) || [], name, i => i.navn);
      if (hit) break;
    }
    if (!hit) return { match: null, findings: [], pages: [] };
    const e = hit.item;
    const url = `https://data.brreg.no/enhetsregisteret/oppslag/enheter/${e.organisasjonsnummer}`;
    const F = (id, topic, claim) => ({ id, topic, claim, kind: 'fact', urls: [url], lane: 'registry' });
    const findings = [
      F('r1', 'developer', `${e.navn} (org. no. ${e.organisasjonsnummer}) is in Norway's Register of Business Enterprises${e.stiftelsesdato ? ', founded ' + fmtDate(e.stiftelsesdato) : ''}.`)
    ];
    if (e.konkurs) findings.push(F('r2', 'legal', `The register marks ${e.navn} as bankrupt.`));
    if (e.underAvvikling) findings.push(F('r3', 'legal', `The register marks ${e.navn} as being wound up.`));
    if (e.underTvangsavviklingEllerTvangsopplosning) findings.push(F('r4', 'legal', `The register marks ${e.navn} as under compulsory dissolution.`));
    if (!e.konkurs && !e.underAvvikling && !e.underTvangsavviklingEllerTvangsopplosning)
      findings.push(F('r2', 'legal', `The register shows no bankruptcy, winding-up or compulsory dissolution for ${e.navn}.`));
    if (e.sisteInnsendteAarsregnskap) findings.push(F('r5', 'financial', `Most recent annual accounts filed: ${e.sisteInnsendteAarsregnskap}.`));
    return { match: { name: e.navn, id: e.organisasjonsnummer, url, score: hit.score }, findings, pages: [{ url, title: `Brønnøysund Register: ${e.navn}` }] };
  }
};


const str = v => (typeof v === 'string' && v.trim()) ? v.trim() : '';

/* --------------------------------------------------------- SINGAPORE */
const SG_DATASET = 'd_3f960c10fed6145404ca7b821f263b87'; // Entities Registered with ACRA
const singaporeAcra = {
  market: 'sg',
  hosts: ['data.gov.sg'],
  async lookup(name, { http }) {
    let hit = null;
    for (const q of queryVariants(name)) {
      const r = await http(`https://data.gov.sg/api/action/datastore_search?resource_id=${SG_DATASET}&q=${encodeURIComponent(q)}&limit=20`, {});
      if (r.status !== 200) continue;
      const body = await r.json();
      const recs = body && body.result && Array.isArray(body.result.records) ? body.result.records : [];
      hit = pickBest(recs.filter(x => str(x.entity_name)), name, i => i.entity_name);
      if (hit) break;
    }
    if (!hit) return { match: null, findings: [], pages: [] };
    const e = hit.item;
    const url = `https://data.gov.sg/datasets/${SG_DATASET}/view`;
    const F = (id, topic, claim) => ({ id, topic, claim, kind: 'fact', urls: [url], lane: 'registry' });
    const findings = [];
    const status = str(e.uen_status_desc);
    findings.push(F('r1', 'developer', `${e.entity_name} (UEN ${e.uen}) appears in ACRA's register of entities${str(e.entity_type_desc) ? ' as a ' + e.entity_type_desc : ''}${str(e.uen_issue_date) ? ', UEN issued ' + fmtDate(e.uen_issue_date) : ''}.${status ? ' Status: ' + status + '.' : ''}`));
    if (/deregistered/i.test(status)) findings.push(F('r2', 'legal', `ACRA lists ${e.entity_name} as deregistered.`));
    return { match: { name: e.entity_name, id: e.uen, url, score: hit.score }, findings, pages: [{ url, title: 'ACRA: Entities Registered with ACRA (data.gov.sg)' }] };
  }
};

/* ----------------------------------------------------------- FINLAND */
const FI_SITUATION = { SANE: 'in restructuring', SELTILA: 'in liquidation', KONK: 'in bankruptcy' };
const finlandPrh = {
  market: 'fi',
  hosts: ['avoindata.prh.fi'],
  async lookup(name, { http }) {
    const currentName = c => {
      const ns = Array.isArray(c.names) ? c.names.filter(n => str(n.name)) : [];
      const cur = ns.find(n => n.version === 1 && !n.endDate) || ns[0];
      return cur ? cur.name : '';
    };
    let hit = null;
    for (const q of queryVariants(name)) {
      const r = await http(`https://avoindata.prh.fi/opendata-ytj-api/v3/companies?name=${encodeURIComponent(q)}`, {});
      if (r.status !== 200) continue;
      const body = await r.json();
      const cos = body && Array.isArray(body.companies) ? body.companies : [];
      hit = pickBest(cos.filter(c => c.businessId && str(c.businessId.value) && currentName(c)), name, currentName);
      if (hit) break;
    }
    if (!hit) return { match: null, findings: [], pages: [] };
    const c = hit.item, id = c.businessId.value, nm = currentName(c);
    const url = `https://avoindata.prh.fi/opendata-ytj-api/v3/companies?businessId=${encodeURIComponent(id)}`;
    const F = (fid, topic, claim) => ({ id: fid, topic, claim, kind: 'fact', urls: [url], lane: 'registry' });
    const findings = [F('r1', 'developer', `${nm} (Business ID ${id}) is in Finland's Business Information System${str(c.registrationDate) ? ', registered ' + fmtDate(c.registrationDate) : ''}.${str(c.endDate) ? ' It was dissolved on ' + fmtDate(c.endDate) + '.' : ''}`)];
    const mbl = c.mainBusinessLine && str(c.mainBusinessLine.type);
    if (mbl && mbl.startsWith('4110')) findings.push(F('r2', 'developer', `Its registered main line of business is development of building projects (TOL ${mbl}).`));
    const open = (Array.isArray(c.companySituations) ? c.companySituations : []).filter(x => FI_SITUATION[x.type] && !x.endDate);
    if (open.length) open.forEach((x, i) => findings.push(F('r3' + i, 'legal', `The register shows ${nm} ${FI_SITUATION[x.type]}${str(x.registrationDate) ? ' since ' + fmtDate(x.registrationDate) : ''}.`)));
    else findings.push(F('r3', 'legal', `The register shows no current restructuring, liquidation or bankruptcy for ${nm}.`));
    return { match: { name: nm, id, url, score: hit.score }, findings, pages: [{ url, title: `PRH / YTJ: ${nm}` }] };
  }
};

/* ---------------------------------------------------- CZECH REPUBLIC */
const ARES = 'https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty';
const czechAres = {
  market: 'cz',
  hosts: ['ares.gov.cz'],
  async lookup(name, { http, ids = [] }) {
    let e = null, score = 1;
    const ico = (String(name).match(/\b\d{8}\b/) || [])[0] || ids.map(String).find(x => /^\d{8}$/.test(x.trim()));
    if (ico) {                                   // an exact company number beats any name match
      const r = await http(`${ARES}/${ico}`, {});
      if (r.status === 200) { const b = await r.json(); if (b && str(b.obchodniJmeno)) e = b; }
    }
    if (!e) {
      for (const q of queryVariants(name.replace(/\b\d{8}\b/, '').trim())) {
        if (!q) continue;
        const r = await http(`${ARES}/vyhledat`, { method: 'POST', headers: { 'content-type': 'application/json' },
                                                  body: JSON.stringify({ obchodniJmeno: q, pocet: 20 }) });
        if (r.status !== 200) continue;
        const body = await r.json();
        const list = body && Array.isArray(body.ekonomickeSubjekty) ? body.ekonomickeSubjekty : [];
        const hit = pickBest(list.filter(x => str(x.obchodniJmeno) && str(x.ico)), name, x => x.obchodniJmeno);
        if (hit) { e = hit.item; score = hit.score; break; }
      }
    }
    if (!e) return { match: null, findings: [], pages: [] };
    const url = `${ARES}/${e.ico}`;
    const F = (id, topic, claim) => ({ id, topic, claim, kind: 'fact', urls: [url], lane: 'registry' });
    const findings = [F('r1', 'developer', `${e.obchodniJmeno} (IČO ${e.ico}) is in the Czech register of economic subjects (ARES)${str(e.datumVzniku) ? ', established ' + fmtDate(e.datumVzniku) : ''}.`)];
    if (str(e.datumZaniku)) findings.push(F('r2', 'legal', `ARES records ${e.obchodniJmeno} as terminated on ${fmtDate(e.datumZaniku)}.`));
    const nace = Array.isArray(e.czNace) ? e.czNace.map(String) : [];
    if (nace.some(n => n.startsWith('411'))) findings.push(F('r3', 'developer', `Its registered activities include development of building projects (CZ-NACE 41.1).`));
    return { match: { name: e.obchodniJmeno, id: e.ico, url, score }, findings, pages: [{ url, title: `ARES: ${e.obchodniJmeno}` }] };
  }
};

/* --------------------------------------------------------- AUSTRALIA */
const unJsonp = t => JSON.parse(String(t).trim().replace(/^[\w$.]*\(/, '').replace(/\)\s*;?\s*$/, ''));
const australiaAbr = {
  market: 'au',
  hosts: ['abr.business.gov.au'],
  async lookup(name, { http, env }) {
    const guid = env.ABR_GUID;
    if (!guid) return { skipped: 'ABR_GUID not set' };
    const J = 'https://abr.business.gov.au/json';
    let hit = null;
    for (const q of queryVariants(name)) {
      const r = await http(`${J}/MatchingNames.aspx?name=${encodeURIComponent(q)}&maxResults=10&callback=c&guid=${encodeURIComponent(guid)}`, {});
      if (r.status !== 200) continue;
      let body; try { body = unJsonp(await r.text()); } catch { continue; }
      const names = body && Array.isArray(body.Names) ? body.Names.filter(n => str(n.Abn) && str(n.Name)) : [];
      hit = pickBest(names, name, n => n.Name);
      if (hit) break;
    }
    if (!hit) return { match: null, findings: [], pages: [] };
    const r = await http(`${J}/AbnDetails.aspx?abn=${encodeURIComponent(hit.item.Abn)}&callback=c&guid=${encodeURIComponent(guid)}`, {});
    if (r.status !== 200) return { match: null, findings: [], pages: [] };
    let d; try { d = unJsonp(await r.text()); } catch { return { match: null, findings: [], pages: [] }; }
    if (!d || !str(d.Abn) || !str(d.EntityName)) return { match: null, findings: [], pages: [] };
    const url = `https://abr.business.gov.au/ABN/View?abn=${d.Abn}`;
    const F = (id, topic, claim) => ({ id, topic, claim, kind: 'fact', urls: [url], lane: 'registry' });
    const findings = [F('r1', 'developer', `${d.EntityName} (ABN ${d.Abn}${str(d.Acn) ? ', ACN ' + d.Acn : ''}) is on the Australian Business Register${str(d.EntityTypeName) ? ' as a ' + d.EntityTypeName : ''}.${str(d.AbnStatus) ? ' ABN status: ' + d.AbnStatus + (str(d.AbnStatusEffectiveFrom) ? ' from ' + fmtDate(d.AbnStatusEffectiveFrom) : '') + '.' : ''}`)];
    if (/cancel/i.test(str(d.AbnStatus))) findings.push(F('r2', 'legal', `The ABN for ${d.EntityName} is cancelled.`));
    return { match: { name: d.EntityName, id: d.Abn, url, score: hit.score }, findings, pages: [{ url, title: `ABN Lookup: ${d.EntityName}` }] };
  }
};

/* ----------------------------------------------------------- IRELAND */
// Companies Registration Office open data: CKAN datastore, resource and
// fields read from the CRO's own data dictionary. CC BY 4.0, daily.
const IE_RESOURCE = '3fef41bc-b8f4-4b10-8434-ce51c29b1bba';
const IE_PAGE = `https://opendata.cro.ie/dataset/companies/resource/${IE_RESOURCE}`;
const irelandCro = {
  market: 'ie',
  hosts: ['opendata.cro.ie'],
  async lookup(name, { http }) {
    let hit = null;
    for (const q of queryVariants(name)) {
      const r = await http(`https://opendata.cro.ie/api/3/action/datastore_search?resource_id=${IE_RESOURCE}&q=${encodeURIComponent(q)}&limit=20`, {});
      if (r.status !== 200) continue;
      const body = await r.json();
      const recs = body && body.result && Array.isArray(body.result.records) ? body.result.records : [];
      hit = pickBest(recs.filter(x => str(x.company_name) && x.company_num != null), name, x => x.company_name);
      if (hit) break;
    }
    if (!hit) return { match: null, findings: [], pages: [] };
    const e = hit.item, num = String(e.company_num);
    const F = (id, topic, claim) => ({ id, topic, claim, kind: 'fact', urls: [IE_PAGE], lane: 'registry' });
    const status = str(e.company_status);
    const findings = [F('r1', 'developer', `${e.company_name} (company ${num}) is on Ireland's Companies Registration Office register${str(e.company_type) ? ' as a ' + e.company_type : ''}${str(e.company_reg_date) ? ', registered ' + fmtDate(e.company_reg_date) : ''}.${status ? ' Status: ' + status + '.' : ''}`)];
    if (str(e.comp_dissolved_date)) findings.push(F('r2', 'legal', `The CRO records ${e.company_name} as dissolved on ${fmtDate(e.comp_dissolved_date)}.`));
    else if (/liquidat|receiv|examin|strik|dissol/i.test(status)) findings.push(F('r2', 'legal', `The CRO lists ${e.company_name}'s status as ${status}.`));
    if (str(e.last_accounts_date)) findings.push(F('r3', 'financial', `Latest accounts on file are made up to ${fmtDate(e.last_accounts_date)}.`));
    if (str(e.last_ar_date)) findings.push(F('r4', 'financial', `Last annual return filed ${fmtDate(e.last_ar_date)}.`));
    if (String(e.nace_v2_code || '').replace(/\D/g, '').startsWith('411'))
      findings.push(F('r5', 'developer', `Its registered activity is development of building projects (NACE 41.10).`));
    return { match: { name: e.company_name, id: num, url: IE_PAGE, score: hit.score }, findings, pages: [{ url: IE_PAGE, title: 'Companies Registration Office: company records' }] };
  }
};

/* ------------------------------------------------------------ TAIWAN */
// Ministry of Economic Affairs open data, from its own Swagger file.
// Names are Chinese; dates are Minguo (year 76 = 1987). The ministry asks
// every API user to file a usage notification first: this connector runs
// only once GCIS_NOTIFIED=true confirms that has been done.
const TW_API = 'https://data.gcis.nat.gov.tw/od/data/api';
const TW_SEARCH = '6BBA2268-1367-4B42-9CCA-BC17499EBE8C';   // company keyword search
const TW_DETAIL = '5F64D864-61CB-4D0D-8AD9-492047CC1EA6';   // basic data incl. suspension & revocation
const rocDate = v => {
  const m = String(v || '').trim().match(/^(\d{3})(\d{2})(\d{2})$/);
  if (!m) return '';
  return `${+m[1] + 1911}-${m[2]}-${m[3]}`;
};
const TW_STATUS = { '核准設立': 'approved and registered' };
const taiwanGcis = {
  market: 'tw',
  hosts: ['data.gcis.nat.gov.tw'],
  async lookup(name, { http, env, localName }) {
    if (env.GCIS_NOTIFIED !== 'true') return { skipped: 'GCIS usage notification not confirmed' };
    const q = str(localName) && /[\u3400-\u9fff]/.test(localName) ? localName : '';
    if (!q) return { match: null, findings: [], pages: [], note: 'no-local-name' };
    const filter = encodeURIComponent(`Company_Name like ${q} and Company_Status eq 01`);
    const r = await http(`${TW_API}/${TW_SEARCH}?$format=json&$filter=${filter}&$skip=0&$top=50`, {});
    if (r.status !== 200) return { match: null, findings: [], pages: [] };
    let list; try { list = await r.json(); } catch { list = null; }
    if (!Array.isArray(list)) return { match: null, findings: [], pages: [] };
    const hit = pickBest(list.filter(x => str(x.Company_Name) && /^\d{8}$/.test(String(x.Business_Accounting_NO || ''))), q, x => x.Company_Name);
    if (!hit) return { match: null, findings: [], pages: [] };
    const e = hit.item, no = e.Business_Accounting_NO;
    const url = `${TW_API}/${TW_DETAIL}?$format=json&$filter=${encodeURIComponent('Business_Accounting_NO eq ' + no)}`;
    const F = (id, topic, claim) => ({ id, topic, claim, kind: 'fact', urls: [url], lane: 'registry' });
    const status = str(e.Company_Status_Desc);
    const setup = rocDate(e.Company_Setup_Date);
    const findings = [F('r1', 'developer', `${e.Company_Name} (Unified Business No. ${no}) is registered with Taiwan's Ministry of Economic Affairs${setup ? ', approved ' + fmtDate(setup) : ''}.${status ? ' Status: ' + (TW_STATUS[status] || status) + '.' : ''}`)];
    const paid = Number(e.Paid_In_Capital_Amount);
    if (Number.isFinite(paid) && paid > 0) findings.push(F('r2', 'financial', `Paid-in capital on the register: NT$${paid.toLocaleString('en-GB')}.`));
    // Suspension and revocation live on the detail record.
    const d = await http(url, {});
    if (d.status === 200) {
      let det; try { det = await d.json(); } catch { det = null; }
      const row = Array.isArray(det) && det[0];
      if (row) {
        const sb = rocDate(row.Sus_Beg_Date), se = rocDate(row.Sus_End_Date), rv = rocDate(row.Revoke_App_Date);
        if (sb) findings.push(F('r3', 'legal', `The register records a suspension of business from ${fmtDate(sb)}${se ? ' to ' + fmtDate(se) : ''}.`));
        if (rv) findings.push(F('r4', 'legal', `The register records an application for revocation dated ${fmtDate(rv)}.`));
      }
    }
    return { match: { name: e.Company_Name, id: no, url, score: hit.score }, findings, pages: [{ url, title: `Taiwan MOEA company register: ${e.Company_Name}` }] };
  }
};

/* ------------------------------------------------------------- INDIA */
// IBBI publishes one page per company, keyed by its CIN, listing the
// insolvency claims filed against it. The parser reads the page's own
// "Total Records : N" line and nothing else; if that line is missing,
// the page is not understood and no finding is made.
const CIN_RE = /^[LU]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}$/;
const LLPIN_RE = /^[A-Z]{3}-?\d{4}$/;
const indiaIbbi = {
  market: 'in',
  hosts: ['ibbi.gov.in'],
  byIdOnly: true,
  async lookup(name, { http, ids = [] }) {
    const cands = ids.map(x => String(x).trim().toUpperCase().replace(/\s+/g, ''));
    const cin = cands.find(x => CIN_RE.test(x)) || cands.find(x => LLPIN_RE.test(x));
    if (!cin) return { match: null, findings: [], pages: [], note: 'no-cin' };
    const id = cin.replace('-', '');
    const url = `https://ibbi.gov.in/hi/claims/claim-process/${encodeURIComponent(id)}`;
    const r = await http(url, {});
    if (r.status !== 200) return { match: null, findings: [], pages: [] };
    const html = await r.text();
    const text = String(html).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    const m = text.match(/Total Records\s*:\s*(\d+)/i);
    if (!m) return { match: null, findings: [], pages: [] };          // page not understood: say nothing
    const n = Number(m[1]);
    const who = str(name) ? `${name} (CIN ${id})` : `the company with CIN ${id}`;
    const F = (fid, topic, claim) => ({ id: fid, topic, claim, kind: 'fact', urls: [url], lane: 'registry' });
    let findings;
    if (n > 0) {
      const d = (text.match(/Latest Claim As On Date.*?(\d{2}-\d{2}-\d{4})/i) || [])[1];
      findings = [F('r1', 'legal', `IBBI's insolvency claims register lists ${n} claims record${n === 1 ? '' : 's'} for ${who}${d ? ', latest claim as on ' + d : ''}. Claims are filed during a corporate insolvency or liquidation process.`)];
    } else {
      findings = [F('r1', 'legal', `IBBI's insolvency claims register shows no claims process for ${who}.`)];
    }
    return { match: { name: str(name) || `CIN ${id}`, id, url, score: 1 }, findings, pages: [{ url, title: `IBBI claims register: ${id}` }] };
  }
};

/* ------------------------------------------------------------ POLAND */
// KRS Open API (Ministry of Justice): an extract by KRS number only, no name search, no key. The shape below was read from a live
// extract (PKP S.A., KRS 0000019193, 7 Nov 2026); only fields seen there are read. Board and supervisory-board members are never read:
// the API masks them, and a due-diligence report on a developer does not need a person's name from here. The register's insolvency
// and removal entries were not seen in any extract, so they are only flagged (any non-empty entry whose key names them), never
// described and never reported as absent: "nothing flagged" is not "all clear".
const KRS_RE = /^000\d{7}$/;                                   // not a NIP (10 digits, never starts 000) or a REGON
const PL_FORMS = { 'SPÓŁKA AKCYJNA': 'joint-stock company (S.A.)', 'SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ': 'limited liability company (sp. z o.o.)',
  'SPÓŁKA KOMANDYTOWA': 'limited partnership (sp. k.)', 'SPÓŁKA JAWNA': 'general partnership (sp. j.)', 'PROSTA SPÓŁKA AKCYJNA': 'simple joint-stock company (P.S.A.)' };
const plDate = v => { const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(String(v || '').trim()); return m ? fmtDate(`${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`) : ''; };
const plMoney = m => {
  const v = m && typeof m.wartosc === 'string' && /^\d+(,\d+)?$/.test(m.wartosc) ? Number(m.wartosc.replace(',', '.')) : NaN;
  return Number.isFinite(v) && typeof m.waluta === 'string' ? `${v.toLocaleString('en-GB', { maximumFractionDigits: 2 })} ${m.waluta}` : '';
};
const plFlag = (node, re) => {                                  // the first key matching re that holds something
  const seen = [];
  (function walk(o, depth) {
    if (!o || typeof o !== 'object' || depth > 6) return;
    for (const [k, v] of Object.entries(o)) {
      if (re.test(k) && v && (Array.isArray(v) ? v.length : typeof v === 'object' ? Object.keys(v).length : v === true || (typeof v === 'string' && v.trim()))) seen.push(k);
      walk(v, depth + 1);
    }
  })(node, 0);
  return seen[0] || null;
};
const polandKrs = {
  market: 'pl',
  hosts: ['api-krs.ms.gov.pl'],
  byIdOnly: true,
  async lookup(name, { http, ids = [] }) {
    const krs = ids.map(x => String(x).toUpperCase().replace(/^KRS\s*/, '').replace(/[\s-]/g, '')).find(x => KRS_RE.test(x));
    if (!krs) return { match: null, findings: [], pages: [], note: 'no-krs' };
    const url = `https://api-krs.ms.gov.pl/api/krs/OdpisAktualny/${krs}?rejestr=P&format=json`;
    const r = await http(url, {});
    if (r.status !== 200) return { match: null, findings: [], pages: [] };
    const o = (await r.json() || {}).odpis;
    const head = o && o.naglowekA, d1 = o && o.dane && o.dane.dzial1;
    const who = d1 && d1.danePodmiotu && str(d1.danePodmiotu.nazwa);
    if (!head || head.numerKRS !== krs || !who) return { match: null, findings: [], pages: [] };       // not the extract we asked for, or not understood
    const F = (id, topic, claim) => ({ id, topic, claim, kind: 'fact', urls: [url], lane: 'registry' });
    const form = str(d1.danePodmiotu.formaPrawna), seat = d1.siedzibaIAdres && d1.siedzibaIAdres.siedziba || {};
    const city = [str(seat.miejscowosc), str(seat.wojewodztwo).toLowerCase()].filter(Boolean).join(', ');
    const reg = plDate(head.dataRejestracjiWKRS);
    const findings = [F('r1', 'developer', `${who} (KRS ${krs}) is entered in Poland's National Court Register (KRS)${form ? ` as a ${PL_FORMS[form] || form.toLowerCase()}` : ''}${reg ? `, registered ${reg}` : ''}${city ? `, seat ${city}` : ''}.`)];
    const cap = plMoney(d1.kapital && d1.kapital.wysokoscKapitaluZakladowego);
    if (cap) findings.push(F('r2', 'financial', `The register records ${who}'s share capital as ${cap}.`));
    const filed = (((o.dane.dzial3 || {}).wzmiankiOZlozonychDokumentach || {}).wzmiankaOZlozeniuRocznegoSprawozdaniaFinansowego || []);
    const dated = filed.map(x => ({ at: String(x && x.dataZlozenia || ''), per: str(x && x.zaOkresOdDo) })).map(x => ({ ...x, t: (/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(x.at) || []).slice(1).reverse().join('') })).filter(x => x.t).sort((a, b) => a.t < b.t ? 1 : -1);
    if (dated.length) findings.push(F('r3', 'financial', `The register records ${who}'s latest annual financial statement as filed on ${plDate(dated[0].at)}${dated[0].per ? `, for the period ${dated[0].per}` : ''}.`));
    const last = plDate(head.dataOstatniegoWpisu);
    if (last) findings.push(F('r4', 'legal', `The latest entry in the register for ${who} is dated ${last}${Number.isInteger(head.numerOstatniegoWpisu) ? ` (entry number ${head.numerOstatniegoWpisu})` : ''}.`));
    if (plFlag(o.dane, /wykre[sś]l/i) || plFlag(o.dane, /likwidac|upadlo|upadło|restrukturyz|zawieszen/i))
      findings.push(F('r5', 'legal', `The register extract for ${who} contains entries about removal from the register, liquidation, bankruptcy, restructuring or suspension. Read the extract at the cited link before relying on the other facts.`));
    return { match: { name: who, id: krs, url, score: 1 }, findings, pages: [{ url, title: `KRS extract: ${who}` }] };
  }
};

/* ------------------------------------------------------------ UNITED STATES */
// SEC EDGAR: public companies only (a private developer is simply not found). Needs SEC_USER_AGENT, a declared identity as the SEC's
// fair-access rule requires ("Company name contact@domain"); without it nothing is sent. 10 requests a second is the SEC's limit; one
// lookup makes two requests. Endpoints are the ones the SEC documents; the FIELD NAMES below come from the SEC's published
// submissions format and have NOT yet been seen live by us: the register's canary stays 'unconfirmed' until a health run with
// SEC_USER_AGENT set finds the canary company, and every field that is missing or of another type produces no claim.
const SEC_TICKERS = 'https://www.sec.gov/files/company_tickers.json';
const SEC_SUBMISSIONS = 'https://data.sec.gov/submissions/CIK';
const unitedStatesEdgar = {
  market: 'us',
  hosts: ['www.sec.gov', 'data.sec.gov'],
  async lookup(name, { http, env }) {
    const ua = str(env.SEC_USER_AGENT);
    if (!/\S+\s+\S+@\S+\.\S+/.test(ua)) return { skipped: 'SEC_USER_AGENT not set (the SEC requires a declared identity)' };
    const headers = { 'user-agent': ua, accept: 'application/json' };
    const t = await http(SEC_TICKERS, { headers });
    if (t.status !== 200) return { match: null, findings: [], pages: [] };
    const rows = Object.values(await t.json() || {}).filter(x => x && typeof x.title === 'string' && x.cik_str != null);
    const hit = pickBest(rows, name, x => x.title);
    // Every listed company is in this file, so short names have many look-alikes: a one-word query scores 0.67 against a two-word name,
    // which the shared 0.6 threshold would accept. Only a near-complete name match is taken.
    if (!hit || hit.score < 0.8) return { match: null, findings: [], pages: [] };
    const cik = String(hit.item.cik_str).padStart(10, '0');
    if (!/^\d{10}$/.test(cik)) return { match: null, findings: [], pages: [] };
    const r = await http(`${SEC_SUBMISSIONS}${cik}.json`, { headers });
    if (r.status !== 200) return { match: null, findings: [], pages: [] };
    const p = await r.json() || {};
    const entity = str(p.name);
    if (!entity || String(p.cik).padStart(10, '0') !== cik) return { match: null, findings: [], pages: [] };
    const url = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}&type=10-K&dateb=&owner=include&count=10`;
    const F = (id, topic, claim) => ({ id, topic, claim, kind: 'fact', urls: [url], lane: 'registry' });
    const inc = str(p.stateOfIncorporationDescription) || str(p.stateOfIncorporation), sic = str(p.sicDescription);
    const findings = [F('r1', 'developer', `${entity} (SEC CIK ${cik}) is registered with the US Securities and Exchange Commission as a public reporting company${sic ? `, industry: ${sic}` : ''}${inc ? `, incorporated in ${inc}` : ''}.`)];
    const rec = p.filings && p.filings.recent, forms = rec && Array.isArray(rec.form) ? rec.form : [], dates = rec && Array.isArray(rec.filingDate) ? rec.filingDate : [];
    const latest = form => { const i = forms.findIndex(f => f === form); return i >= 0 && /^\d{4}-\d{2}-\d{2}$/.test(dates[i] || '') ? dates[i] : ''; };
    const k = latest('10-K'), q = latest('10-Q');
    if (k) findings.push(F('r2', 'financial', `The SEC's EDGAR records ${entity}'s latest annual report (Form 10-K) as filed on ${fmtDate(k)}${q ? `, and its latest quarterly report (Form 10-Q) on ${fmtDate(q)}` : ''}.`));
    return { match: { name: entity, id: cik, url, score: hit.score }, findings, pages: [{ url, title: `SEC EDGAR: ${entity}` }] };
  }
};

/* ------------------------------------------------------------ LATVIA */
// The Register of Enterprises' open data (CC0), a daily bulk file loaded by engine/bulk: nothing is requested from the register while a
// report is made. Companies and organisations only. Found by registration number (11 digits) or by name; with no loaded file the
// connector says so ("not configured") instead of reporting "no match", which a buyer would read as "no such company".
const LV_DATASET = 'https://data.gov.lv/dati/dataset/uz';
const LV_FORMS = { 'Sabiedrība ar ierobežotu atbildību': 'limited liability company (SIA)', 'Akciju sabiedrība': 'joint-stock company (AS)', 'Pilnsabiedrība': 'general partnership (PS)',
  'Komandītsabiedrība': 'limited partnership (KS)', 'Kooperatīvā sabiedrība': 'cooperative society (KB)' };
const latviaUr = {
  market: 'lv',
  hosts: [],
  async lookup(name, { bulk, ids = [] }) {
    if (!bulk || !bulk.bulkStatus) return { skipped: 'the Latvian register file store is not available' };
    const st = await bulk.bulkStatus('lv');
    if (!st || !st.finished_at || (st.status !== 'ok' && !Number(st.row_count))) return { skipped: 'the Latvian register file has not been loaded on this server yet' };
    const { keyOf } = require('./bulk/latvia');
    const regid = ids.map(x => String(x).replace(/\D/g, '')).find(x => /^\d{11}$/.test(x));
    let row = regid ? await bulk.bulkGet('lv', regid) : null, score = 1;
    if (!row && str(name)) {
      const key = keyOf(name);
      if (key.length >= 3) {
        const rows = await bulk.bulkFind('lv', key.split(' ')[0]);
        const hit = pickBest(rows, key, r => r.name_key);
        if (hit) { row = hit.item; score = hit.score; }
      }
    }
    if (!row) return { match: null, findings: [], pages: [] };
    // Dates are written in UTC, so the same file gets the same date on every server.
    const day = v => { const x = v ? new Date(v) : null; return x && !isNaN(x) ? x.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : ''; };
    const asOf = day(st.last_modified) || day(st.finished_at);
    const F = (id, topic, claim) => ({ id, topic, claim, kind: 'fact', urls: [LV_DATASET], lane: 'registry' });
    const reg = day(row.registered);
    const findings = [F('r1', 'developer', `${row.name} (registration number ${row.reg_id}) is entered in the Register of Enterprises of the Republic of Latvia${row.legal_form ? ` as a ${LV_FORMS[row.legal_form] || row.legal_form.toLowerCase()}` : ''}${reg ? `, registered ${reg}` : ''}${row.address ? `, legal address ${row.address}` : ''}.`)];
    if (row.terminated) findings.push(F('r2', 'legal', `The Register of Enterprises' open data shows ${row.name} as terminated on ${day(row.terminated)}.`));
    else findings.push(F('r2', 'legal', `The Register of Enterprises' open data${asOf ? ` of ${asOf}` : ''} records no termination date for ${row.name}.`));
    return { match: { name: row.name, id: row.reg_id, url: LV_DATASET, score }, findings, pages: [{ url: LV_DATASET, title: `Register of Enterprises of Latvia: ${row.name}` }] };
  }
};

const CONNECTORS = { gb: companiesHouse, fr: franceSirene, no: norwayBrreg, sg: singaporeAcra, fi: finlandPrh, cz: czechAres, au: australiaAbr,
                     ie: irelandCro, tw: taiwanGcis, in: indiaIbbi, pl: polandKrs, us: unitedStatesEdgar, lv: latviaUr };

module.exports = { CONNECTORS, nameScore, queryVariants, pickBest, clean };
