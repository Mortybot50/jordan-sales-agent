-- =============================================================================
-- LeadFlow Jordan Sales Agent — Row Level Security Policies
-- Migration: 20260421000002_rls_policies
-- =============================================================================
-- Pattern: org_id = (auth.jwt() ->> 'org_id')::uuid
-- All user-facing queries use the anon/authed key — RLS enforced.
-- Service-role key (Edge Functions / background workers) bypasses RLS.
-- =============================================================================

-- Helper: extract org_id from JWT
-- The org_id is injected into the JWT via a Supabase auth hook (Week 2)
-- TODO(week-2): Configure auth hook to add org_id to JWT claims
-- For now, we also check users table as fallback
create or replace function auth_org_id() returns uuid
language sql stable
as $$
  select coalesce(
    (auth.jwt() ->> 'org_id')::uuid,
    (select org_id from public.users where id = auth.uid())
  );
$$;

-- =============================================================================
-- ORGS
-- =============================================================================
alter table orgs enable row level security;

create policy "orgs_select" on orgs
  for select using (id = auth_org_id());

create policy "orgs_update" on orgs
  for update using (id = auth_org_id())
  with check (id = auth_org_id());

-- No insert/delete from user side — created by trigger on signup

-- =============================================================================
-- USERS
-- =============================================================================
alter table users enable row level security;

create policy "users_select" on users
  for select using (org_id = auth_org_id());

create policy "users_update" on users
  for update using (id = auth.uid())
  with check (id = auth.uid());

-- =============================================================================
-- VENUES
-- =============================================================================
alter table venues enable row level security;

create policy "venues_select" on venues
  for select using (org_id = auth_org_id());

create policy "venues_insert" on venues
  for insert with check (org_id = auth_org_id());

create policy "venues_update" on venues
  for update using (org_id = auth_org_id())
  with check (org_id = auth_org_id());

create policy "venues_delete" on venues
  for delete using (org_id = auth_org_id());

-- =============================================================================
-- CONTACTS
-- =============================================================================
alter table contacts enable row level security;

create policy "contacts_select" on contacts
  for select using (org_id = auth_org_id());

create policy "contacts_insert" on contacts
  for insert with check (org_id = auth_org_id());

create policy "contacts_update" on contacts
  for update using (org_id = auth_org_id())
  with check (org_id = auth_org_id());

create policy "contacts_delete" on contacts
  for delete using (org_id = auth_org_id());

-- =============================================================================
-- PIPELINE STAGES
-- =============================================================================
alter table pipeline_stages enable row level security;

create policy "pipeline_stages_select" on pipeline_stages
  for select using (org_id = auth_org_id());

create policy "pipeline_stages_insert" on pipeline_stages
  for insert with check (org_id = auth_org_id());

create policy "pipeline_stages_update" on pipeline_stages
  for update using (org_id = auth_org_id())
  with check (org_id = auth_org_id());

create policy "pipeline_stages_delete" on pipeline_stages
  for delete using (org_id = auth_org_id());

-- =============================================================================
-- DEALS
-- =============================================================================
alter table deals enable row level security;

create policy "deals_select" on deals
  for select using (org_id = auth_org_id());

create policy "deals_insert" on deals
  for insert with check (org_id = auth_org_id());

create policy "deals_update" on deals
  for update using (org_id = auth_org_id())
  with check (org_id = auth_org_id());

create policy "deals_delete" on deals
  for delete using (org_id = auth_org_id());

-- =============================================================================
-- ACTIVITIES
-- =============================================================================
alter table activities enable row level security;

create policy "activities_select" on activities
  for select using (org_id = auth_org_id());

create policy "activities_insert" on activities
  for insert with check (org_id = auth_org_id());

-- Activities are append-only from user side — no update/delete

-- =============================================================================
-- SEQUENCES
-- =============================================================================
alter table sequences enable row level security;

create policy "sequences_select" on sequences
  for select using (org_id = auth_org_id());

create policy "sequences_insert" on sequences
  for insert with check (org_id = auth_org_id());

create policy "sequences_update" on sequences
  for update using (org_id = auth_org_id())
  with check (org_id = auth_org_id());

create policy "sequences_delete" on sequences
  for delete using (org_id = auth_org_id());

