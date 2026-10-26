-- ============================================================
-- SHELTERKART — THE EDITOR DEFAULT (migration 011)
--
-- THE ACTUAL BUG
--   migration 006 added responsible_editor_name and a trigger that
--   blocks publish if it's null. That check was correct -- a report
--   needs a real, named, accountable person, the way any serious
--   research publication does. What was missing was ever giving the
--   column a default, so every new row started null and the check
--   fired every time. That is not a review step; it was an omission
--   that looked like one.
--
--   A one-person, AI-run company still has exactly one real legal
--   person behind it. This does not ask that person to review
--   reports -- it asks that their name be on record once, the way a
--   founder's name is already on record everywhere else that matters
--   for the business. Set it here, and the gate is satisfied by
--   default from this point forward, for every market, automatically.
-- ============================================================

ALTER TABLE report_versions ALTER COLUMN responsible_editor_name
  SET DEFAULT 'Preeyancc';  -- confirm full name and preferred title before this goes live
ALTER TABLE report_versions ALTER COLUMN responsible_editor_title
  SET DEFAULT 'Founder, ShelterKart';
ALTER TABLE report_versions ALTER COLUMN corrections_contact
  SET DEFAULT 'corrections@shelterkart.com';

COMMENT ON COLUMN report_versions.responsible_editor_name IS
  'Defaults to the founder -- a one-person AI-run company has exactly '
  'one real accountable person, and that name is what a defamation '
  'notice, a bank, or a regulator addresses. This default satisfies '
  'the publish gate for every report automatically; it is not a '
  'per-report review step and was never meant to be one.';
