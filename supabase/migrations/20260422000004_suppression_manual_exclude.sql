-- =============================================================================
-- Suppression List v1 — manual exclusions + domain suppression
-- Migration: 20260422000004_suppression_manual_exclude
-- =============================================================================
-- Extends the compliance-only suppression_list with manual entries Jordan can
-- add himself (single email, bulk paste, CSV, or whole-domain). All three
-- outbound surfaces (sequence enrolment, AI draft gen, morning briefing) must
-- check this table before sending.
-- =============================================================================

-- 1. Reason: allow 'manual_exclude' in addition to compliance reasons
alter table suppression_list
  drop constraint suppression_list_reason_check;

alter table suppression_list
  add constraint suppression_list_reason_check
  check (reason in (
    'bounce_hard',
    'bounce_soft',
    'unsubscribe',
    'spam_complaint',
    'manual_exclude'
  ));

-- 2. Source: allow 'manual_single', 'manual_bulk', 'manual_csv', 'manual_domain'
alter table suppression_list
  drop constraint suppression_list_source_check;

alter table suppression_list
  add constraint suppression_list_source_check
  check (source in (
    'sendgrid_webhook',
    'instantly_webhook',
    'manual',
    'manual_single',
    'manual_bulk',
    'manual_csv',
    'manual_domain'
  ));

-- 3. New columns
alter table suppression_list
  add column if not exists notes text,
  add column if not exists added_by_user_id uuid references auth.users(id) on delete set null,
  add column if not exists domain_suppression boolean not null default false;

-- 4. Allow email to store a bare domain when domain_suppression=true
--    Domains should not contain an '@' symbol; validate shape at app layer.
--    Drop the strict lower(email) check so we can also hold 'puretu.com'
--    entries — we still enforce lowercase in the app and via the check below.
alter table suppression_list
  drop constraint if exists suppression_list_email_check;

alter table suppression_list
  add constraint suppression_list_email_check
  check (email = lower(email));

-- 5. Index for fast domain-suppression lookups
create index if not exists suppression_list_domain_idx
  on suppression_list(org_id, email)
  where domain_suppression = true;

-- 6. Add DELETE policy (users can remove their own org's entries)
drop policy if exists "suppression_list_delete" on suppression_list;
create policy "suppression_list_delete" on suppression_list
  for delete using (org_id = auth_org_id());

-- 7. Add UPDATE policy (notes can be edited post-insert)
drop policy if exists "suppression_list_update" on suppression_list;
create policy "suppression_list_update" on suppression_list
  for update using (org_id = auth_org_id())
  with check (org_id = auth_org_id());
