-- =============================================================================
-- LeadFlow Jordan Sales Agent — Call Cycle Planner (Phase 1)
-- Migration: 20260510000001_call_cycle_planner
-- =============================================================================
-- Persisted weekly route diary. Each (org, user, weekday) has 0–1 active
-- route_day rows; stops are an ordered list of venues for that day.
--
-- Amendments folded in:
--   A1 (10/05/2026) — day_of_week accepts Mon–Sat (1..6), not Mon–Fri.
--   F4 (eng/design) — generate_route_stops preserves visited stops on regen
--                     (rows where field_visit_id IS NOT NULL are immutable).
--   CTE-materialise compute_lead_score to avoid N+1 per candidate.
--   last_touch_at is the schema name (not last_touched_at).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- VENUES — geocoding columns + last_visited_at
-- ---------------------------------------------------------------------------
alter table public.venues
  add column if not exists lat              double precision,
  add column if not exists lng              double precision,
  add column if not exists geocoded_at      timestamptz,
  add column if not exists last_visited_at  timestamptz;

create index if not exists venues_lat_lng_idx
  on public.venues (org_id) where lat is not null and lng is not null;

-- ---------------------------------------------------------------------------
-- FIELD_VISITS — venue_id so prospecting drop-ins (no contact yet) can log
-- ---------------------------------------------------------------------------
alter table public.field_visits
  add column if not exists venue_id uuid references public.venues(id) on delete set null;

create index if not exists field_visits_venue_idx
  on public.field_visits (venue_id) where venue_id is not null;

