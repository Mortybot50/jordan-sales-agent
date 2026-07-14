-- =============================================================================
-- LeadFlow — route no-email venues into the Call Cycle: collected_email outcome
-- Migration: 20260714055622_field_visit_collected_email_outcome
-- =============================================================================
-- Additive. Widens the field_visits.outcome CHECK to add 'collected_email' (a
-- strict superset of the prior set — safe) and teaches the activity-threading
-- trigger the new label. No deletions, no RLS/permission changes.
--
-- Why: when Jordan walks into a no-email venue and comes away with a real email
-- address, that visit outcome is 'collected_email'. The API layer then creates
-- a contact (verification_status='pending', the default) which the existing
-- verify-contacts cron picks up → ZeroBounce → the normal verify→draft→send
-- pipeline. This migration only widens the vocabulary + label; the loop-back
-- itself is done in api/route/mark-visited.ts using existing infra. The human
-- send gate is untouched: a collected email is NEVER auto-sent.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Widen the outcome CHECK (superset of the existing 6 values).
-- ---------------------------------------------------------------------------
alter table public.field_visits drop constraint if exists field_visits_outcome_check;
alter table public.field_visits add constraint field_visits_outcome_check
  check (outcome = any (array[
    'interested', 'not_now', 'closed', 'not_in', 'dm_absent', 'other',
    'collected_email'
  ]));

-- ---------------------------------------------------------------------------
-- 2. handle_field_visit_insert — add the 'collected_email' label case.
--    Full function re-declared (create or replace); only the CASE gains one arm.
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
    when 'interested'      then 'Interested'
    when 'not_now'         then 'Not now'
    when 'closed'          then 'Closed/quiet'
    when 'not_in'          then 'Not in'
    when 'dm_absent'       then 'DM absent'
    when 'collected_email' then 'Email collected'
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

-- ---------------------------------------------------------------------------
-- 3. Probe: the new value is accepted by the constraint.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.field_visits'::regclass
       and conname = 'field_visits_outcome_check'
       and pg_get_constraintdef(oid) like '%collected_email%'
  ) then
    raise exception 'field_visits_outcome_check does not include collected_email';
  end if;
end $$;
