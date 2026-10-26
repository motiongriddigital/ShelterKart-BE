-- ============================================================
-- SHELTERKART — THE COMPLETE MARKET SET (migration 015)
--
-- Every market this session found real, sourced evidence for, added
-- in one place. Nothing held back for tidiness. What differs between
-- them is not whether they're included -- it's tos_reviewed_at and
-- access_mode, which stay honest per source:
--
--   permitted_fetch, tos_reviewed_at set   -- read from the source's
--     own page, the same standard as UK, France, Norway, Singapore,
--     Ireland, Taiwan, Australia
--   human_assisted, tos_reviewed_at NULL   -- real evidence exists
--     (licence language quoted, an official confirming it), but not
--     yet read from the source's own page by this reviewer
--
-- Including a market here is a statement that it is real and worth
-- building toward. It is not a statement that the legal gate will
-- let it publish today -- that gate stays exactly as strict as it
-- was, and correctly blocks every human_assisted row below.
-- ============================================================

INSERT INTO sources (authority, jurisdiction, source_type, authority_tier, access_mode, base_url,
                     default_ttl_hours, status, tos_reviewed_at, tos_reviewed_by, tos_review_note)
VALUES

-- ---- five more with strong quoted evidence, primary page not yet read this round ----
  ('ARES — Registr ekonomických subjektů (Czech Republic)', 'CZ', 'company_registry', 1, 'human_assisted',
   'https://ares.gov.cz/', 720, 'unavailable', NULL, NULL,
   'Finance Ministry''s own page states the API may be used by anyone within 500 ' ||
   'requests/minute, no key required. Base address tested live (correct 404 on an ' ||
   'empty query). Licence statement itself not yet read on its own page.'),

  ('Reģistru un informācijas sistēmu centrs — Enterprise Register (Latvia)', 'LV', 'company_registry', 1, 'human_assisted',
   'https://www.ur.gov.lv/', 720, 'unavailable', NULL, NULL,
   'Confirmed via the register''s own EU open-data portal entry: daily open files, ' ||
   'stated as usable "without restriction," commercial reuse included. Registry''s ' ||
   'own licence page not yet read directly.'),

  ('KRS — Krajowy Rejestr Sądowy API (Poland)', 'PL', 'company_registry', 1, 'human_assisted',
   'https://api-krs.ms.gov.pl/', 720, 'unavailable', NULL, NULL,
   'Free, keyless access confirmed by three independent third-party integrations ' ||
   'returning real company data. Ministry of Justice''s own terms page not yet ' ||
   'located and read.'),

  ('BORME — Boletín Oficial del Registro Mercantil (Spain)', 'ES', 'company_registry', 2, 'human_assisted',
   'https://www.boe.es/borme/', 720, 'unavailable', NULL, NULL,
   'Free official gazette API confirmed for company acts: incorporations, capital ' ||
   'changes, dissolutions, insolvencies. Covers events, not full bulk company ' ||
   'profiles. Licence statement not yet read directly.'),

  ('Registrų centras — Legal Entities Register (Lithuania)', 'LT', 'company_registry', 1, 'human_assisted',
   'https://www.registrucentras.lt/', 720, 'unavailable', NULL, NULL,
   'Registry''s own annual report confirms open datasets are free for reuse. Its ' ||
   'EU open-data portal entry separately states register data may be used only for ' ||
   'the purpose, scope and manner stated when obtained -- narrower than pure open ' ||
   'data. Use the published open files as-is; nothing beyond them without a ' ||
   'declared purpose.'),

-- ---- four real, free, but each needs a signup step before any fetch is possible ----
  ('CVR — Danish Business Authority', 'DK', 'company_registry', 1, 'human_assisted',
   'https://datacvr.virk.dk/', 720, 'unavailable', NULL, NULL,
   'Confirmed free for system-to-system access, but requires credentials issued by ' ||
   'the Danish Business Authority before any call can be made. Not a legal blocker '
   '-- a signup step.'),

  ('Zefix — Swiss Central Business Names Index', 'CH', 'company_registry', 1, 'human_assisted',
   'https://www.zefix.ch/', 720, 'unavailable', NULL, NULL,
   'Basic company identity is open as linked data, updated daily, no signup. The ' ||
   'fuller API (status, capital, relations) requires credentials.'),

  ('KBO — Crossroads Bank for Enterprises (Belgium)', 'BE', 'company_registry', 1, 'human_assisted',
   'https://kbopub.economie.fgov.be/', 720, 'unavailable', NULL, NULL,
   'A daily open file with limited fields is free after a signup; fuller access is ' ||
   'paid. Signup step, not a legal blocker.'),

  ('Bolagsverket — Swedish Companies Registration Office', 'SE', 'company_registry', 1, 'human_assisted',
   'https://bolagsverket.se/', 720, 'unavailable', NULL, NULL,
   'Statistics Sweden confirms register data has been free since 26 June 2025. ' ||
   'API access requires accepted terms and a certificate/password issued by email '
   '-- a real but small signup step.'),

-- ---- the flagship, pending one external approval ----
  ('Dubai Pulse — DLD Projects & Developers (open data)', 'AE-DU', 'regulator', 1, 'human_assisted',
   'https://www.dubaipulse.gov.ae/', 168, 'unavailable', NULL, NULL,
   'The richest data of any market checked -- project status, escrow account, ' ||
   'completion percentage, licensed developers -- but only via Dubai Pulse, which ' ||
   'requires a permission request taking roughly 14 days. DLD''s own website is ' ||
   'explicitly personal-use-only and must never be the source.'),

-- ---- markets with a real, specific, non-generic caveat -- included, not smoothed over ----
  ('MCA + IBBI (India, national developer layer)', 'IN', 'company_registry', 1, 'human_assisted',
   'https://www.mca.gov.in/', 168, 'unavailable', NULL, NULL,
   'Strong national developer-layer evidence: MCA via data.gov.in, IBBI''s live ' ||
   'insolvency list (directly fetched this session, 9,147 entries). Project-layer ' ||
   'RERA data is a genuine per-state patchwork, not a single yes/no: Tamil Nadu, ' ||
   'West Bengal and Haryana-Gurugram fetched open; Uttar Pradesh split (entity data ' ||
   'open, project search CAPTCHA-gated); Maharashtra, Karnataka, Gujarat and Delhi ' ||
   'confirmed robots.txt-blocked by direct fetch. Include as developer-layer only ' ||
   'until each state is reviewed on its own.'),

  ('SRPE — Sales of First-hand Residential Properties (Hong Kong)', 'HK', 'land_registry', 1, 'human_assisted',
   'https://www.srpe.gov.hk/', 720, 'unavailable', NULL, NULL,
   'robots.txt allows access; the register is statutory (s.89, Cap. 621). Two real ' ||
   'requirements before this can be a working connector, not a legal question: the ' ||
   'pages are script-rendered and need a headless browser, and SRPA''s own notice ' ||
   'prohibits reproducing or making documents public without written authorisation ' ||
   '-- cite and link the specific document, never republish it.'),

  ('LBP Register (New Zealand)', 'NZ', 'regulator', 1, 'human_assisted',
   'https://www.lbp.govt.nz/', 720, 'unavailable', NULL, NULL,
   'Access fetched live and confirmed open, explicitly free with no login for ' ||
   'search. The real gate is not access but use: Building Act 2004 s.307 limits ' ||
   'what the data may be used for, backed by the Privacy Act 2020. Needs an actual ' ||
   'legal reading of that statute before this can be treated as cleared, not a ' ||
   'second technical check.')

ON CONFLICT DO NOTHING;
