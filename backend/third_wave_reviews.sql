-- ============================================================
-- SHELTERKART — THIRD WAVE OF REVIEWS (migration 014)
--
-- Three read the same way as Companies House, France, Norway and
-- Singapore: fetched from the source's own page. One -- Finland --
-- is recorded as provisional, because the CC BY 4.0 citation came
-- from a third party's integration notes, not from PRH's own licence
-- page directly. That distinction is written into the review note
-- itself rather than smoothed over.
-- ============================================================

INSERT INTO sources (authority, jurisdiction, source_type, authority_tier, access_mode, base_url,
                     default_ttl_hours, status, tos_reviewed_at, tos_reviewed_by, tos_review_note)
VALUES
  ('CRO — Companies Registration Office (open data)', 'IE', 'company_registry', 1, 'permitted_fetch',
   'https://opendata.cro.ie/', 720, 'unavailable', CURRENT_DATE, 'Preeyancc',
   'Read at opendata.cro.ie/about: "Under the CC-BY Licence, users must acknowledge ' ||
   'the source." CC BY 4.0, daily updates, unrestricted reuse with attribution.'),

  ('Property Price Register (Ireland)', 'IE', 'land_registry', 1, 'permitted_fetch',
   'https://www.propertypriceregister.ie/', 720, 'unavailable', NULL, NULL,
   'Statutory register confirmed to exist and publish monthly; the reuse licence '
   'itself was not read directly this round -- treat as unreviewed until it is.'),

  ('data.gov.tw — Real Estate Transaction Open Data', 'TW', 'land_registry', 1, 'permitted_fetch',
   'https://plvr.land.moi.gov.tw/', 720, 'unavailable', CURRENT_DATE, 'Preeyancc',
   'Confirmed directly on data.gov.tw across many real dataset entries: ' ||
   '"Government Open Data License, Version 1" and "Free" (免費), including pre-sale ' ||
   'and completed-sale transaction data.'),

  ('ABN Bulk Extract / ASIC Companies Register (Australia)', 'AU', 'company_registry', 1, 'permitted_fetch',
   'https://data.gov.au/', 720, 'unavailable', CURRENT_DATE, 'Preeyancc',
   'Confirmed directly on data.gov.au: "License: Creative Commons Attribution 3.0 ' ||
   'Australia [Open Data]" on the ABN Bulk Extract dataset specifically.'),

  ('PRH — Finnish Business Information System (open data)', 'FI', 'company_registry', 1, 'human_assisted',
   'https://avoindata.prh.fi/', 720, 'unavailable', NULL, NULL,
   'PRH''s own page (prh.fi) confirms "The PRH''s open data are available free of ' ||
   'charge." The CC BY 4.0 licence text was found via a third-party integration''s ' ||
   'citation, not read directly from a PRH licence page -- provisional, not yet a ' ||
   'completed review. access_mode deliberately left at human_assisted until closed.')
ON CONFLICT DO NOTHING;
