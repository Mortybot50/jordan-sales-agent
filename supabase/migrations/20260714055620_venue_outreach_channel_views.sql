-- =============================================================================
-- LeadFlow — route no-email venues into the Call Cycle: classification views
-- Migration: 20260714055620_venue_outreach_channel_views
-- =============================================================================
-- Additive, read-only. Two views, no table changes, no RLS/permission changes,
-- no deletions. Both are security_invoker so the querying user's existing RLS
-- on venues / contacts / field_visits applies unchanged (Jordan only ever sees
-- his own org's rows). Provenance: venues we cannot find a deliverable email for
-- are NOT dead weight — they become the physical-prospecting funnel.
--
-- 1. venue_outreach_channel — derives, per venue, the best channel Jordan has:
--      'email'      — a deliverable mailbox exists (same predicate as the send
--                     gate / idx_contacts_outreach_ready: a contact that is
--                     verification_status='valid' AND NOT catch_all AND NOT
--                     role_based). Those go down the normal verify→draft→send
--                     pipeline; they are NOT the physical funnel.
--      'phone_only' — no deliverable email but a phone (Places-resolved) exists
--                     → cold-call candidate (tap-to-call).
--      'visit_only' — no deliverable email, no phone, but a suburb exists
--                     → walk-in candidate.
--      'none'       — nothing to work with (no email, no phone, no suburb).
--    The email predicate is inlined (not a function) to keep the view a single
--    planner-friendly scan; it MUST stay in sync with the same predicate in
--    generate_route_stops() and the idx_contacts_outreach_ready partial index.
--
-- 2. venue_area_coverage — per (org, normalised suburb) progress of the physical
--    funnel so Jordan can work a region over successive weeks WITHOUT repeating
--    venues already done: how many phone_only/visit_only candidates a suburb
--    holds, and how many have already been contacted (any field_visit ever).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. venue_outreach_channel
-- ---------------------------------------------------------------------------
create or replace view public.venue_outreach_channel
with (security_invoker = on) as
select
  v.id            as venue_id,
  v.org_id,
  v.name,
  v.suburb,
  v.lat,
  v.lng,
  v.phone,
  v.is_excluded,
  exists (
    select 1
      from public.contacts c
     where c.venue_id = v.id
       and c.org_id   = v.org_id
       and c.verification_status = 'valid'
       and c.catch_all_flag is not true
       and c.role_based    is not true
  ) as has_deliverable_email,
  case
    when exists (
      select 1
        from public.contacts c
       where c.venue_id = v.id
         and c.org_id   = v.org_id
         and c.verification_status = 'valid'
         and c.catch_all_flag is not true
         and c.role_based    is not true
    ) then 'email'
    when nullif(btrim(v.phone), '') is not null then 'phone_only'
    when nullif(btrim(v.suburb), '') is not null then 'visit_only'
    else 'none'
  end as outreach_channel
from public.venues v;

comment on view public.venue_outreach_channel is
  'Per-venue best outreach channel (email | phone_only | visit_only | none). '
  'email = a deliverable mailbox exists (same predicate as the send gate). '
  'phone_only / visit_only venues are the physical-prospecting funnel fed into '
  'the Call Cycle. security_invoker — RLS of the querying user applies.';

grant select on public.venue_outreach_channel to authenticated;

-- ---------------------------------------------------------------------------
-- 2. venue_area_coverage
-- ---------------------------------------------------------------------------
-- Candidates = non-excluded venues in the physical funnel (phone_only or
-- visit_only). Grouped by a normalised suburb key (lower/trim) so 'Collingwood'
-- and 'COLLINGWOOD' from different sources count together; suburb_label is a
-- readable representative. contacted = the venue has at least one field_visit.
create or replace view public.venue_area_coverage
with (security_invoker = on) as
select
  voc.org_id,
  lower(btrim(voc.suburb))          as suburb_key,
  min(voc.suburb)                    as suburb_label,
  count(*)                           as total_candidates,
  count(*) filter (where voc.outreach_channel = 'phone_only') as phone_only,
  count(*) filter (where voc.outreach_channel = 'visit_only') as visit_only,
  count(*) filter (where exists (
    select 1 from public.field_visits fv where fv.venue_id = voc.venue_id
  ))                                 as contacted,
  count(*) filter (where not exists (
    select 1 from public.field_visits fv where fv.venue_id = voc.venue_id
  ))                                 as remaining
from public.venue_outreach_channel voc
where voc.is_excluded is not true
  and voc.outreach_channel in ('phone_only', 'visit_only')
  and nullif(btrim(voc.suburb), '') is not null
group by voc.org_id, lower(btrim(voc.suburb));

comment on view public.venue_area_coverage is
  'Per (org, suburb) coverage of the physical-prospecting funnel: how many '
  'phone_only/visit_only candidates a suburb holds and how many have been '
  'contacted (any field_visit). Lets Jordan work a region over weeks without '
  'repeating done venues. security_invoker — RLS of the querying user applies.';

grant select on public.venue_area_coverage to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Probe: both views exist and are selectable.
-- ---------------------------------------------------------------------------
do $$
declare n int;
begin
  select count(*) into n from information_schema.views
   where table_schema = 'public'
     and table_name in ('venue_outreach_channel', 'venue_area_coverage');
  if n < 2 then
    raise exception 'expected 2 outreach views, found %', n;
  end if;
  perform 1 from public.venue_outreach_channel limit 1;
  perform 1 from public.venue_area_coverage limit 1;
end $$;
