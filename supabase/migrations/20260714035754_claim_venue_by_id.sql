-- =============================================================================
-- LeadFlow — add p_venue filter to the claim functions (single-venue parity)
-- Migration: 20260714035754_claim_venue_by_id
-- =============================================================================
-- Additive parameter on two existing functions. No data loss, RLS untouched,
-- no permission changes beyond re-granting EXECUTE on the new signatures to
-- service_role only.
--
-- Why: single-venue enrich-venue-contacts mode (venue_id in the request body)
-- previously loaded the row directly and acted on it. That path had NEITHER
-- the terminal-marker skip NOR the concurrency safety the batch path gets from
-- the claim RPCs — two overlapping single-venue calls could both read
-- guess_attempted_at = NULL / enrich_source = NULL and each spend a paid
-- ZeroBounce / Places call on the same venue. Routing single mode through the
-- same claim functions (with p_limit => 1, p_venue => the requested id) makes it
-- inherit the FOR UPDATE SKIP LOCKED lease, the 15-min re-lease, and every
-- terminal-marker / eligibility filter for free.
--
-- CREATE OR REPLACE cannot add a parameter, so we DROP the old (int, uuid)
-- signatures and CREATE the new (int, uuid, uuid) ones. Existing batch call
-- sites use named args {p_limit, p_org}, which stay valid with p_venue
-- defaulting NULL — no caller change is forced by this migration.
--
-- DROP FUNCTION here is function DDL, not data destruction: no table, row, or
-- column is touched. Both functions are immediately recreated in the same
-- transaction.
-- =============================================================================

drop function if exists public.leadflow_claim_guess_venues(int, uuid);
drop function if exists public.leadflow_claim_resolve_venues(int, uuid);

-- ---------------------------------------------------------------------------
-- Guess claim: un-attempted venues WITH a website, best icp_score first,
-- optionally org-scoped, optionally pinned to a single venue via p_venue.
-- ---------------------------------------------------------------------------
create or replace function public.leadflow_claim_guess_venues(
  p_limit int,
  p_org uuid default null,
  p_venue uuid default null
)
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
        and (p_venue is null or v2.id = p_venue)
      order by v2.icp_score desc nulls last
      limit greatest(1, least(coalesce(p_limit, 50), 200))
      for update of v2 skip locked
   )
  returning v.*;
$$;

revoke all on function public.leadflow_claim_guess_venues(int, uuid, uuid) from public;
grant execute on function public.leadflow_claim_guess_venues(int, uuid, uuid) to service_role;

comment on function public.leadflow_claim_guess_venues(int, uuid, uuid) is
  'Atomically leases up to p_limit venues (with a website, not yet guess-'
  'attempted, best icp_score first, optionally org-scoped, optionally pinned '
  'to a single id via p_venue) for pattern-guess-then-verify via FOR UPDATE '
  'SKIP LOCKED, stamping guess_claimed_at. Overlapping enrich runs never claim '
  'the same venue. 15-min re-lease. service_role only.';

-- ---------------------------------------------------------------------------
-- Resolve claim: name-only venues (no website, not yet resolved), best
-- icp_score first, optionally org-scoped, optionally pinned via p_venue.
-- ---------------------------------------------------------------------------
create or replace function public.leadflow_claim_resolve_venues(
  p_limit int,
  p_org uuid default null,
  p_venue uuid default null
)
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
        and (p_venue is null or v2.id = p_venue)
      order by v2.icp_score desc nulls last
      limit greatest(1, least(coalesce(p_limit, 50), 200))
      for update of v2 skip locked
   )
  returning v.*;
$$;

revoke all on function public.leadflow_claim_resolve_venues(int, uuid, uuid) from public;
grant execute on function public.leadflow_claim_resolve_venues(int, uuid, uuid) to service_role;

comment on function public.leadflow_claim_resolve_venues(int, uuid, uuid) is
  'Atomically leases up to p_limit name-only venues (no website, enrich_source '
  'NULL, best icp_score first, optionally org-scoped, optionally pinned to a '
  'single id via p_venue) for name->website resolution via FOR UPDATE SKIP '
  'LOCKED, stamping resolve_claimed_at. Overlapping resolve runs never claim '
  'the same venue, so Places is never double-billed. 15-min re-lease. '
  'service_role only.';

-- ---------------------------------------------------------------------------
-- Probe: both functions exist at the new 3-arg signature.
-- ---------------------------------------------------------------------------
do $$
declare has_guess int; has_resolve int;
begin
  select count(*) into has_guess
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'leadflow_claim_guess_venues'
     and p.pronargs = 3;
  if has_guess < 1 then raise exception 'leadflow_claim_guess_venues(int,uuid,uuid) was not created'; end if;

  select count(*) into has_resolve
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'leadflow_claim_resolve_venues'
     and p.pronargs = 3;
  if has_resolve < 1 then raise exception 'leadflow_claim_resolve_venues(int,uuid,uuid) was not created'; end if;
end $$;
