'use strict';
/**
 * ShelterKart — markets, one source of truth.
 *
 * Keys match the frontend's LOCALES codes. `registry` names a connector
 * in registry.js; null means the search lane alone, which still
 * delivers a full graded brief with questions -- just without findings
 * confirmed through an official API call.
 *
 * `status` records the evidence behind each market, exactly as
 * researched and written into the sources table:
 *   reviewed  terms read on the source's own page
 *   evidence  strong evidence, primary page not yet read
 *   signup    free, needs a registration step
 *   pending   external approval in progress
 *   partial   a specific, named limitation (see note)
 */
const MARKETS = {
  uk: { label: 'United Kingdom', status: 'reviewed', registry: 'gb',
        note: 'Developer checked live at Companies House.' },
  fr: { label: 'France', status: 'reviewed', registry: 'fr',
        note: 'Developer checked live in the official company register.' },
  no: { label: 'Norway', status: 'reviewed', registry: 'no',
        note: 'Developer checked live in the Register of Business Enterprises.' },
  sg: { label: 'Singapore', status: 'reviewed', registry: 'sg',
        note: 'Developer checked live in ACRA\u2019s register of entities.' },
  ie: { label: 'Ireland', status: 'reviewed', registry: 'ie',
        note: 'Developer checked live in the Companies Registration Office register.' },
  tw: { label: 'Taiwan', status: 'reviewed', registry: 'tw',
        note: 'Developer checked live in the Ministry of Economic Affairs company register, including suspensions and revocations.' },
  au: { label: 'Australia', status: 'reviewed', registry: 'au',
        note: 'Developer checked live on the Australian Business Register (needs a free ABR key on the server).' },
  fi: { label: 'Finland', status: 'reviewed', registry: 'fi',
        note: 'Developer checked live in the official register, including restructuring, liquidation and bankruptcy.' },
  cz: { label: 'Czech Republic', status: 'reviewed', registry: 'cz',
        note: 'Developer checked live in ARES, the official register of economic subjects.' },
  ee: { label: 'Estonia', status: 'evidence', registry: null, note: 'Research brief.' },
  lv: { label: 'Latvia', status: 'evidence', registry: null, note: 'Research brief.' },
  pl: { label: 'Poland', status: 'evidence', registry: 'pl',
        note: 'Research brief. When the developer\u2019s KRS number is found, its National Court Register extract is read live (by number only: the register has no name search).' },
  es: { label: 'Spain', status: 'evidence', registry: null, note: 'Research brief.' },
  lt: { label: 'Lithuania', status: 'evidence', registry: null, note: 'Research brief.' },
  dk: { label: 'Denmark', status: 'signup', registry: null, note: 'Research brief.' },
  ch: { label: 'Switzerland', status: 'signup', registry: null, note: 'Research brief.' },
  be: { label: 'Belgium', status: 'signup', registry: null, note: 'Research brief.' },
  se: { label: 'Sweden', status: 'signup', registry: null, note: 'Research brief.' },
  ae: { label: 'Dubai', status: 'pending', registry: null,
        note: 'Research brief. Official project and escrow data arrives once Dubai Pulse access is approved.' },
  in: { label: 'India', status: 'partial', registry: 'in', depth: 'Insolvency checked at source',
        note: 'The developer is checked against IBBI\u2019s insolvency claims register when its CIN is known. Project records are open in some states and blocked in others, including Maharashtra.' },
  hk: { label: 'Hong Kong', status: 'partial', registry: null,
        note: 'Research brief. Official sales documents are cited and linked, never republished.' },
  nz: { label: 'New Zealand', status: 'partial', registry: null,
        note: 'Research brief. Builder-register data is limited by law to certain uses.' },
  // Added October 2026 after the market feasibility study: each passed its gates (the US as a two-state pilot).
  ca: { label: 'Canada', status: 'evidence', registry: null,
        note: 'Research brief, Ontario first: the investigator reads the HCRA Ontario Builder Directory (licence, convictions, warranty record) and, in British Columbia, BC Housing\u2019s builder registry.' },
  my: { label: 'Malaysia', status: 'evidence', registry: null,
        note: 'Research brief: the investigator reads the housing ministry\u2019s TEDUH portal for the developer\u2019s licence and the project\u2019s advertising and sales permit.' },
  us: { label: 'United States', status: 'evidence', registry: 'us',
        note: 'Pilot in Florida and New York: research brief from SEC filings, federal court dockets, Florida\u2019s company register and New York\u2019s condominium offering plans. A person reviews adverse findings before release.' },
  // Added October 2026 to cover the major markets: research briefs, depth stated plainly in each note.
  de: { label: 'Germany', status: 'evidence', registry: null,
        note: 'Research brief. Company records (Handelsregister), insolvency notices and published accounts are public; the land register (Grundbuch) opens only with a legitimate interest, so the report says what to ask the notary for.' },
  nl: { label: 'Netherlands', status: 'evidence', registry: null,
        note: 'Research brief from the KvK company register, the insolvency register and the Woningborg and SWK new-home guarantee schemes. Land-registry (Kadaster) extracts are paid; the report says which to order.' },
  pt: { label: 'Portugal', status: 'evidence', registry: null,
        note: 'Research brief from the commercial register, the courts\u2019 insolvency portal (Citius) and municipal licences. Land-registry certificates are listed for the buyer to request.' },
  it: { label: 'Italy', status: 'evidence', registry: null,
        note: 'Research brief from the company register and court records. Land and mortgage records (Catasto, Conservatoria) are paid extracts the report tells the buyer to request.' },
  sa: { label: 'Saudi Arabia', status: 'evidence', registry: null,
        note: 'Research brief led by the Wafi off-plan sales programme (licensed projects and their escrow), with company records from the commercial register.' },
  za: { label: 'South Africa', status: 'evidence', registry: null,
        note: 'Research brief from the NHBRC home-builder register and home enrolment, the companies register (CIPC) and deeds records.' },
  br: { label: 'Brazil', status: 'evidence', registry: null,
        note: 'Research brief from the incorporation registered at the property registry, the company register (CNPJ) and court records.' },
  mx: { label: 'Mexico', status: 'evidence', registry: null,
        note: 'Research brief from the public property registry, municipal licences and PROFECO\u2019s rules for selling new homes. Foreign buyers near coasts and borders buy through a bank trust.' },
  jp: { label: 'Japan', status: 'evidence', registry: null,
        note: 'Research brief from the national register of licensed real estate and construction businesses; property records are paid extracts from the legal affairs bureau.' },
  th: { label: 'Thailand', status: 'evidence', registry: null,
        note: 'Research brief from the company register (DBD), the Land Department\u2019s title records, condominium registration and environmental approval for larger projects.' },
  ph: { label: 'Philippines', status: 'evidence', registry: null,
        note: 'Research brief led by the DHSUD licence to sell and certificate of registration, with company records from the SEC.' }
};

/** What a registry check actually establishes differs by market. India's
 *  IBBI check covers insolvency only, so its label says exactly that. */
function depthOf(code) {
  const m = MARKETS[code];
  if (!m || !m.registry) return 'Research';
  return m.depth || 'Developer confirmed at source';
}

module.exports = { MARKETS, depthOf };
