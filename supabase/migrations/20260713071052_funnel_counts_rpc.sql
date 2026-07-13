-- =============================================================================
-- LeadFlow Sourcing — funnel counts RPC
-- Migration: 20260713071052_funnel_counts_rpc
-- =============================================================================
-- Backs the funnel strip on the Sourcing / Leads UI:
--   total venues → has email → verified → in outreach.
--
-- SECURITY INVOKER so the caller's RLS applies; every count is additionally
-- scoped explicitly to auth_org_id() to make the org boundary obvious and
-- survive any future RLS change. Read-only, no side effects.
--
--   total_venues       — every sourced venue in the org
--   venues_with_email  — venues with ≥1 contact carrying an email
--   venues_verified    — venues with ≥1 contact ZeroBounce-marked 'valid'
--   venues_in_outreach — venues whose deal has a live (active/paused) sequence
--
-- Idempotent: create-or-replace.
-- =============================================================================

create or replace function public.leadflow_funnel_counts()
returns table (
  total_venues       bigint,
  venues_with_email  bigint,
  venues_verified    bigint,
  venues_in_outreach bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    (select count(*)
       from venues v
      where v.org_id = auth_org_id()),
    (select count(distinct c.venue_id)
       from contacts c
      where c.org_id = auth_org_id()
        and c.email is not null),
    (select count(distinct c.venue_id)
       from contacts c
      where c.org_id = auth_org_id()
        and c.verification_status = 'valid'),
    (select count(distinct d.venue_id)
       from deals d
       join sequence_enrollments se on se.deal_id = d.id
      where d.org_id = auth_org_id()
        and se.status in ('active','paused'));
$$;

grant execute on function public.leadflow_funnel_counts() to authenticated;

comment on function public.leadflow_funnel_counts() is
  'Funnel counts for the Sourcing/Leads UI: total venues, venues with an email, '
  'venues with a ZeroBounce-valid contact, and venues in live outreach. '
  'Org-scoped via auth_org_id(); read-only.';
