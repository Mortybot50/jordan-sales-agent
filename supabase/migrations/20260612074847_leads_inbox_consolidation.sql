-- =============================================================================
-- Leads-inbox consolidation — ONE review model on venues.review_status
-- Migration: 20260612074847_leads_inbox_consolidation
-- =============================================================================
-- 1. venues.review_status defaulted every row to 'pending' (261 at migration
--    time) — including Jordan's working venues. Anything with a deal, or
--    manually created, is part of the CRM, not an inbox item: mark approved.
-- 2. The legacy auto_sourced_candidates table (9 pending rows) was a parallel
--    review model surfaced only in the Briefing. Its rows migrate into venues
--    as review_status='pending' (source='google_places', raw payload kept in
--    source_details) and the table is dropped. Backup:
--    ~/workspace/leadflow-audit/auto-sourced-candidates-backup-2026-06-12.sql
-- 3. suppression_list.source gains 'lead_rejected' — Discard in the inbox
--    suppresses every known contact email for the venue under this DISTINCT
--    source so the entries are tellable apart from unsubscribes and
--    reversible if a venue is later un-rejected.
-- =============================================================================

-- 1. Working venues are not inbox items.
update public.venues v
   set review_status = 'approved',
       review_decided_at = now(),
       review_notes = coalesce(review_notes, 'auto-approved 12/06 consolidation: already a working venue (has deals or manual)')
 where v.review_status = 'pending'
   and (v.source = 'manual'
        or exists (select 1 from public.deals d where d.venue_id = v.id));

-- 2. Migrate pending auto-sourced candidates into the venues inbox.
insert into public.venues (org_id, name, address, suburb, venue_type, icp_score, source, source_details, review_status)
select c.org_id,
       c.name,
       c.address,
       c.suburb,
       null,                       -- venue_type_guess is unvalidated; kept in source_details
       c.icp_score_guess,
       'google_places',
       jsonb_build_object(
         'google_place_id', c.google_place_id,
         'venue_type_guess', c.venue_type_guess,
         'migrated_from', 'auto_sourced_candidates',
         'raw_data', c.raw_data
       ),
       'pending'
  from public.auto_sourced_candidates c
 where c.status = 'pending'
   and not exists (
     select 1 from public.venues v
      where v.org_id = c.org_id
        and lower(v.name) = lower(c.name)
        and coalesce(lower(v.suburb), '') = coalesce(lower(c.suburb), '')
   );

drop table public.auto_sourced_candidates;

-- 3. Distinct, reversible suppression source for discarded leads.
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'suppression_list_source_check'
      and conrelid = 'public.suppression_list'::regclass
  ) then
    alter table public.suppression_list drop constraint suppression_list_source_check;
  end if;
end $$;

alter table public.suppression_list
  add constraint suppression_list_source_check
  check (source = any (array[
    'sendgrid_webhook'::text,
    'instantly_webhook'::text,
    'manual'::text,
    'manual_single'::text,
    'manual_bulk'::text,
    'manual_csv'::text,
    'manual_domain'::text,
    'unsubscribe'::text,
    'leadflow_unsubscribe_post'::text,
    'leadflow_bounce_scan'::text,
    'lead_rejected'::text
  ]));
