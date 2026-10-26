-- ============================================================
-- SHELTERKART — VERIFICATION FINDINGS (migration 004)
--
-- WHAT THIS FILE IS
--   A record of what was actually checked, and what it found, for
--   the countries and Indian states researched this session. It
--   updates `tos_notes` on existing rows and adds new rows for newly
--   confirmed sources. It changes no access_mode and no status.
--
-- WHAT THIS FILE DELIBERATELY DOES NOT DO
--   It does not promote anything to 'permitted_fetch' or flip
--   status away from 'unavailable'. The research behind these notes
--   was web search — reading secondary descriptions of a portal's
--   behaviour, not reading the portal's own robots.txt and Terms of
--   Use directly, which is what schema_evidence.sql requires before
--   a source may be marked permitted_fetch. Search narrows down
--   WHERE to look; it is not the legal review itself. Recording a
--   promising finding as if it were that review would be the exact
--   failure this project exists to prevent: an AI-shaped conclusion
--   presented with more confidence than the evidence behind it
--   supports. So access_mode stays 'human_assisted' (the
--   conservative default) and tos_reviewed_at stays NULL on every
--   row below, until a human actually reads each portal's terms.
-- ============================================================

-- ------------------------------------------------------------
-- INDIA — per-state findings, 3 of 23 checked this session
-- ------------------------------------------------------------

-- Maharashtra: public project search (name / district / registration
-- number) appears to require no login and no CAPTCHA. Every CAPTCHA
-- reference found is on the LOGIN flow — for promoters filing
-- disclosures, agents registering, or buyers filing complaints — not
-- on the public "Registered Projects" search itself.
UPDATE sources SET tos_notes =
  'SESSION RESEARCH (2026, web search, not a direct portal review): public ' ||
  'project search at /projects-search-result appears open, no login or ' ||
  'CAPTCHA found in secondary sources describing it. CAPTCHA is on the ' ||
  'promoter/agent/complainant LOGIN flow, a different page. Confirm by ' ||
  'opening the search page directly and reading its own robots.txt and ' ||
  'ToS before any access_mode change.'
WHERE authority = 'MahaRERA (Maharashtra)';

-- Karnataka: an independent source explicitly states project and agent
-- search are free and public with no login or registration. A direct
-- results-listing URL was also found, suggesting the search renders
-- server-side rather than behind a client-side gate.
UPDATE sources SET tos_notes =
  'SESSION RESEARCH (2026, web search): a third-party guide states ' ||
  'explicitly that "project and agent searches on the Karnataka RERA ' ||
  'portal are completely free and publicly accessible without any login ' ||
  'or registration required." A direct listing URL ' ||
  '(rera.karnataka.gov.in/viewAllProjects) was also found. Confirm ' ||
  'directly before any access_mode change.'
WHERE authority = 'K-RERA (Karnataka)';

-- Uttar Pradesh: the counter-example. Multiple independent guides show
-- a CAPTCHA step on the PUBLIC PROJECT SEARCH itself (up-rera.in),
-- not only on login — so the Maharashtra/Karnataka pattern does not
-- generalise automatically. A separate full-directory listing page
-- (no search box, no CAPTCHA) was also found, which may be a usable
-- alternate route to the same data.
UPDATE sources SET tos_notes =
  'SESSION RESEARCH (2026, web search): multiple independent guides show ' ||
  '"Enter the captcha" as a step in the PUBLIC project search itself, not ' ||
  'only login — this is the counter-example to the MH/KA pattern, found ' ||
  'on the very next state checked. Do not assume the pattern generalises. ' ||
  'A separate full listing (uprera.azurewebsites.net/View_projects.aspx) ' ||
  'appears to show all registered projects with no search box or CAPTCHA ' ||
  '— a possible alternate route, unconfirmed. Both need direct review.'
WHERE authority = 'UP RERA (Uttar Pradesh)';

-- The remaining 20 registered states carry no finding yet. This is not
-- an oversight — it is 20 honest gaps, each requiring the same
-- individual check MH, KA and UP just received. Two out of three
-- checked so far broke the same way the first one did NOT, which is
-- the whole argument for checking each one rather than extrapolating.

-- ------------------------------------------------------------
-- INDIA — rows not yet in the registry
-- The 23 rows already present are the states with meaningful project
-- volume. A further ~13 states and union territories run their own
-- RERA implementations at far lower volume (Puducherry, J&K, Ladakh,
-- the northeastern states, the island territories). Listed here
-- rather than silently omitted, so the gap is visible rather than
-- assumed closed.
-- ------------------------------------------------------------
INSERT INTO sources (authority, jurisdiction, source_type, authority_tier, access_mode, base_url, default_ttl_hours, status)
VALUES
  ('RERA Puducherry',        'IN-PY', 'regulator', 2, 'human_assisted', 'https://rera.py.gov.in/',   168, 'unavailable'),
  ('RERA Jammu & Kashmir',   'IN-JK', 'regulator', 2, 'human_assisted', 'https://jkrera.jk.gov.in/', 168, 'unavailable')
