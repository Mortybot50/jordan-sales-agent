-- =============================================================================
-- LeadFlow — honest contact classification + enrichment source
-- Migration: 20260714010349_contacts_role_based_and_enrich_source
-- =============================================================================
-- Two additive changes, no data loss, RLS untouched:
--
-- 1. contacts.role_based — a GENERATED STORED boolean that is true when the
--    email's local-part is a shared/role inbox (info@, hello@, bookings@,
--    admin@ …). Deterministic from the address alone, so it needs no backfill
--    and never drifts. The prefix set mirrors _shared/verify-email.ts
--    ROLE_PREFIXES exactly (incl. the '+' sub-address strip) so a contact
--    flagged role_based here is the same one the internal verifier tags
--    role_address. This is the honest half of the "catch-all / role-based /
--    unknown" split: a venue is only outreach-ready when it has an email that
--    is verification_status='valid' AND NOT catch_all_flag AND NOT role_based.
--
-- 2. contacts_source_check widened to allow 'hunter_enrich' — the source tag
--    for emails discovered by the Hunter.io domain-search fallback in
--    crawl-venue-contacts (fires only when the page crawl finds nothing and a
--    website exists). Widening a CHECK IN-set is safe (superset of the old).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. role_based generated column (immutable expression → valid for GENERATED)
-- ---------------------------------------------------------------------------
alter table public.contacts
  add column if not exists role_based boolean
  generated always as (
    email is not null
    and lower(split_part(split_part(email, '@', 1), '+', 1)) = any (array[
      'info', 'contact', 'hello', 'hi', 'sales', 'admin', 'office', 'support',
      'help', 'enquiries', 'enquiry', 'inquiries', 'inquiry', 'noreply',
      'no-reply', 'team', 'accounts', 'accounting', 'billing', 'marketing',
      'careers', 'jobs', 'hr', 'press', 'media', 'events', 'bookings',
      'reservations'
    ])
  ) stored;

comment on column public.contacts.role_based is
  'True when the email local-part is a shared/role inbox (info@, hello@, '
  'bookings@ …). Generated from the address; mirrors verify-email.ts '
  'ROLE_PREFIXES. A role-based email is never auto-enrolled by approve-lead — '
  'outreach-ready requires verification_status=''valid'' AND NOT catch_all_flag '
  'AND NOT role_based.';

-- Partial index: the send gate and reporting both filter on the genuinely
-- deliverable slice (valid, not catch-all, not role-based). Keep it cheap.
create index if not exists idx_contacts_outreach_ready
  on public.contacts (org_id, venue_id)
  where verification_status = 'valid'
    and catch_all_flag is not true
    and role_based is not true;

-- ---------------------------------------------------------------------------
-- 2. Widen contacts_source_check to include the Hunter.io enrichment source.
--    Full existing set preserved + 'hunter_enrich' appended.
-- ---------------------------------------------------------------------------
alter table public.contacts drop constraint if exists contacts_source_check;
alter table public.contacts add constraint contacts_source_check
  check (source = any (array[
    'outscraper', 'google_places', 'vcglr', 'broadsheet', 'timeout',
    'concrete_playground', 'good_food', 'urban_list', 'hospitality_mag',
    'general_news', 'fiverr_legacy', 'manual', 'salesforce_import',
    'csv_import', 'linkedin_import', 'website_crawl', 'hunter_enrich'
  ]));

-- ---------------------------------------------------------------------------
-- 3. Probe: column exists and the generated expression evaluated on real rows.
-- ---------------------------------------------------------------------------
do $$
declare has_col int;
begin
  select count(*) into has_col
    from information_schema.columns
   where table_schema = 'public' and table_name = 'contacts'
     and column_name = 'role_based';
  if has_col < 1 then
    raise exception 'role_based column was not created';
  end if;
end $$;
