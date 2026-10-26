-- ============================================================
-- SHELTERKART — THE FIRST REAL REVIEW (migration 012)
--
-- The gate stays. This is what satisfying it actually looks like:
-- not a rule removed, a review finished and written down.
--
-- Companies House's own "Acceptable use of Companies House
-- Searchable Databases" was fetched and read directly earlier this
-- session: automation is explicitly permitted, "whether generated
-- manually or in an automated fashion" -- the condition is request
-- volume, not method. That is a real, complete review. It just never
-- got written back to the row that needed it.
-- ============================================================

UPDATE sources SET
  access_mode = 'permitted_fetch',
  tos_reviewed_at = CURRENT_DATE,
  tos_reviewed_by = 'Preeyancc',  -- confirm full name before this goes live
  tos_review_note = 'Read directly at resources.companieshouse.gov.uk/serviceInformation.shtml. ' ||
    'Automated access explicitly permitted; the only condition is request volume, not method.'
WHERE authority = 'Companies House';

-- Everything else on the "live today" list was found to be free and
-- open by search, or its access was tested directly -- neither is
-- the same completed review Companies House got. Finishing them the
-- same way is the actual fast path, not a redesign:
--
--   France       -- company API returned live data; the licence
--                   itself was never read
--   Norway       -- official docs explicitly describe machine use;
--                   close to done, needs the same direct read
--   Singapore, Ireland, Taiwan, Australia, Finland, Estonia,
--   Czech Republic, Latvia, Poland, Spain, Lithuania
--                -- open-licence language was found via search,
--                   not read from the source's own page directly
--
-- Eleven reviews, each the same shape as this one. Most are a single
-- page each. That is the actual remaining work -- not the gate.
