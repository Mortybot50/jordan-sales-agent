-- =============================================================================
-- Pre-cold-send essentials — sender_inboxes, daily-cap enforcement,
-- suppression hard-gate at promotion time.
-- Migration: 20260504000001_pre_coldsend_essentials
-- =============================================================================
-- Goal: have everything in place BEFORE the first real cold-send goes out
-- (~2 weeks away while Instantly warms 4 inboxes). Adds:
--   1. `is_suppressed(org_id, email)` SQL helper — single source of truth
--      that mirrors the normalisation logic the TS code already does
--      (lower-case, strip + alias from local-part, also match domain rows
--      where `domain_suppression = true`).
--   2. `'suppressed'` and `'queued'` status enum values on `email_drafts`,
--      plus a `suppression_reason` column so the UI can explain why a
--      draft didn't ship.
--   3. BEFORE INSERT/UPDATE trigger that intercepts a draft moving into
--      'approved' or 'queued' and flips it to 'suppressed' if the
--      contact email is on the org's suppression list. Belt-and-suspenders
--      with the existing TS pre-checks — we never want a suppressed
--      address to leave the system.
--   4. `sender_inboxes` table (per-org, multiple inboxes, weighted
--      round-robin via `weight`, cap-aware via `daily_cap`).
--   5. `select_next_sender(org_id)` SQL function — returns the inbox row
--      with the most spare capacity today (Australia/Melbourne TZ),
--      or null if every inbox is capped.
--   6. `sender_inbox_id` FK column on `email_drafts` so we can attribute
--      a draft to a chosen inbox at approve/queue time.
--   7. Initial seed: Jordan's two warming inboxes
--      (jordan@premiumwaterau.com.au, jordan@jordanmarziale.com.au).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. is_suppressed(org_id, email) — one canonical implementation.
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER so it can read suppression_list regardless of caller
-- (the trigger below runs in the row owner's auth context, but Edge
-- Functions using the service role bypass RLS anyway). search_path is
-- pinned to public to avoid hijack via a malicious schema on the path.

create or replace function public.is_suppressed(
  p_org_id uuid,
  p_email  text
) returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_raw        text;
  v_at         int;
  v_local      text;
  v_domain     text;
  v_normalised text;
  v_hit        record;
begin
  if p_email is null or p_org_id is null then
    return false;
  end if;

  v_raw := lower(btrim(p_email));
  v_at  := position('@' in v_raw);
  if v_at = 0 then
    return false;
  end if;

  v_local      := split_part(substring(v_raw from 1 for v_at - 1), '+', 1);
  v_domain     := substring(v_raw from v_at + 1);
  v_normalised := v_local || '@' || v_domain;

  select sl.email, sl.domain_suppression
    into v_hit
  from public.suppression_list sl
  where sl.org_id = p_org_id
    and (
      (sl.domain_suppression = false and sl.email = v_normalised)
      or (sl.domain_suppression = true  and sl.email = v_domain)
    )
  limit 1;

  return found;
end;
$$;

comment on function public.is_suppressed(uuid, text) is
  'True if the given email (or its domain) is on the org''s suppression_list. '
  'Mirrors the normalisation TS callers do (lowercase, strip +alias).';

-- ---------------------------------------------------------------------------
-- 2. email_drafts: add 'suppressed' + 'queued' to status, plus reason col.
-- ---------------------------------------------------------------------------

alter table public.email_drafts
  drop constraint if exists email_drafts_status_check;

alter table public.email_drafts
  add constraint email_drafts_status_check
  check (status in (
    'pending',
    'approved',
    'edited',
    'rejected',
    'sent',
    'draft_failed',
    'queued',
    'suppressed'
  ));

alter table public.email_drafts
  add column if not exists suppression_reason text;

comment on column public.email_drafts.suppression_reason is
  'Populated by the suppression-guard trigger when a draft is auto-flipped '
  'to status = ''suppressed''. Lets Jordan see WHY a draft didn''t send.';

