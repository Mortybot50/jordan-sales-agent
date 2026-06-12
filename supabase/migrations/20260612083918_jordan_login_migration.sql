-- =============================================================================
-- Login migration — demo@jordan-sales-agent.test  ->  jordan@purezza.com.au
-- Migration: 20260612083918_jordan_login_migration
-- =============================================================================
-- Jordan signs in as demo@jordan-sales-agent.test (a dead domain — a password
-- reset would strand him). jordan@purezza.com.au already exists in auth.users
-- (uid 027c0c4a-ea67-46ef-82ef-47fbd5d1df65, created 27/04) but has NO profile
-- row, so logging in with it lands on the "no profile" recovery screen.
--
-- KEY FACTS (verified live 12/06):
--   * public.users.id FKs to auth.users.id — a profile row's PK must be the
--     auth uid.
--   * EVERY SELECT RLS policy is org-scoped (org_id = auth_org_id()), even
--     email_accounts. So a profile in the same org sees ALL org data
--     immediately, with zero FK reassignment. Ownership columns are about
--     attribution, not visibility.
--
-- THEREFORE this migration:
--   1. Creates Jordan's profile (uid 027c0c4a) in org 5557189e, copying demo's
--      operational settings — he sees everything via org-RLS at once.
--   2. Transfers the 23 ownership/attribution columns demo -> jordan.
--
-- BOTH logins stay valid: demo's auth user AND its profile row are untouched,
-- and demo remains in the same org, so demo still sees all org data too. The
-- password/recovery for jordan@purezza is set out-of-band via the admin API
-- (a migration cannot write auth.users credentials). Fully reversible — swap
-- the two uids back.
-- =============================================================================

-- 1. Jordan's profile row (idempotent). Copy demo's operational fields; leave
--    calendly_* (parked) and public_slug (unique) null.
insert into public.users (
  id, org_id, full_name, email, role, icp_config, email_notifications,
  voice_rules, default_commission_pct, spam_act_sender_block, send_timezone,
  working_hours_start_local, working_hours_end_local,
  notify_whatsapp_e164, notify_warm_replies, notify_quiet_hours_start, notify_quiet_hours_end
)
select
  '027c0c4a-ea67-46ef-82ef-47fbd5d1df65'::uuid,
  d.org_id, 'Jordan Marziale', 'jordan@purezza.com.au', d.role, d.icp_config, d.email_notifications,
  d.voice_rules, d.default_commission_pct, d.spam_act_sender_block, d.send_timezone,
  d.working_hours_start_local, d.working_hours_end_local,
  d.notify_whatsapp_e164, d.notify_warm_replies, d.notify_quiet_hours_start, d.notify_quiet_hours_end
from public.users d
where d.id = '3b31e455-92c7-4507-8b4b-0e274c27009c'::uuid
on conflict (id) do nothing;

-- 2. Transfer ownership/attribution columns demo -> jordan (idempotent).
do $$
declare
  demo uuid := '3b31e455-92c7-4507-8b4b-0e274c27009c';
  jord uuid := '027c0c4a-ea67-46ef-82ef-47fbd5d1df65';
begin
  update public.briefing_sends            set user_id = jord            where user_id = demo;
  update public.claude_conversations      set user_id = jord            where user_id = demo;
  update public.deals                     set owner_user_id = jord      where owner_user_id = demo;
  update public.email_accounts            set user_id = jord            where user_id = demo;
  update public.email_drafts              set created_by = jord         where created_by = demo;
  update public.email_send_queue          set user_id = jord            where user_id = demo;
  update public.email_signature_templates set user_id = jord            where user_id = demo;
  update public.field_visits              set user_id = jord            where user_id = demo;
  update public.gmail_connections         set user_id = jord            where user_id = demo;
  update public.inbox_placement_seeds     set user_id = jord            where user_id = demo;
  -- lead_search_runs.triggered_by is text (stores the uuid as a string)
  update public.lead_search_runs          set triggered_by = jord::text where triggered_by = demo::text;
  update public.lead_searches             set user_id = jord            where user_id = demo;
  update public.learning_digests          set user_id = jord            where user_id = demo;
  update public.monthly_gates             set user_id = jord            where user_id = demo;
  update public.notification_log          set user_id = jord            where user_id = demo;
  update public.postmaster_grades         set user_id = jord            where user_id = demo;
  update public.route_days                set user_id = jord            where user_id = demo;
  update public.sending_domains           set user_id = jord            where user_id = demo;
  update public.sequence_enrollments      set enrolled_by_user_id = jord where enrolled_by_user_id = demo;
  update public.sequences                 set created_by_user_id = jord  where created_by_user_id = demo;
  update public.suppression_list          set added_by_user_id = jord    where added_by_user_id = demo;
  update public.venues                    set review_decided_by = jord   where review_decided_by = demo;
  -- oauth_state_nonces are short-lived CSRF tokens — not transferred.
end $$;
