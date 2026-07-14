-- =============================================================================
-- LeadFlow — atomic claim for name→website resolve venues
-- Migration: 20260714034835_claim_resolve_venues
-- =============================================================================
-- Additive + one new function. No data loss, RLS untouched, no permission
-- changes beyond granting EXECUTE on the new function to service_role only.
--
-- Mirror of leadflow_claim_guess_venues (20260714033812): the RESOLVE batch
-- must reserve name-only venues before spending a paid Google Places call on
-- them, so two overlapping enrich-venue-contacts resolve runs never
-- double-bill Places on the same venue. The prior `enrich_source IS NULL`
-- filter alone did NOT give billing idempotency — both runs could select the
-- same rows while enrich_source was still NULL and each pay for a Places call
-- before either wrote its marker.
--
--   venues.resolve_claimed_at — soft lease (NOT a state). A claim older than
--                               15 min is re-claimable, so a run that dies
--                               mid-batch never strands venues.
--   venues.enrich_source      — terminal marker set once a resolve attempt
--                               CONCLUDES (places_textsearch / places_no_website
--                               / places_no_match). A transient/provider error
--                               leaves it NULL, so the lease expiry re-queues
--                               the venue.
-- =============================================================================

alter table public.venues
  add column if not exists resolve_claimed_at timestamptz;

comment on column public.venues.resolve_claimed_at is
  'Soft lease stamped by leadflow_claim_resolve_venues when a name-only venue '
  'is reserved for name->website resolution. Claims older than 15 min are '
  're-claimable. Not a state; never gates outreach.';

-- Atomically lease up to p_limit name-only, not-yet-resolved venues (best
-- icp_score first), optionally org-scoped, via FOR UPDATE SKIP LOCKED. Returns
-- the full venue rows so the Edge Function reads what it needs. service_role only.
create or replace function public.leadflow_claim_resolve_venues(p_limit int, p_org uuid default null)
returns setof public.venues
language sql
security definer
set search_path = ''
as $$
  update public.venues v
     set resolve_claimed_at = now()
   where v.id in (
     select v2.id
       from public.venues v2
      where (v2.website is null or btrim(v2.website) = '')
        and v2.enrich_source is null
        and (v2.resolve_claimed_at is null
             or v2.resolve_claimed_at < now() - interval '15 minutes')
        and v2.archived is not true
        and v2.is_excluded is not true
        and (p_org is null or v2.org_id = p_org)
      order by v2.icp_score desc nulls last
      limit greatest(1, least(coalesce(p_limit, 50), 200))
      for update of v2 skip locked
   )
  returning v.*;
$$;

revoke all on function public.leadflow_claim_resolve_venues(int, uuid) from public;
grant execute on function public.leadflow_claim_resolve_venues(int, uuid) to service_role;

comment on function public.leadflow_claim_resolve_venues(int, uuid) is
  'Atomically leases up to p_limit name-only venues (no website, enrich_source '
  'NULL, best icp_score first, optionally org-scoped) for name->website '
  'resolution via FOR UPDATE SKIP LOCKED, stamping resolve_claimed_at. '
  'Overlapping resolve runs never claim the same venue, so Places is never '
  'double-billed. 15-min re-lease. service_role only.';

-- ---------------------------------------------------------------------------
-- Probe: function + lease column exist.
-- ---------------------------------------------------------------------------
do $$
declare has_col int; has_fn int;
begin
  select count(*) into has_col
    from information_schema.columns
   where table_schema = 'public' and table_name = 'venues'
     and column_name = 'resolve_claimed_at';
  if has_col < 1 then raise exception 'resolve_claimed_at column was not created'; end if;

  select count(*) into has_fn
    from pg_proc where proname = 'leadflow_claim_resolve_venues';
  if has_fn < 1 then raise exception 'leadflow_claim_resolve_venues was not created'; end if;
end $$;
