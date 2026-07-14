-- =============================================================================
-- LeadFlow — atomic claim for pattern-guess venues
-- Migration: 20260714033812_claim_guess_venues
-- =============================================================================
-- Additive + one new function. No data loss, RLS untouched, no permission
-- changes beyond granting EXECUTE on the new function to service_role only.
--
-- Mirrors leadflow_claim_pending_contacts (20260713071050_verify_contacts_cron):
-- the guess batch must RESERVE venues before spending a ZeroBounce credit on
-- them, so two overlapping enrich-venue-contacts runs never double-verify — and
-- never burn duplicate paid API calls — on the same venue.
--
--   venues.guess_claimed_at  — soft lease (NOT a state). A claim older than
--                              15 min is re-claimable, so a run that dies
--                              mid-batch (ZeroBounce 502) never strands venues.
--   venues.guess_attempted_at — terminal marker set once an attempt CONCLUDES
--                              (added in 20260714033442). An out-of-credits /
--                              provider-error pause leaves it NULL, so the lease
--                              expiry re-queues the venue when credits return.
-- =============================================================================

alter table public.venues
  add column if not exists guess_claimed_at timestamptz;

comment on column public.venues.guess_claimed_at is
  'Soft lease stamped by leadflow_claim_guess_venues when a venue is reserved '
  'for pattern-guess-then-verify. Claims older than 15 min are re-claimable. '
  'Not a state; never gates outreach.';

-- Atomically lease up to p_limit un-attempted venues (best icp_score first),
-- optionally org-scoped, via FOR UPDATE SKIP LOCKED. Returns the full venue
-- rows so the Edge Function reads what it needs. service_role only.
create or replace function public.leadflow_claim_guess_venues(p_limit int, p_org uuid default null)
returns setof public.venues
language sql
security definer
set search_path = ''
as $$
  update public.venues v
     set guess_claimed_at = now()
   where v.id in (
     select v2.id
       from public.venues v2
      where v2.website is not null
        and btrim(v2.website) <> ''
        and v2.guess_attempted_at is null
        and (v2.guess_claimed_at is null
             or v2.guess_claimed_at < now() - interval '15 minutes')
        and v2.archived is not true
        and v2.is_excluded is not true
        and (p_org is null or v2.org_id = p_org)
      order by v2.icp_score desc nulls last
      limit greatest(1, least(coalesce(p_limit, 50), 200))
      for update of v2 skip locked
   )
  returning v.*;
$$;

revoke all on function public.leadflow_claim_guess_venues(int, uuid) from public;
grant execute on function public.leadflow_claim_guess_venues(int, uuid) to service_role;

comment on function public.leadflow_claim_guess_venues(int, uuid) is
  'Atomically leases up to p_limit venues (with a website, not yet guess-'
  'attempted, best icp_score first, optionally org-scoped) for pattern-guess-'
  'then-verify via FOR UPDATE SKIP LOCKED, stamping guess_claimed_at. '
  'Overlapping enrich runs never claim the same venue. 15-min re-lease. '
  'service_role only.';

-- ---------------------------------------------------------------------------
-- Probe: function + lease column exist.
-- ---------------------------------------------------------------------------
do $$
declare has_col int; has_fn int;
begin
  select count(*) into has_col
    from information_schema.columns
   where table_schema = 'public' and table_name = 'venues'
     and column_name = 'guess_claimed_at';
  if has_col < 1 then raise exception 'guess_claimed_at column was not created'; end if;

  select count(*) into has_fn
    from pg_proc where proname = 'leadflow_claim_guess_venues';
  if has_fn < 1 then raise exception 'leadflow_claim_guess_venues was not created'; end if;
end $$;
