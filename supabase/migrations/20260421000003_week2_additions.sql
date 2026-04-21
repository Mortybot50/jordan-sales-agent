-- =============================================================================
-- LeadFlow Jordan Sales Agent — Week 2 Additions
-- Migration: 20260421000003_week2_additions
-- =============================================================================

-- 1. Fix auth_org_id() — add SECURITY DEFINER so the fallback users query
--    runs as the function owner (bypassing RLS), preventing infinite recursion.
create or replace function auth_org_id() returns uuid
language sql stable
security definer
set search_path = public
as $$
  select coalesce(
    (auth.jwt() ->> 'org_id')::uuid,
    (select org_id from public.users where id = auth.uid())
  );
$$;

-- 2. Custom access token hook — injects org_id into JWT for efficient RLS.
--    IMPORTANT: After applying this migration, enable this hook in Supabase Dashboard:
--    Authentication → Hooks → Custom Access Token Hook → select function: public.custom_access_token_hook
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  user_org_id uuid;
begin
  select org_id into user_org_id
  from public.users
  where id = (event->>'user_id')::uuid;

  if user_org_id is not null then
    event := jsonb_set(event, '{claims,org_id}', to_jsonb(user_org_id::text));
  end if;

  return event;
end;
$$;

-- Grant execute to supabase_auth_admin (required for auth hooks)
grant execute on function public.custom_access_token_hook to supabase_auth_admin;
grant execute on function public.auth_org_id to authenticated;
grant execute on function public.auth_org_id to anon;

-- 3. Add profile columns to users table
alter table users
  add column if not exists icp_config jsonb default '{}',
  add column if not exists calendly_url text,
  add column if not exists email_signature text;

-- 4. Expand activities.activity_type to include Week 2 types
alter table activities drop constraint if exists activities_activity_type_check;
alter table activities add constraint activities_activity_type_check
  check (activity_type = any (array[
    'email_sent', 'email_opened', 'email_clicked', 'reply_received',
    'call_note', 'meeting_note', 'task_completed', 'stage_change',
    'bounce', 'unsubscribe',
    'email_inbound', 'email_outbound', 'deal_created', 'note', 'meeting_booked'
  ]));

-- 5. Expand venues.venue_type to include additional types used in CSV import
alter table venues drop constraint if exists venues_venue_type_check;
alter table venues add constraint venues_venue_type_check
  check (venue_type = any (array[
    'restaurant', 'cafe', 'hotel', 'event_space', 'bar', 'club', 'pub',
    'qsr', 'function_centre', 'other'
  ]));

-- 6. Indexes for performance
create index if not exists contacts_org_id_email_idx
  on contacts(org_id, email);

create index if not exists activities_contact_id_occurred_at_idx
  on activities(contact_id, occurred_at desc);

create index if not exists deals_stage_id_org_id_idx
  on deals(stage_id, org_id);

create index if not exists tasks_due_at_completed_idx
  on tasks(due_at, completed_at) where completed_at is null;

create index if not exists auto_sourced_candidates_status_created_idx
  on auto_sourced_candidates(org_id, status, created_at desc);