-- ---------------------------------------------------------------------------
-- 3. Suppression-guard trigger — block promotion of suppressed addresses.
-- ---------------------------------------------------------------------------
-- Fires BEFORE INSERT or UPDATE. Only acts when NEW.status is being moved
-- into a "ready-to-send" state. Looks up the contact's email and, if
-- suppressed, rewrites the row in flight rather than raising — that way
-- the row gets persisted (Jordan can see it) but it never ships.

create or replace function public.email_drafts_suppression_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email  text;
  v_reason text;
begin
  if NEW.status not in ('approved', 'queued') then
    return NEW;
  end if;

  if NEW.contact_id is null then
    return NEW;
  end if;

  select c.email into v_email
  from public.contacts c
  where c.id = NEW.contact_id
  limit 1;

  if v_email is null then
    return NEW;
  end if;

  if public.is_suppressed(NEW.org_id, v_email) then
    -- Look up the actual reason for the suppression record so the UI can
    -- show it. Match the same normalisation as is_suppressed.
    select sl.reason
      into v_reason
    from public.suppression_list sl
    where sl.org_id = NEW.org_id
      and (
        (sl.domain_suppression = false and sl.email = lower(btrim(v_email)))
        or (sl.domain_suppression = true  and sl.email = split_part(lower(btrim(v_email)), '@', 2))
      )
    limit 1;

    NEW.status := 'suppressed';
    NEW.suppression_reason := coalesce(v_reason, 'unknown');
    NEW.approved_at := null;
  end if;

  return NEW;
end;
$$;

drop trigger if exists email_drafts_suppression_guard on public.email_drafts;

create trigger email_drafts_suppression_guard
  before insert or update on public.email_drafts
  for each row
  execute function public.email_drafts_suppression_guard();

-- ---------------------------------------------------------------------------
-- 4. sender_inboxes — per-org sender pool for rotation + cap enforcement.
-- ---------------------------------------------------------------------------

create table if not exists public.sender_inboxes (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null references public.orgs(id) on delete cascade,
  email                text not null,
  display_name         text,
  daily_cap            int  not null default 30,   -- warmup ceiling; bump to 80 post-warmup
  enabled              boolean not null default true,
  weight               int  not null default 1,    -- weighted round-robin
  last_send_at         timestamptz,
  instantly_account_id text,                       -- nullable; future Instantly API integration
  notes                text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create unique index if not exists sender_inboxes_org_email_uidx
  on public.sender_inboxes (org_id, lower(email));

create index if not exists sender_inboxes_org_enabled_idx
  on public.sender_inboxes (org_id, enabled)
  where enabled = true;

create trigger set_sender_inboxes_updated_at
  before update on public.sender_inboxes
  for each row execute procedure set_updated_at();

alter table public.sender_inboxes enable row level security;

create policy "sender_inboxes_select" on public.sender_inboxes
  for select using (org_id = auth_org_id());

create policy "sender_inboxes_insert" on public.sender_inboxes
  for insert with check (org_id = auth_org_id());

create policy "sender_inboxes_update" on public.sender_inboxes
  for update using (org_id = auth_org_id())
  with check (org_id = auth_org_id());

create policy "sender_inboxes_delete" on public.sender_inboxes
  for delete using (org_id = auth_org_id());

-- ---------------------------------------------------------------------------
-- 5. email_drafts.sender_inbox_id — link a draft to its chosen sender.
-- ---------------------------------------------------------------------------

alter table public.email_drafts
  add column if not exists sender_inbox_id uuid references public.sender_inboxes(id) on delete set null;

-- Index supports the daily-cap query in select_next_sender (and any future
-- "what did this inbox send today" surfaces).
create index if not exists email_drafts_sender_inbox_sent_idx
  on public.email_drafts (sender_inbox_id, sent_at)
  where status in ('queued', 'sent');

-- ---------------------------------------------------------------------------
-- 6. select_next_sender(org_id) — pick the inbox with most headroom today.
-- ---------------------------------------------------------------------------
-- Strategy: count today's queued+sent drafts per enabled inbox (Melbourne
-- TZ; that's the tenant's TZ for v1). Filter out inboxes already at cap.
-- From the survivors, pick the one with the highest `weight` — ties
-- broken by `last_send_at NULLS FIRST` so the inbox that hasn't fired
-- recently gets a turn. Returns null when all are capped.

