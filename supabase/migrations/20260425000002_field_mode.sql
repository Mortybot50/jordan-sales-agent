-- =============================================================================
-- LeadFlow Jordan Sales Agent — Field Mode + Voice Notes
-- Migration: 20260425000002_field_mode
-- =============================================================================
-- Adds geocoding columns to contacts + venue_observations, a field_visits
-- table for drop-in / day-trip workflow, and a voice-notes Storage bucket
-- with per-user RLS. Activity-feed integration via trigger.
--
-- Multi-tenant from day 1 — org_id on every row, full RLS via auth_org_id().
-- =============================================================================

-- ---------------------------------------------------------------------------
-- CONTACTS — geocoding + visit tracking
-- ---------------------------------------------------------------------------

alter table contacts
  add column if not exists lat              double precision,
  add column if not exists lng              double precision,
  add column if not exists geocoded_at      timestamptz,
  add column if not exists last_visited_at  timestamptz;

create index if not exists contacts_lat_lng_idx
  on contacts (org_id) where lat is not null and lng is not null;

-- ---------------------------------------------------------------------------
-- VENUE OBSERVATIONS — geocoding (so reopening pins drop on the field map)
-- ---------------------------------------------------------------------------

alter table venue_observations
  add column if not exists lat         double precision,
  add column if not exists lng         double precision,
  add column if not exists geocoded_at timestamptz;

-- ---------------------------------------------------------------------------
-- ACTIVITIES — extend CHECK constraint to include field_visit + voice_note
-- ---------------------------------------------------------------------------

alter table activities drop constraint if exists activities_activity_type_check;
alter table activities add constraint activities_activity_type_check
  check (activity_type in (
    'email_sent','email_opened','email_clicked','reply_received',
    'call_note','meeting_note','task_completed','stage_change',
    'bounce','unsubscribe',
    'email_inbound','email_outbound','deal_created','note',
    'meeting_booked','email_manual',
    'field_visit','voice_note'
  ));

-- ---------------------------------------------------------------------------
-- FIELD VISITS — Jordan's drop-in record at a contact / reopening venue
-- ---------------------------------------------------------------------------

create table field_visits (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references orgs(id) on delete cascade,
  user_id               uuid not null references auth.users(id) on delete cascade,
  contact_id            uuid references contacts(id) on delete set null,
  venue_observation_id  uuid references venue_observations(id) on delete set null,
  outcome               text not null check (outcome in (
    'interested','not_now','closed','not_in','dm_absent','other'
  )),
  notes                 text,
  voice_transcript      text,
  voice_audio_path      text,
  lat                   double precision,
  lng                   double precision,
  visited_at            timestamptz not null default now(),
  created_at            timestamptz not null default now()
);

create index field_visits_org_user_visited_idx
  on field_visits (org_id, user_id, visited_at desc);

create index field_visits_contact_idx
  on field_visits (contact_id) where contact_id is not null;

alter table field_visits enable row level security;

create policy "field_visits_select" on field_visits
  for select using (org_id = auth_org_id());

create policy "field_visits_insert" on field_visits
  for insert with check (org_id = auth_org_id() and user_id = auth.uid());

create policy "field_visits_update" on field_visits
  for update using (org_id = auth_org_id() and user_id = auth.uid())
  with check (org_id = auth_org_id() and user_id = auth.uid());

create policy "field_visits_delete" on field_visits
  for delete using (org_id = auth_org_id() and user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- TRIGGER — mirror field_visits insert into the activity feed
-- ---------------------------------------------------------------------------

create or replace function handle_field_visit_insert()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  v_deal_id uuid;
  v_outcome_label text;
  v_notes_truncated text;
  v_body text;
begin
  -- Find a linked deal for this contact (most recent), so the activity
  -- threads with the rest of the deal timeline.
  if new.contact_id is not null then
    select id into v_deal_id
    from public.deals
    where contact_id = new.contact_id
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
    new.contact_id,
    'field_visit',
    'Field visit: ' || v_outcome_label,
    v_body,
    jsonb_build_object(
      'field_visit_id', new.id,
      'outcome', new.outcome,
      'lat', new.lat,
      'lng', new.lng,
      'voice_audio_path', new.voice_audio_path
    ),
    new.visited_at
  );

  -- Bump the contact's last_visited_at
  if new.contact_id is not null then
    update public.contacts
       set last_visited_at = new.visited_at,
           updated_at = now()
     where id = new.contact_id
       and org_id = new.org_id;
  end if;

  return new;
end;
$$;

create trigger field_visits_to_activity
  after insert on field_visits
  for each row execute procedure handle_field_visit_insert();

-- ---------------------------------------------------------------------------
-- STORAGE BUCKET — voice-notes (private, per-user folder)
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('voice-notes', 'voice-notes', false)
on conflict (id) do nothing;

-- Storage RLS: users may read/write only files under their own user_id folder.
-- Path convention: {user_id}/{uuid}.webm
create policy "voice_notes_select_own" on storage.objects
  for select using (
    bucket_id = 'voice-notes'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "voice_notes_insert_own" on storage.objects
  for insert with check (
    bucket_id = 'voice-notes'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "voice_notes_delete_own" on storage.objects
  for delete using (
    bucket_id = 'voice-notes'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
