-- ============================================================
-- SHELTERKART — SECOND WAVE OF REVIEWS (migration 013)
--
-- Three more sources reviewed the same way Companies House was:
-- fetched from the source's own page, not inferred from a
-- description of it.
-- ============================================================

UPDATE sources SET
  access_mode = 'permitted_fetch', tos_reviewed_at = CURRENT_DATE,
  tos_reviewed_by = 'Preeyancc',
  tos_review_note = 'Read at github.com/annuaire-entreprises-data-gouv-fr and the Sirene ' ||
    'licence page: Etalab Licence Ouverte 2.0, built for the widest possible reuse. ' ||
    'Caveat: officer/director names carry separate French data-protection ' ||
    'obligations (Loi 78-17) -- company-level fields are unrestricted.'
WHERE authority = 'INSEE SIRENE (France)';

UPDATE sources SET
  access_mode = 'permitted_fetch', tos_reviewed_at = CURRENT_DATE,
  tos_reviewed_by = 'Preeyancc',
  tos_review_note = 'Read at data.gov.sg/privacy-and-terms: "You can use, access, call, ' ||
    'command, query or request the API, whether commercially or non-commercially." ' ||
    'Same government-wide terms govern URA.'
WHERE authority IN ('ACRA — Accounting and Corporate Regulatory Authority', 'URA — Urban Redevelopment Authority');

-- Norway has no row yet -- Brønnøysundregistrene was never added to
-- the registry in any earlier round. Adding it here rather than
-- reusing an unrelated placeholder row, which is what the first
-- draft of this migration nearly did.
INSERT INTO sources (authority, jurisdiction, source_type, authority_tier, access_mode, base_url,
                     default_ttl_hours, status, tos_reviewed_at, tos_reviewed_by, tos_review_note)
VALUES (
  'Brønnøysundregistrene — Enhetsregisteret', 'NO', 'company_registry', 1, 'permitted_fetch',
  'https://data.brreg.no/', 720, 'unavailable', CURRENT_DATE, 'Preeyancc',
  'Read at brreg.no/?p=40815: "Datasetta foelgjer Norsk lisens for opne data (NLOD). ' ||
  'Det er ikkje noedvendig aa registrere seg." NLOD permits commercial reuse, no ' ||
  'registration required for the base enhetsregisteret API.'
)
ON CONFLICT DO NOTHING;
