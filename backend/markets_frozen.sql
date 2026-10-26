-- ============================================================
-- SHELTERKART — FROZEN MARKET LIST (migration 009)
--
-- THE RULES THIS LIST WAS BUILT ON
--   1. Country-level only. An analysis type is offered in a country
--      only if a national source covers the WHOLE country. Partial
--      coverage (India's states, the UK's land registries, Canada's
--      provinces) means a buyer in the uncovered part gets an empty
--      report -- so it is excluded, not offered in part.
--   2. Three report types:
--        full       project + developer   price_multiplier 1.00
--        developer  developer only        price_multiplier 0.60
--        project    project only          price_multiplier 0.60
--      0.60 is a starting default, not a researched figure.
--   3. A country is 'launch' only if an agent actually read a live
--      primary record, or the regulator documents an official machine
--      channel. Search snippets and commercial aggregators do not
--      count -- this round found four aggregators giving four
--      different capital figures for one Indian company.
--   4. 'launch' does not bypass the legal gate (migration 007).
--      Every source still needs tos_reviewed_at set by a named
--      reviewer before a finding from it can publish.
-- ============================================================

CREATE TABLE IF NOT EXISTS markets (
  code              TEXT PRIMARY KEY,           -- matches sources.jurisdiction
  name              TEXT NOT NULL,
  coverage_note     TEXT NOT NULL,
  status            TEXT NOT NULL CHECK (status IN ('launch','wave_2','excluded')),
  report_type       TEXT CHECK (report_type IN ('full','developer','project')),
  price_multiplier  NUMERIC CHECK (price_multiplier > 0 AND price_multiplier <= 1),
  poc_entity        TEXT,
  poc_source_url    TEXT,
  poc_checked_on    DATE,
  poc_result        TEXT,
  open_items        TEXT,
  legal_status      TEXT,
  frozen_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (status = 'excluded' OR (report_type IS NOT NULL AND price_multiplier IS NOT NULL))
);

INSERT INTO markets (code, name, coverage_note, status, report_type, price_multiplier,
                     poc_entity, poc_source_url, poc_checked_on, poc_result, open_items, legal_status)
VALUES
-- ---------------------------------------------------------------- LAUNCH
('AE-DU', 'Dubai',
 'Dubai only. UAE property regulation is emirate-level; other emirates are not covered.',
 'launch', 'full', 1.00,
 'DLD registered projects and developers',
 'https://www.dubaipulse.gov.ae/data/dld-registration/dld_projects-open',
 '2026-09-23',
 'DLD Project Status page read live: project number, units, dates, completion, developer, escrow bank. Dubai Pulse publishes separate projects and developers datasets; access by permission request (about 14 days), then API key.',
 'Pulse projects dataset last updated 3 Oct 2025 -- staleness gate applies. Escrow field not yet confirmed present in Pulse.',
 'DLD website terms (read directly): personal, non-commercial use only -- never source from it. Dubai Pulse licence NOT yet confirmed from Pulse itself: commercial reuse with attribution is reported only by third-party sites. Read each dataset''s own terms before use.'),

('GB', 'United Kingdom',
 'Whole UK. Companies House registers England and Wales, Scotland and Northern Ireland.',
 'launch', 'developer', 0.60,
 'THE BERKELEY GROUP HOLDINGS PLC (05172586)',
 'https://find-and-update.company-information.service.gov.uk/company/05172586',
 '2026-09-23',
 'Live record read: active plc, incorporated 7 July 2004, last accounts to 30 April 2025. A search-snippet copy was stale -- agents cite the live record only. Brand maps to at least three entities (05172586, 01454064, 04088248).',
 'Project layer excluded: HM Land Registry covers England and Wales only, and planning is held per council.',
 'Terms read: automated access permitted; the condition is request rate, not method.'),

('IN', 'India',
 'Whole country. MCA, IBBI, NCLT and eCourts are national.',
 'launch', 'developer', 0.60,
 'IBBI corporate insolvency announcements',
 'https://ibbi.gov.in/public-announcement?ann=Public+Announcement+of+Corporate+Insolvency+Resolution+Process',
 '2026-09-23',
 'Live national list read: 9,147 announcements, updated 21 Sep 2026, CIN-level subscription available. Company identity: official OGD API (api.data.gov.in), free key required -- not executed here.',
 'eCourts litigation and BSE/NSE filings not yet verified. Project layer excluded: RERA is state-level and Maharashtra, Karnataka, Gujarat and Delhi block bots.',
 'data.gov.in catalogue pages disallow bots -- use the API. IBBI terms not yet read.'),

