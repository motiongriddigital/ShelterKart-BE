-- ============================================================
-- SHELTERKART — SOURCE REGISTRY SEED (migration 003)
--
-- Populates `sources` (see schema_evidence.sql) with the authorities
-- ShelterKart draws evidence from.
--
-- WHAT THIS FILE IS
--   A verified catalogue of WHICH authority governs WHAT, in WHICH
--   jurisdiction, and at WHICH published portal.
--
-- WHAT THIS FILE IS NOT
--   It contains no endpoints, no selectors, no parsing rules. Those
--   cannot be written without opening each portal and reading its
--   actual markup and response shapes. Guessing them produces code
--   that looks correct, passes review, and fails silently in
--   production against the one thing this company sells: accuracy.
--   Every row therefore starts life as 'unavailable' and is only
--   promoted once a connector has been built and tested against the
--   live source.
--
-- ACCESS MODE IS A LEGAL CLASSIFICATION, NOT A TECHNICAL ONE.
--   'permitted_fetch' must not be set until robots.txt and terms of
--   use have actually been read for that specific portal. Until then
--   a row stays 'human_assisted', which is the conservative default:
--   an operator retrieves the record in a supervised session. This is
--   why tos_reviewed_at is NULL on every row below — no legal review
--   has happened yet, and pretending otherwise in a seed file would
--   be the same class of error as inventing a selector.
-- ============================================================

-- ------------------------------------------------------------
-- INDIA — STATE REAL ESTATE REGULATORY AUTHORITIES
--
-- RERA is constituted state-by-state under the Real Estate
-- (Regulation and Development) Act, 2016. There is no national
-- project register: each state runs its own portal, its own schema,
-- and its own registration-number format. A connector is therefore
-- per-state, not per-country — this is the single most important
-- architectural fact about operating in India, and the reason
-- "launch India" is ~30 integrations rather than one.
-- ------------------------------------------------------------
INSERT INTO sources (authority, jurisdiction, source_type, authority_tier, access_mode, base_url, default_ttl_hours, status)
VALUES
  -- Maharashtra. Highest project volume in the country and the
  -- intended first connector. Note: MahaRERA has published under two
  -- hostnames (maharera.maharashtra.gov.in and the older
  -- maharera.mahaonline.gov.in). The connector must confirm which is
  -- canonical at build time rather than assuming.
  ('MahaRERA (Maharashtra)',        'IN-MH', 'regulator', 1, 'human_assisted', 'https://maharera.maharashtra.gov.in/', 168, 'unavailable'),
  ('K-RERA (Karnataka)',            'IN-KA', 'regulator', 1, 'human_assisted', 'https://rera.karnataka.gov.in/',      168, 'unavailable'),
  ('UP RERA (Uttar Pradesh)',       'IN-UP', 'regulator', 1, 'human_assisted', 'https://up-rera.in/',                 168, 'unavailable'),
  ('TG RERA (Telangana)',           'IN-TG', 'regulator', 1, 'human_assisted', 'https://rera.telangana.gov.in/',      168, 'unavailable'),
  ('TN RERA (Tamil Nadu)',          'IN-TN', 'regulator', 1, 'human_assisted', 'https://rera.tn.gov.in/',             168, 'unavailable'),
  ('AP RERA (Andhra Pradesh)',      'IN-AP', 'regulator', 1, 'human_assisted', 'https://rera.ap.gov.in/',             168, 'unavailable'),
  ('Gujarat RERA (GujRERA)',        'IN-GJ', 'regulator', 1, 'human_assisted', 'https://gujrera.gujarat.gov.in/',     168, 'unavailable'),
  ('HARERA (Haryana — Gurugram)',   'IN-HR', 'regulator', 1, 'human_assisted', 'https://haryanarera.gov.in/',         168, 'unavailable'),
  ('RERA Delhi',                    'IN-DL', 'regulator', 1, 'human_assisted', 'https://rera.delhi.gov.in/',          168, 'unavailable'),
  ('RERA West Bengal (WBRERA)',     'IN-WB', 'regulator', 1, 'human_assisted', 'https://rera.wb.gov.in/',             168, 'unavailable'),
  ('RERA Rajasthan',                'IN-RJ', 'regulator', 1, 'human_assisted', 'https://rera.rajasthan.gov.in/',      168, 'unavailable'),
  ('MP RERA (Madhya Pradesh)',      'IN-MP', 'regulator', 1, 'human_assisted', 'https://rera.mp.gov.in/',             168, 'unavailable'),
  ('K-RERA Kerala',                 'IN-KL', 'regulator', 1, 'human_assisted', 'https://rera.kerala.gov.in/',         168, 'unavailable'),
  ('RERA Punjab (PSRERA)',          'IN-PB', 'regulator', 1, 'human_assisted', 'https://rera.punjab.gov.in/',         168, 'unavailable'),
  ('RERA Bihar',                    'IN-BR', 'regulator', 1, 'human_assisted', 'https://rera.bihar.gov.in/',          168, 'unavailable'),
  ('RERA Odisha (ORERA)',           'IN-OR', 'regulator', 1, 'human_assisted', 'https://rera.odisha.gov.in/',         168, 'unavailable'),
  ('RERA Chhattisgarh',             'IN-CT', 'regulator', 1, 'human_assisted', 'https://rera.cgstate.gov.in/',        168, 'unavailable'),
  ('RERA Assam',                    'IN-AS', 'regulator', 1, 'human_assisted', 'https://rera.assam.gov.in/',          168, 'unavailable'),
  ('RERA Uttarakhand (UKRERA)',     'IN-UK', 'regulator', 1, 'human_assisted', 'https://ukrera.uk.gov.in/',           168, 'unavailable'),
  ('RERA Himachal Pradesh',         'IN-HP', 'regulator', 1, 'human_assisted', 'https://hprera.nic.in/',              168, 'unavailable'),
  ('RERA Jharkhand (JharRERA)',     'IN-JH', 'regulator', 1, 'human_assisted', 'https://rera.jharkhand.gov.in/',      168, 'unavailable'),
  ('RERA Goa',                      'IN-GA', 'regulator', 1, 'human_assisted', 'https://rera.goa.gov.in/',            168, 'unavailable'),
  ('RERA Chandigarh',               'IN-CH', 'regulator', 1, 'human_assisted', 'https://rera.chandigarh.gov.in/',     168, 'unavailable')