-- ---------------------------------------------------------------------------
-- ROUTE_DAYS — one row per (user, weekday). Mon–Sat (1..6).
-- ---------------------------------------------------------------------------
create table if not exists public.route_days (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.orgs(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  -- ISO weekday: 1=Mon..6=Sat. Sunday deliberately excluded.
  day_of_week     int not null check (day_of_week between 1 and 6),
  anchor_venue_id uuid references public.venues(id) on delete set null,
  suburb_focus    text,
  anchor_lat      double precision,
  anchor_lng      double precision,
  prospect_share  numeric(3,2) not null default 0.70
    check (prospect_share between 0 and 1),
  radius_km       numeric(4,1) not null default 5.0
    check (radius_km between 0.5 and 25.0),
  target_stops    int not null default 5
    check (target_stops between 1 and 12),
  generated_at    timestamptz,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create unique index if not exists route_days_unique_per_user_weekday
  on public.route_days (org_id, user_id, day_of_week);

create index if not exists route_days_user_weekday_idx
  on public.route_days (user_id, day_of_week);

alter table public.route_days enable row level security;

drop policy if exists "route_days_select" on public.route_days;
drop policy if exists "route_days_insert" on public.route_days;
drop policy if exists "route_days_update" on public.route_days;
drop policy if exists "route_days_delete" on public.route_days;

create policy "route_days_select" on public.route_days
  for select using (org_id = auth_org_id());
create policy "route_days_insert" on public.route_days
  for insert with check (org_id = auth_org_id() and user_id = auth.uid());
create policy "route_days_update" on public.route_days
  for update using (org_id = auth_org_id() and user_id = auth.uid())
    with check (org_id = auth_org_id() and user_id = auth.uid());
create policy "route_days_delete" on public.route_days
  for delete using (org_id = auth_org_id() and user_id = auth.uid());

drop trigger if exists set_route_days_updated_at on public.route_days;
create trigger set_route_days_updated_at
  before update on public.route_days for each row execute procedure set_updated_at();

-- ---------------------------------------------------------------------------
-- ROUTE_STOPS — ordered list of venues for a route_day
-- ---------------------------------------------------------------------------
create table if not exists public.route_stops (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.orgs(id) on delete cascade,
  route_day_id      uuid not null references public.route_days(id) on delete cascade,
  venue_id          uuid not null references public.venues(id) on delete cascade,
  stop_order        int not null check (stop_order >= 0),
  stop_kind         text not null check (stop_kind in ('prospect','follow_up','anchor','calendly')),
  est_arrival_min   int,
  est_drive_km      numeric(5,2),
  venue_name_cached text not null,
  suburb_cached     text,
  lead_score_cached int,
  field_visit_id    uuid references public.field_visits(id) on delete set null,
  created_at        timestamptz not null default now()
);

create unique index if not exists route_stops_order_unique
  on public.route_stops (route_day_id, stop_order);

create index if not exists route_stops_venue_idx
  on public.route_stops (venue_id);

create index if not exists route_stops_route_day_idx
  on public.route_stops (route_day_id);

alter table public.route_stops enable row level security;

drop policy if exists "route_stops_select" on public.route_stops;
drop policy if exists "route_stops_insert" on public.route_stops;
drop policy if exists "route_stops_update" on public.route_stops;
drop policy if exists "route_stops_delete" on public.route_stops;

create policy "route_stops_select" on public.route_stops
  for select using (org_id = auth_org_id());
create policy "route_stops_insert" on public.route_stops
  for insert with check (
    org_id = auth_org_id()
    and exists (
      select 1 from public.route_days rd
      where rd.id = route_day_id
        and rd.user_id = auth.uid()
        and rd.org_id = auth_org_id()
    )
  );
create policy "route_stops_update" on public.route_stops
  for update using (
    org_id = auth_org_id()
    and exists (
      select 1 from public.route_days rd
      where rd.id = route_day_id and rd.user_id = auth.uid()
    )
  );
create policy "route_stops_delete" on public.route_stops
  for delete using (
    org_id = auth_org_id()
    and exists (
      select 1 from public.route_days rd
      where rd.id = route_day_id and rd.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- haversine_km — pure-SQL distance helper (km).
-- ---------------------------------------------------------------------------
create or replace function public.haversine_km(
  lat1 double precision, lng1 double precision,
  lat2 double precision, lng2 double precision
) returns double precision
language sql immutable
as $$
  select 2 * 6371 * asin(sqrt(
    sin(radians(lat2 - lat1)/2)^2 +
    cos(radians(lat1)) * cos(radians(lat2)) * sin(radians(lng2 - lng1)/2)^2
  ));
$$;

-- ---------------------------------------------------------------------------
-- generate_route_stops(route_day_id, lookback_days) — selection algorithm.
-- Pure SQL; preserves visited stops on regen (F4 fix).
-- ---------------------------------------------------------------------------
create or replace function public.generate_route_stops(
  p_route_day_id uuid,
  p_visited_lookback_days int default 30
) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_org_id      uuid;
  v_user_id     uuid;
  v_lat         double precision;
  v_lng         double precision;
  v_radius      numeric;
  v_target      int;
  v_share       numeric;
  v_anchor_id   uuid;
  v_n_prospect  int;
  v_n_follow_up int;
  v_kept_count  int;
  v_kept_venue_ids uuid[];
  v_max_order   int;
begin
  -- Load route_day knobs (resolve anchor lat/lng from venues if needed).
  select rd.org_id,
         rd.user_id,
         coalesce(rd.anchor_lat, av.lat),
         coalesce(rd.anchor_lng, av.lng),
         rd.radius_km,
         rd.target_stops,
         rd.prospect_share,
         rd.anchor_venue_id
    into v_org_id, v_user_id, v_lat, v_lng,
         v_radius, v_target, v_share, v_anchor_id
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
  with prospect_pool as (
    select v.id as venue_id, v.name, v.suburb,
           v.icp_score,
           public.haversine_km(v_lat, v_lng, v.lat, v.lng) as dist_km
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
    venue_name_cached, suburb_cached, lead_score_cached, est_drive_km
  )
  select v_org_id, p_route_day_id, pr.venue_id,
         v_max_order + row_number() over (order by pr.rank_score desc),
         'prospect',
         pr.name, pr.suburb, pr.icp_score, round(pr.dist_km::numeric, 2)
    from prospect_ranked pr;

  -- Stamp generation time.
  update public.route_days
     set generated_at = now()
   where id = p_route_day_id;
end;
$$;

comment on function public.generate_route_stops(uuid, int) is
  'Regenerates suggested stops for a route_day. Preserves stops where '
  'field_visit_id IS NOT NULL (visited history is immutable). Pool A = '
  'follow-ups (active deals untouched > lookback); Pool B = prospects.';

-- ---------------------------------------------------------------------------
-- handle_field_visit_insert — extend to derive contact from venue, bump
-- venues.last_visited_at and deals.last_touch_at.
-- ---------------------------------------------------------------------------
create or replace function public.handle_field_visit_insert()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_deal_id uuid;
  v_contact_id_for_activity uuid;
  v_outcome_label text;
  v_notes_truncated text;
  v_body text;
begin
  -- Activity threading: prefer explicit contact_id, else derive from venue's
  -- primary contact (so prospecting drop-ins still write a coherent timeline
  -- entry). We do NOT overwrite field_visits.contact_id — that stays NULL.
  v_contact_id_for_activity := new.contact_id;
  if v_contact_id_for_activity is null and new.venue_id is not null then
    select c.id
      into v_contact_id_for_activity
      from public.contacts c
     where c.venue_id = new.venue_id
       and c.org_id = new.org_id
       and c.is_primary = true
     limit 1;
  end if;

  -- Find a linked deal to thread the activity into.
  if v_contact_id_for_activity is not null then
    select id into v_deal_id
      from public.deals
     where contact_id = v_contact_id_for_activity
       and org_id = new.org_id
     order by updated_at desc nulls last
     limit 1;
  elsif new.venue_id is not null then
    select id into v_deal_id
      from public.deals
     where venue_id = new.venue_id
       and org_id = new.org_id
     order by updated_at desc nulls last
     limit 1;
  end if;

  v_outcome_label := case new.outcome
    when 'interested' then 'Interested'
    when 'not_now'    then 'Not now'
    when 'closed'     then 'Closed/quiet'
    when 'not_in'     then 'Not in'
    when 'dm_absent'  then 'DM absent'
    else 'Other'
  end;

  v_notes_truncated := case
    when new.notes is null or new.notes = '' then ''
    when char_length(new.notes) > 240 then ' — ' || left(new.notes, 240) || '…'
    else ' — ' || new.notes
  end;

  v_body := v_outcome_label || v_notes_truncated;

  insert into public.activities (
    org_id, deal_id, contact_id, activity_type,
    subject, body, metadata, occurred_at
  ) values (
    new.org_id,
    v_deal_id,
    v_contact_id_for_activity,
    'field_visit',
    'Field visit: ' || v_outcome_label,
    v_body,
    jsonb_build_object(
      'field_visit_id', new.id,
      'venue_id', new.venue_id,
      'outcome', new.outcome,
      'lat', new.lat,
      'lng', new.lng,
      'voice_audio_path', new.voice_audio_path
    ),
    new.visited_at
  );

  -- Bump contact.last_visited_at when present (only for the explicit contact
  -- the visit logged against, not the derived-for-activity one).
  if new.contact_id is not null then
    update public.contacts
       set last_visited_at = new.visited_at,
           updated_at = now()
     where id = new.contact_id
       and org_id = new.org_id;
  end if;

  -- Bump venue.last_visited_at when the visit was logged against a venue.
  if new.venue_id is not null then
    update public.venues
       set last_visited_at = new.visited_at,
           updated_at = now()
     where id = new.venue_id
       and org_id = new.org_id;
  end if;

  -- Bump linked deal.last_touch_at so pipeline KPIs roll forward.
  if v_deal_id is not null then
    update public.deals
       set last_touch_at = new.visited_at,
           updated_at = now()
     where id = v_deal_id
       and org_id = new.org_id;
  end if;

  return new;
end;
$$;