('HK', 'Hong Kong',
 'Whole territory. SRPE is established by statute (s.89, Cap. 621).',
 'launch', 'project', 0.60,
 'SRPE first-hand residential developments',
 'https://www.srpe.gov.hk/opip/index.htm',
 '2026-09-23',
 'robots.txt allows; pages are script-rendered, so the connector needs a headless browser. Vendors must upload sales brochures, price lists and registers of transactions.',
 'Developer layer (Companies Registry) is paid per search -- not yet verified.',
 'SRPA copyright notice: reproduction or making available to the public is prohibited without written authorisation. Cite and link only; never republish documents.'),

('SG', 'Singapore',
 'Whole country.',
 'launch', 'project', 0.60,
 'URA residential transaction search',
 'https://eservice.ura.gov.sg/property-market-information/pmiResidentialTransactionSearch',
 NULL,
 'Fetched live earlier in this session; robots.txt allows.',
 'Developer layer via ACRA is paid; price not independently verified. Upgrade to full once the ACRA purchase flow is built.',
 'URA terms not yet read.'),

('AU', 'Australia',
 'Whole country. ASIC is national.',
 'launch', 'developer', 0.60,
 'ASIC organisation and business names register',
 'https://connectonline.asic.gov.au/RegistrySearch/faces/landing/bn/SearchBnRegisters.jspx',
 '2026-09-23',
 'robots.txt allows; script-rendered app. Free: name, ACN/ABN, type, registration date, documents lodged. A banned and disqualified register covers directors.',
 'Project layer excluded: no national project register. Charges and officeholder extracts are paid.',
 'ASIC terms not yet read.'),

-- ---------------------------------------------------------------- WAVE 2
('DE', 'Germany', 'Whole country.', 'wave_2', 'developer', 0.60,
 'Handelsregister', 'https://www.handelsregister.de/rp_web/erweitertesuche/welcome.xhtml', NULL,
 'robots.txt allows (fetched earlier in this session).',
 'Identity only -- would fall below minimum coverage. Verify national insolvency notices before launch.',
 'Terms not yet read.'),

('FR', 'France', 'Whole country.', 'wave_2', 'developer', 0.60,
 'Nexity group (SIREN 444346795)', 'https://annuaire-entreprises.data.gouv.fr/entreprise/nexity-444346795', '2026-09-23',
 'Official register shows the group split into many companies coded 41.10A (residential development). Live fetch failed on a redirect loop.',
 'Retest live; verify the official company-search API.',
 'Terms not yet read.'),

('NZ', 'New Zealand', 'Whole country.', 'wave_2', 'developer', 0.60,
 'LBP register', 'https://kete-lbp.mbie.govt.nz/advanced-building-practitioner-search/', NULL,
 'robots.txt allows (fetched earlier in this session).',
 'Building Act 2004 s.307 limits permitted use of LBP data. Companies Office untested.',
 'Statutory use restriction needs a real legal reading.'),

-- ---------------------------------------------------------------- EXCLUDED
('CA', 'Canada', 'Province-level only.', 'excluded', NULL, NULL,
 'Ontario Builder Directory', 'https://obd.hcraontario.ca/', '2026-09-23',
 'Richest developer source found: licensing, homes built, charges, convictions, warranty claims paid. robots.txt allows.',
 'Covers Ontario only -- fails the whole-country rule. Revisit if province-level markets are ever allowed.',
 NULL),

('US', 'United States', 'State-level only.', 'excluded', NULL, NULL, NULL, NULL, NULL, NULL,
 'No national company or developer register; 51 separate state systems.', NULL),

('MY', 'Malaysia', 'Unverified.', 'excluded', NULL, NULL, NULL, NULL, NULL, NULL,
 'Never verified in this session.', NULL)
ON CONFLICT (code) DO NOTHING;
