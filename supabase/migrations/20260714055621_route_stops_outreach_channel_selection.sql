-- =============================================================================
-- LeadFlow — route no-email venues into the Call Cycle: selection + stop tags
-- Migration: 20260714055621_route_stops_outreach_channel_selection
-- =============================================================================
-- Additive. No deletions, no RLS/permission changes.
--
-- 1. route_stops gains two nullable cached columns so the stop card can render
--    a tap-to-call action and a "Call first" / "Walk-in" badge without an extra
--    join at read time:
--      outreach_channel — 'email' | 'phone_only' | 'visit_only' | 'none'
--      phone_cached     — the venue phone at generation time (tap-to-call).
--
-- 2. generate_route_stops() is extended, NOT rebuilt:
--      • Pool A (follow-ups) — byte-for-byte unchanged.
--      • Pool B (prospects, radius) — unchanged selection; now also stamps
--        outreach_channel + phone_cached on each inserted prospect row.
--      • Pool C (NEW) — only fires when the route_day has a suburb_focus set.
--        It fills any prospect slots Pool B left open with the physical-funnel
--        residual: phone_only / visit_only venues in that suburb that Pool B
--        could not reach because they have NO lat/lng (radius can't see them).
--        These are exactly the no-email walk-in / cold-call venues the feature
--        exists to surface. est_drive_km is NULL (no geocode → no distance).
--    When suburb_focus is NULL, Pool C is a no-op, so existing days regenerate
--    identically apart from the new (previously absent) channel/phone tags.
--
-- The deliverable-email predicate is the same one used by the send gate,
-- idx_contacts_outreach_ready, and the venue_outreach_channel view — keep the
-- three in sync.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. route_stops cached channel + phone (additive, nullable)
-- ---------------------------------------------------------------------------
alter table public.route_stops
  add column if not exists outreach_channel text,
  add column if not exists phone_cached     text;

comment on column public.route_stops.outreach_channel is
  'Cached outreach channel of the stop venue at generation time '
  '(email | phone_only | visit_only | none). Drives the Call Cycle stop card '
  'badge (Call first / Walk-in). Set for prospect stops; NULL for anchors and '
  'follow-ups.';
comment on column public.route_stops.phone_cached is
  'Cached venue phone at generation time so the stop card can offer tap-to-call '
  'without a re-fetch. NULL when the venue has no phone.';

-- ---------------------------------------------------------------------------
-- 2. generate_route_stops — extended (Pool A unchanged, Pool B tagged, Pool C new)
-- ---------------------------------------------------------------------------
create or replace function public.generate_route_stops(
  p_route_day_id uuid,
  p_visited_lookback_days int default 30
) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_org_id       uuid;
  v_user_id      uuid;
  v_lat          double precision;
  v_lng          double precision;
  v_radius       numeric;
  v_target       int;
  v_share        numeric;
  v_anchor_id    uuid;
  v_suburb_focus text;
  v_n_prospect   int;
  v_n_follow_up  int;
  v_kept_count   int;
  v_kept_venue_ids uuid[];
  v_max_order    int;
  v_prospect_have int;
  v_remaining    int;
begin
  -- Load route_day knobs (resolve anchor lat/lng from venues if needed).
  select rd.org_id,
         rd.user_id,
         coalesce(rd.anchor_lat, av.lat),
         coalesce(rd.anchor_lng, av.lng),
         rd.radius_km,
         rd.target_stops,
         rd.prospect_share,
         rd.anchor_venue_id,
         rd.suburb_focus
    into v_org_id, v_user_id, v_lat, v_lng,
         v_radius, v_target, v_share, v_anchor_id, v_suburb_focus
    from public.route_days rd
    left join public.venues av on av.id = rd.anchor_venue_id
   where rd.id = p_route_day_id;

  if v_org_id is null then
    raise exception 'route_day % not found', p_route_day_id;
  end if;

  if v_lat is null or v_lng is null then
    raise exception 'route_day has no geocoded anchor (set anchor_venue_id with lat/lng or anchor_lat/anchor_lng)';
  end if;

  v_n_prospect  := round(v_target * v_share);
  v_n_follow_up := v_target - v_n_prospect;

  -- F4: preserve visited stops (immutable history). Only delete unvisited.
  delete from public.route_stops
   where route_day_id = p_route_day_id
     and field_visit_id is null;

  -- Track what stays so we don't double-suggest the same venue.
  select array_agg(venue_id), count(*)
    into v_kept_venue_ids, v_kept_count
    from public.route_stops
   where route_day_id = p_route_day_id;

  v_kept_venue_ids := coalesce(v_kept_venue_ids, '{}'::uuid[]);
  v_kept_count     := coalesce(v_kept_count, 0);

  select coalesce(max(stop_order), -1)
    into v_max_order
    from public.route_stops
   where route_day_id = p_route_day_id;

  -- Insert anchor first (skip if already present from a prior preserved stop).
  if v_anchor_id is not null and not (v_anchor_id = any(v_kept_venue_ids)) then
    insert into public.route_stops (
      org_id, route_day_id, venue_id, stop_order, stop_kind,
      venue_name_cached, suburb_cached, est_drive_km
    )
    select v_org_id, p_route_day_id, v.id, v_max_order + 1, 'anchor',
           v.name, v.suburb, 0
      from public.venues v
     where v.id = v_anchor_id;

    v_max_order := v_max_order + 1;
    v_kept_venue_ids := array_append(v_kept_venue_ids, v_anchor_id);
  end if;

  -- Pool A: FOLLOW-UPS — venues with active deals (last_touch_at older than N
  -- days OR null) and not visited recently. CTE materialises compute_lead_score
  -- once per contact instead of per ORDER BY pass.
  with primary_contacts as (
    select c.id as contact_id,
           c.venue_id,
           public.compute_lead_score(c.id) as score
      from public.contacts c
     where c.org_id = v_org_id
       and c.is_primary = true
       and c.venue_id is not null
  ),
  follow_up_pool as (
    select v.id as venue_id, v.name, v.suburb,
           pc.score,
           public.haversine_km(v_lat, v_lng, v.lat, v.lng) as dist_km
      from public.deals d
      join public.venues v on v.id = d.venue_id
      join primary_contacts pc on pc.venue_id = v.id and pc.contact_id = d.contact_id
      join public.pipeline_stages ps on ps.id = d.stage_id and ps.is_closed = false
     where d.org_id = v_org_id
       and v.lat is not null and v.lng is not null
       and not (v.id = any(v_kept_venue_ids))
       and (
         d.last_touch_at is null
         or d.last_touch_at < now() - make_interval(days => p_visited_lookback_days)
       )
       and not exists (
         select 1 from public.field_visits fv
          where (fv.venue_id = v.id or fv.contact_id = pc.contact_id)
            and fv.visited_at > now() - make_interval(days => p_visited_lookback_days)
       )
  ),
  follow_up_ranked as (
    select fp.*,
           (coalesce(fp.score, 0) - 5 * fp.dist_km) as rank_score
      from follow_up_pool fp
     where fp.dist_km <= v_radius
     order by rank_score desc
     limit greatest(v_n_follow_up, 0)
  )
  insert into public.route_stops (
    org_id, route_day_id, venue_id, stop_order, stop_kind,
    venue_name_cached, suburb_cached, lead_score_cached, est_drive_km
  )
  select v_org_id, p_route_day_id, fr.venue_id,
         v_max_order + row_number() over (order by fr.rank_score desc),
         'follow_up',
         fr.name, fr.suburb, fr.score::int, round(fr.dist_km::numeric, 2)
    from follow_up_ranked fr;

  -- Update cursor + dedupe set.
  select coalesce(max(stop_order), v_max_order)
    into v_max_order
    from public.route_stops
   where route_day_id = p_route_day_id;

  select array_agg(venue_id)
    into v_kept_venue_ids
    from public.route_stops
   where route_day_id = p_route_day_id;
  v_kept_venue_ids := coalesce(v_kept_venue_ids, '{}'::uuid[]);

  -- Pool B: PROSPECTS — venues with no active deal, untouched, in radius.
  -- Now also stamps outreach_channel + phone_cached (physical-funnel tags).
  with prospect_pool as (
    select v.id as venue_id, v.name, v.suburb, v.phone,
           v.icp_score,
           public.haversine_km(v_lat, v_lng, v.lat, v.lng) as dist_km,
           exists (
             select 1 from public.contacts c
              where c.venue_id = v.id
                and c.org_id   = v_org_id
                and c.verification_status = 'valid'
                and c.catch_all_flag is not true
                and c.role_based    is not true
           ) as has_email
      from public.venues v
     where v.org_id = v_org_id
       and v.lat is not null and v.lng is not null
       and v.is_excluded is not true
       and not (v.id = any(v_kept_venue_ids))
       and not exists (
         select 1 from public.deals d
         join public.pipeline_stages ps on ps.id = d.stage_id
         where d.venue_id = v.id and ps.is_closed = false
       )
       and not exists (
         select 1 from public.field_visits fv
          where fv.venue_id = v.id
            and fv.visited_at > now() - make_interval(days => p_visited_lookback_days)
       )
  ),
  prospect_ranked as (
    select pp.*,
           (coalesce(pp.icp_score, 0) - 5 * pp.dist_km) as rank_score
      from prospect_pool pp
     where pp.dist_km <= v_radius
     order by rank_score desc
     limit greatest(v_n_prospect, 0)
  )
  insert into public.route_stops (
    org_id, route_day_id, venue_id, stop_order, stop_kind,
    venue_name_cached, suburb_cached, lead_score_cached, est_drive_km,
    outreach_channel, phone_cached
  )
  select v_org_id, p_route_day_id, pr.venue_id,
         v_max_order + row_number() over (order by pr.rank_score desc),
         'prospect',
         pr.name, pr.suburb, pr.icp_score, round(pr.dist_km::numeric, 2),
         case
           when pr.has_email then 'email'
           when nullif(btrim(pr.phone), '') is not null then 'phone_only'
           when nullif(btrim(pr.suburb), '') is not null then 'visit_only'
           else 'none'
         end,
         nullif(btrim(pr.phone), '')
    from prospect_ranked pr;

  -- Refresh cursor + dedupe set after Pool B.
  select coalesce(max(stop_order), v_max_order)
    into v_max_order
    from public.route_stops
   where route_day_id = p_route_day_id;

  select array_agg(venue_id)
    into v_kept_venue_ids
    from public.route_stops
   where route_day_id = p_route_day_id;
  v_kept_venue_ids := coalesce(v_kept_venue_ids, '{}'::uuid[]);

  -- Pool C: SUBURB RESIDUAL — only when a suburb_focus is set. Fill remaining
  -- prospect slots with no-email venues in that suburb that Pool B could not
  -- reach (typically no lat/lng, so radius can't see them). These are the
  -- walk-in / cold-call residual this feature exists to surface.
  if nullif(btrim(v_suburb_focus), '') is not null then
    select count(*) into v_prospect_have
      from public.route_stops
     where route_day_id = p_route_day_id and stop_kind = 'prospect';

    v_remaining := greatest(coalesce(v_n_prospect, 0) - coalesce(v_prospect_have, 0), 0);

    if v_remaining > 0 then
      with suburb_pool as (
        select v.id as venue_id, v.name, v.suburb, v.phone, v.icp_score,
               exists (
                 select 1 from public.contacts c
                  where c.venue_id = v.id
                    and c.org_id   = v_org_id
                    and c.verification_status = 'valid'
                    and c.catch_all_flag is not true
                    and c.role_based    is not true
               ) as has_email
          from public.venues v
         where v.org_id = v_org_id
           and v.is_excluded is not true
           and lower(btrim(v.suburb)) = lower(btrim(v_suburb_focus))
           and not (v.id = any(v_kept_venue_ids))
           and not exists (
             select 1 from public.deals d
             join public.pipeline_stages ps on ps.id = d.stage_id
             where d.venue_id = v.id and ps.is_closed = false
           )
           and not exists (
             select 1 from public.field_visits fv
              where fv.venue_id = v.id
                and fv.visited_at > now() - make_interval(days => p_visited_lookback_days)
           )
      ),
      suburb_ranked as (
        select sp.*
          from suburb_pool sp
         where sp.has_email = false
         order by coalesce(sp.icp_score, 0) desc, sp.name
         limit v_remaining
      )
      insert into public.route_stops (
        org_id, route_day_id, venue_id, stop_order, stop_kind,
        venue_name_cached, suburb_cached, lead_score_cached, est_drive_km,
        outreach_channel, phone_cached
      )
      select v_org_id, p_route_day_id, sr.venue_id,
             v_max_order + row_number() over (order by coalesce(sr.icp_score, 0) desc, sr.name),
             'prospect',
             sr.name, sr.suburb, sr.icp_score, null,
             case
               when nullif(btrim(sr.phone), '') is not null then 'phone_only'
               else 'visit_only'
             end,
             nullif(btrim(sr.phone), '')
        from suburb_ranked sr;
    end if;
  end if;

  -- Stamp generation time.
  update public.route_days
     set generated_at = now()
   where id = p_route_day_id;
end;
$$;

comment on function public.generate_route_stops(uuid, int) is
  'Regenerates suggested stops for a route_day. Preserves stops where '
  'field_visit_id IS NOT NULL (visited history is immutable). Pool A = '
  'follow-ups (active deals untouched > lookback); Pool B = prospects in '
  'radius (tagged with outreach_channel + phone_cached); Pool C = suburb_focus '
  'residual (no-email phone_only/visit_only venues with no geocode, filling '
  'leftover prospect slots).';

-- ---------------------------------------------------------------------------
-- 3. Probe: new columns exist.
-- ---------------------------------------------------------------------------
do $$
declare n int;
begin
  select count(*) into n from information_schema.columns
   where table_schema = 'public' and table_name = 'route_stops'
     and column_name in ('outreach_channel', 'phone_cached');
  if n < 2 then
    raise exception 'route_stops channel columns not created (found %)', n;
  end if;
end $$;