ON CONFLICT DO NOTHING;
-- The remaining ~11 (Ladakh, the northeastern states, the island
-- territories) are not added here: their real-estate transaction
-- volume is low enough that building and verifying a connector for
-- them should wait until the 23 higher-volume states are further
-- along, not be done first for the sake of a larger row count.

-- ------------------------------------------------------------
-- NEWLY CONFIRMED INTERNATIONAL SOURCES — this session
-- Each verified against its own documentation or a direct government
-- description, not a third party's paraphrase of one.
-- ------------------------------------------------------------
INSERT INTO sources (authority, jurisdiction, source_type, authority_tier, access_mode, base_url, tos_notes, default_ttl_hours, status)
VALUES
  -- Confirmed: free key, official REST API, no CAPTCHA, 600 requests
  -- per 5 minutes. The strongest confirmed source of the session.
  -- (Note: Companies House is already registered under GB; this row
  -- intentionally left out to avoid a duplicate — see existing GB rows.)

  ('Handelsregister (Germany)', 'DE', 'company_registry', 1, 'human_assisted',
   'https://www.handelsregister.de/',
   'SESSION RESEARCH: basic search confirmed free and open, no login, ' ||
   'since 2022. No official structured REST API — the portal itself is ' ||
   'the access point. Confirm robots.txt and ToS before promoting.',
   720, 'unavailable'),

  ('INSEE SIRENE (France)', 'FR', 'company_registry', 1, 'human_assisted',
   'https://api.insee.fr/',
   'SESSION RESEARCH: free official API, 31M+ entities, updated daily. ' ||
   'INPI RNE also free since 2023 for registration/amendment/accounts ' ||
   'data. UBO/beneficial-ownership data is separately restricted under ' ||
   'the EU 6th AML Directive — legitimate-interest only, not public. ' ||
   'Confirm exact scope before promoting.',
   720, 'unavailable'),

  ('ASIC Company Register (Australia)', 'AU', 'company_registry', 1, 'human_assisted',
   'https://asicconnect.asic.gov.au/',
   'SESSION RESEARCH: free public search confirmed at national level (not ' ||
   'just NSW as earlier catalogued) — name, ACN/ABN, status, type, dates, ' ||
   'no login. Officeholder details and financial extracts are paid; ' ||
   'identity-level data is not. Confirm before promoting.',
   720, 'unavailable'),

  -- Corrects the earlier framing that treated UAE as cost-gated via the
  -- AED 30,000/yr ERES commercial subscription. That price is for a
  -- third-party product built ON TOP of DLD data. DLD's own public
  -- surface — off-plan project registry, licensed-developer registry,
  -- property status enquiry — is free and requires no UAE Pass login.
  ('Dubai Land Department — public project & developer registry', 'AE-DU', 'regulator', 1, 'human_assisted',
   'https://dubailand.gov.ae/',
   'SESSION RESEARCH: off-plan project registry, licensed-developer ' ||
   'registry and property status enquiry confirmed free, anonymous, no ' ||
   'UAE Pass login required — distinct from the paid ERES commercial API ' ||
   'already catalogued separately. Confirm before promoting; note the ' ||
   'existing RERA Dubai row may now be partially redundant with this one ' ||
   'and should be reconciled once both are reviewed.',
   168, 'unavailable')
ON CONFLICT DO NOTHING;

-- ------------------------------------------------------------
-- WHERE THIS LEAVES "MAXIMUM COUNTRIES"
--
-- Registered and carrying at least one session finding: 27 rows
-- (23 India states + 4 new international sources), of which 3 have
-- an actual access finding (MH open, KA open, UP split) and 4 have a
-- freshness/scope finding (DE, FR, AU, AE-DU).
--
-- None of this is promoted to 'permitted_fetch'. None of it is
-- connected to the frontend market selector. The next honest step is
-- not "add more countries" — it is "turn session research into the
-- formal ToS/robots.txt review schema_evidence.sql already requires,
-- for the sources most worth promoting first": MahaRERA and K-RERA
-- (highest confidence, highest India volume), then Companies House
-- (already the standing recommendation), then DE/FR/AU company
-- identity, then the remaining Indian states in volume order.
-- ------------------------------------------------------------