ON CONFLICT DO NOTHING;

-- ------------------------------------------------------------
-- INDIA — NATIONAL SOURCES
-- These are country-wide and therefore single connectors, unlike
-- RERA. Corporate identity resolves here, not at state level.
-- ------------------------------------------------------------
INSERT INTO sources (authority, jurisdiction, source_type, authority_tier, access_mode, base_url, default_ttl_hours, status)
VALUES
  -- Company identity, directors, charges. This is what resolves a
  -- marketing name ("Lodha") to a legal entity ("Macrotech
  -- Developers Ltd") and is the backbone of entity resolution.
  ('Ministry of Corporate Affairs (MCA)', 'IN', 'company_registry', 1, 'human_assisted', 'https://www.mca.gov.in/',   720, 'unavailable'),
  -- Insolvency. A promoter under IBC proceedings is the single most
  -- material fact a buyer can learn; TTL is short for that reason.
  ('IBBI — Insolvency and Bankruptcy Board of India', 'IN', 'insolvency', 1, 'human_assisted', 'https://ibbi.gov.in/', 24, 'unavailable'),
  ('NCLT — National Company Law Tribunal', 'IN', 'court', 1, 'human_assisted', 'https://nclt.gov.in/',                  24, 'unavailable'),
  ('eCourts Services (District & High Courts)', 'IN', 'court', 1, 'human_assisted', 'https://services.ecourts.gov.in/', 24, 'unavailable'),
  ('NCDRC — National Consumer Disputes Redressal Commission', 'IN', 'court', 1, 'human_assisted', 'https://ncdrc.nic.in/', 24, 'unavailable'),
  -- Listed promoters disclose materially more, and earlier.
  ('SEBI / Stock Exchange Filings',   'IN', 'company_registry', 2, 'human_assisted', 'https://www.sebi.gov.in/',       168, 'unavailable')
ON CONFLICT DO NOTHING;

-- ------------------------------------------------------------
-- UNITED ARAB EMIRATES
-- Emirate-level, not federal. Dubai and Abu Dhabi maintain separate
-- registries with different rules — the same per-state pattern as
-- India, at smaller scale.
-- ------------------------------------------------------------
INSERT INTO sources (authority, jurisdiction, source_type, authority_tier, access_mode, base_url, default_ttl_hours, status)
VALUES
  ('Dubai Land Department (DLD)',            'AE-DU', 'land_registry',    1, 'human_assisted', 'https://dubailand.gov.ae/',        168, 'unavailable'),
  ('RERA Dubai (within DLD)',                'AE-DU', 'regulator',        1, 'human_assisted', 'https://dubailand.gov.ae/',        168, 'unavailable'),
  ('Dubai Courts',                           'AE-DU', 'court',            1, 'human_assisted', 'https://www.dc.gov.ae/',            24, 'unavailable'),
  ('Abu Dhabi Real Estate Centre (ADREC)',   'AE-AZ', 'regulator',        1, 'human_assisted', 'https://www.adrec.gov.ae/',        168, 'unavailable'),
  ('UAE Ministry of Economy — Companies',    'AE',    'company_registry', 1, 'human_assisted', 'https://www.moec.gov.ae/',         720, 'unavailable')
ON CONFLICT DO NOTHING;

-- ------------------------------------------------------------
-- UNITED KINGDOM
-- The strongest open-data position of the six markets: Companies
-- House publishes a documented, free REST API. This is the one
-- jurisdiction where 'official_api' is likely to be reachable, and
-- therefore the best candidate for proving the pipeline end-to-end.
-- ------------------------------------------------------------
INSERT INTO sources (authority, jurisdiction, source_type, authority_tier, access_mode, base_url, default_ttl_hours, status)
VALUES
  ('Companies House',                  'GB', 'company_registry', 1, 'human_assisted', 'https://find-and-update.company-information.service.gov.uk/', 720, 'unavailable'),
  ('HM Land Registry',                 'GB-EW', 'land_registry',  1, 'human_assisted', 'https://www.gov.uk/government/organisations/land-registry',   720, 'unavailable'),
  ('Registers of Scotland',            'GB-SCT', 'land_registry', 1, 'human_assisted', 'https://www.ros.gov.uk/',                                     720, 'unavailable'),
  ('The Insolvency Service',           'GB', 'insolvency',       1, 'human_assisted', 'https://www.gov.uk/government/organisations/insolvency-service', 24, 'unavailable'),
  ('NHBC (warranty provider)',         'GB', 'regulator',        3, 'human_assisted', 'https://www.nhbc.co.uk/',                                     720, 'unavailable')
ON CONFLICT DO NOTHING;

-- ------------------------------------------------------------
-- SINGAPORE
-- ------------------------------------------------------------
INSERT INTO sources (authority, jurisdiction, source_type, authority_tier, access_mode, base_url, default_ttl_hours, status)
VALUES
  ('ACRA — Accounting and Corporate Regulatory Authority', 'SG', 'company_registry', 1, 'human_assisted', 'https://www.acra.gov.sg/',   720, 'unavailable'),
  ('URA — Urban Redevelopment Authority',                  'SG', 'planning',         1, 'human_assisted', 'https://www.ura.gov.sg/',    168, 'unavailable'),
  ('BCA — Building and Construction Authority',            'SG', 'regulator',        1, 'human_assisted', 'https://www1.bca.gov.sg/',   168, 'unavailable'),
  ('SLA — Singapore Land Authority',                       'SG', 'land_registry',    1, 'human_assisted', 'https://www.sla.gov.sg/',    720, 'unavailable'),
  ('CEA — Council for Estate Agencies',                    'SG', 'regulator',        1, 'human_assisted', 'https://www.cea.gov.sg/',    720, 'unavailable')
ON CONFLICT DO NOTHING;

-- ------------------------------------------------------------
-- CANADA
-- Federal corporate registry, provincial land and warranty regimes.
-- Ontario is the practical starting point by volume.
-- ------------------------------------------------------------
INSERT INTO sources (authority, jurisdiction, source_type, authority_tier, access_mode, base_url, default_ttl_hours, status)
VALUES
  ('Corporations Canada',                        'CA',    'company_registry', 1, 'human_assisted', 'https://ised-isde.canada.ca/cc/lgcy/fdrlCrpSrch.html', 720, 'unavailable'),
  ('HCRA — Home Construction Regulatory Authority', 'CA-ON', 'regulator',     1, 'human_assisted', 'https://www.hcraontario.ca/',                          168, 'unavailable'),
  ('Tarion (warranty)',                          'CA-ON', 'regulator',        2, 'human_assisted', 'https://www.tarion.com/',                              168, 'unavailable'),
  ('ONLAND — Ontario Land Registry',             'CA-ON', 'land_registry',    1, 'human_assisted', 'https://www.onland.ca/',                               720, 'unavailable')
ON CONFLICT DO NOTHING;

-- ------------------------------------------------------------
-- MALAYSIA
-- ------------------------------------------------------------
INSERT INTO sources (authority, jurisdiction, source_type, authority_tier, access_mode, base_url, default_ttl_hours, status)
VALUES
  ('SSM — Companies Commission of Malaysia',        'MY', 'company_registry', 1, 'human_assisted', 'https://www.ssm.com.my/',    720, 'unavailable'),
  ('KPKT — Ministry of Housing and Local Government','MY', 'regulator',       1, 'human_assisted', 'https://www.kpkt.gov.my/',   168, 'unavailable'),
  ('JPN / e-Tanah land administration',             'MY', 'land_registry',    1, 'human_assisted', 'https://www.jkptg.gov.my/',  720, 'unavailable')
ON CONFLICT DO NOTHING;

-- ------------------------------------------------------------
-- OPERATING NOTES
--
-- 1. Every row is 'unavailable'. Coverage must be earned per source
--    by building and testing a connector, not asserted by inserting
--    a row. The coverage badge in the UI reads from this table, so
--    an unbuilt connector correctly degrades the report rather than
--    silently reporting full coverage.
--
-- 2. tos_reviewed_at is NULL everywhere. No source may move to
--    'permitted_fetch' until a human has read that portal's terms
--    and robots.txt and recorded the date here.
--
-- 3. India is ~29 connectors, not one. Any roadmap that treats
--    "India" as a single integration is wrong by roughly an order of
--    magnitude, and that misestimate compounds into every timeline
--    built on top of it.
--
-- 4. Suggested build order, by evidence value per unit of work:
--      1. Companies House (GB) — documented free API, so the whole
--         pipeline can be proven end-to-end against a real source
--         before fighting a portal that resists automation.
--      2. MCA (IN) — entity resolution for the primary market.
--      3. MahaRERA (IN-MH) — highest project volume in India.
--      4. IBBI (IN) — highest-severity single signal.
--    Everything else follows demand.
-- ------------------------------------------------------------