-- =============================================================================
-- SEQUENCE STEPS
-- =============================================================================
alter table sequence_steps enable row level security;

create policy "sequence_steps_select" on sequence_steps
  for select using (org_id = auth_org_id());

create policy "sequence_steps_insert" on sequence_steps
  for insert with check (org_id = auth_org_id());

create policy "sequence_steps_update" on sequence_steps
  for update using (org_id = auth_org_id())
  with check (org_id = auth_org_id());

create policy "sequence_steps_delete" on sequence_steps
  for delete using (org_id = auth_org_id());

-- =============================================================================
-- SEQUENCE ENROLLMENTS
-- =============================================================================
alter table sequence_enrollments enable row level security;

create policy "sequence_enrollments_select" on sequence_enrollments
  for select using (org_id = auth_org_id());

create policy "sequence_enrollments_insert" on sequence_enrollments
  for insert with check (org_id = auth_org_id());

create policy "sequence_enrollments_update" on sequence_enrollments
  for update using (org_id = auth_org_id())
  with check (org_id = auth_org_id());

-- =============================================================================
-- TASKS
-- =============================================================================
alter table tasks enable row level security;

create policy "tasks_select" on tasks
  for select using (org_id = auth_org_id());

create policy "tasks_insert" on tasks
  for insert with check (org_id = auth_org_id());

create policy "tasks_update" on tasks
  for update using (org_id = auth_org_id())
  with check (org_id = auth_org_id());

create policy "tasks_delete" on tasks
  for delete using (org_id = auth_org_id());

-- =============================================================================
-- LEAD SCORES
-- =============================================================================
alter table lead_scores enable row level security;

create policy "lead_scores_select" on lead_scores
  for select using (org_id = auth_org_id());

-- Insert only from service-role (scoring worker) — no user insert policy

-- =============================================================================
-- SIGNALS
-- =============================================================================
alter table signals enable row level security;

create policy "signals_select" on signals
  for select using (org_id = auth_org_id());

create policy "signals_update" on signals
  for update using (org_id = auth_org_id())
  with check (org_id = auth_org_id());

-- Insert only from service-role (signal workers) — no user insert policy

-- =============================================================================
-- AUTO-SOURCED CANDIDATES
-- =============================================================================
alter table auto_sourced_candidates enable row level security;

create policy "auto_sourced_candidates_select" on auto_sourced_candidates
  for select using (org_id = auth_org_id());

create policy "auto_sourced_candidates_update" on auto_sourced_candidates
  for update using (org_id = auth_org_id())
  with check (org_id = auth_org_id());

-- Insert only from service-role (sourcing worker)

-- =============================================================================
-- EMAIL DRAFTS
-- =============================================================================
alter table email_drafts enable row level security;

create policy "email_drafts_select" on email_drafts
  for select using (org_id = auth_org_id());

create policy "email_drafts_update" on email_drafts
  for update using (org_id = auth_org_id())
  with check (org_id = auth_org_id());

-- Insert only from service-role (AI draft generation worker)

-- =============================================================================
-- DRAFT EDITS
-- =============================================================================
alter table draft_edits enable row level security;

create policy "draft_edits_select" on draft_edits
  for select using (org_id = auth_org_id());

create policy "draft_edits_insert" on draft_edits
  for insert with check (org_id = auth_org_id());

-- =============================================================================
-- SUPPRESSION LIST
-- =============================================================================
alter table suppression_list enable row level security;

create policy "suppression_list_select" on suppression_list
  for select using (org_id = auth_org_id());

create policy "suppression_list_insert" on suppression_list
  for insert with check (org_id = auth_org_id());

-- =============================================================================
-- WORKER RUNS (read-only from user side — Morty's /admin/workers page)
-- =============================================================================
alter table worker_runs enable row level security;

create policy "worker_runs_select" on worker_runs
  for select using (org_id = auth_org_id() or org_id is null);

-- Insert/update from service-role only (workers themselves)

-- =============================================================================
-- CALENDLY EVENTS
-- =============================================================================
alter table calendly_events enable row level security;

create policy "calendly_events_select" on calendly_events
  for select using (org_id = auth_org_id());

-- Insert from service-role only (webhook handler)