create or replace function public.select_next_sender(p_org_id uuid)
returns public.sender_inboxes
language sql
stable
security definer
set search_path = public
as $$
  with today_bounds as (
    select
      ((now() at time zone 'Australia/Melbourne')::date)
        at time zone 'Australia/Melbourne' as ts_start
  ),
  sent_today as (
    select
      d.sender_inbox_id,
      count(*)::int as sends_today
    from public.email_drafts d, today_bounds tb
    where d.status in ('queued', 'sent')
      and coalesce(d.sent_at, d.generated_at, d.created_at) >= tb.ts_start
    group by d.sender_inbox_id
  )
  select si.*
  from public.sender_inboxes si
  left join sent_today st on st.sender_inbox_id = si.id
  where si.org_id  = p_org_id
    and si.enabled = true
    and coalesce(st.sends_today, 0) < si.daily_cap
  order by si.weight desc,
           si.last_send_at asc nulls first,
           si.id asc
  limit 1;
$$;

comment on function public.select_next_sender(uuid) is
  'Returns the next sender_inbox row to use for a given org, or null when '
  'every enabled inbox has hit daily_cap for today (Australia/Melbourne TZ).';

-- ---------------------------------------------------------------------------
-- 7. Extend activities.activity_type to include the new lifecycle events
--    we surface from the approve path: daily_cap_reached and draft_suppressed.
-- ---------------------------------------------------------------------------

alter table public.activities drop constraint if exists activities_activity_type_check;
alter table public.activities add constraint activities_activity_type_check
  check (activity_type = any(array[
    'email_sent', 'email_opened', 'email_clicked', 'reply_received',
    'call_note', 'meeting_note', 'task_completed', 'stage_change',
    'bounce', 'unsubscribe',
    'email_inbound', 'email_outbound', 'deal_created', 'note', 'meeting_booked',
    'email_manual', 'import', 'voice_note',
    'daily_cap_reached', 'draft_suppressed'
  ]));
-- 'voice_note' was patched into the live constraint at apply time (04/05/2026,
-- Field Mode dependency) but the source file missed it — added 11/06/2026 so a
-- fresh-clone replay matches production. Live constraint verified identical.

-- ---------------------------------------------------------------------------
-- 8. Seed Jordan's two warming inboxes for the demo org.
--    (Idempotent — uses the unique (org_id, lower(email)) index.)
-- ---------------------------------------------------------------------------

insert into public.sender_inboxes (org_id, email, display_name, daily_cap, enabled, weight, notes)
values
  ('5557189e-5c2d-4990-afad-6aa1861826cd',
   'jordan@premiumwaterau.com.au',
   'Jordan Marziale (Premium Water AU)',
   30, true, 1,
   'Warming on Instantly from 2026-05-03. Cap stays at 30 until day 14.'),
  ('5557189e-5c2d-4990-afad-6aa1861826cd',
   'jordan@jordanmarziale.com.au',
   'Jordan Marziale',
   30, true, 1,
   'Warming on Instantly from 2026-05-03. Cap stays at 30 until day 14.'),
  ('5557189e-5c2d-4990-afad-6aa1861826cd',
   'jordan@premiumwaterau.com',
   'Jordan Marziale (Premium Water AU - .com)',
   30, true, 1,
   'Warming on Instantly from 2026-05-04. Cap stays at 30 until day 14.'),
  ('5557189e-5c2d-4990-afad-6aa1861826cd',
   'jordan@jordanmarziale.com',
   'Jordan Marziale (.com)',
   30, true, 1,
   'Warming on Instantly from 2026-05-04. Cap stays at 30 until day 14.')
on conflict do nothing;
