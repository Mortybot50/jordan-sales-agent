-- =============================================================================
-- Cleanup: drop legacy `sender_inboxes` table.
-- Migration: 20260526200000_drop_sender_inboxes
-- =============================================================================
-- Context
-- -------
-- `sender_inboxes` was created by 20260504000001_pre_coldsend_essentials as
-- the per-org sender pool for the pre-Instantly-replacement cold-send path.
-- The May 19 native-sender migrations (20260519000001 onwards) introduced
-- `email_accounts` as the canonical send-path table, owning:
--   - SMTP credentials (encrypted)
--   - daily_send_cap (replaces sender_inboxes.daily_cap)
--   - status (replaces sender_inboxes.enabled)
--   - last_send_at, reputation_score, brand, icp_segment
--
-- 20260519000007 repointed `email_drafts.sender_inbox_id`'s FK from
-- `sender_inboxes(id)` -> `email_accounts(id)`. The column name was kept
-- to avoid a frontend rename churn but the target table changed.
--
-- 20260526100500 (PR #80) rewrote `select_next_sender()` to read from
-- `email_accounts` after a prod FK violation surfaced from Jordan's approve
-- flow. That was the last reader of `sender_inboxes`.
--
-- Audit findings (26/05/2026, this PR)
-- -----------------------------------
-- Readers of `sender_inboxes`:
--   - Edge Functions: 0 (PR #80 removed the last one).
--   - Frontend (src/): 0. Only the generated type def in
--     src/types/database.ts; not referenced by application code.
--   - DB functions: 0 (`select pg_proc.prosrc ilike '%sender_inboxes%'` empty).
--   - Views: 0.
--   - pg_cron jobs: 0.
--
-- Writers of `sender_inboxes`:
--   - Edge Functions: 1. `drain-send-queue` mirrored `last_send_at` after
--     each successful send. This PR removes that block; no other writers.
--
-- FKs targeting `sender_inboxes`:
--   - 0. The only FK ever pointing here (`email_drafts.sender_inbox_id`)
--     was repointed to `email_accounts` on 19/05.
--
-- Reputation tracking dependency:
--   - None. `compute_inbox_reputation(p_account_id uuid)` reads from
--     `email_send_events`; the function takes an `email_accounts.id` and
--     the hourly `leadflow-reputation-refresh` cron updates
--     `email_accounts.reputation_score` directly. `sender_inboxes` is not
--     touched anywhere in the reputation path.
--
-- Warmup dependency:
--   - None. `warmup_threads.sender_account_id` references
--     `email_accounts(id)` (20260519000003).
--
-- Data inventory (live, project bsevgxhnxlkzkcalevbb, 26/05/2026):
--   - sender_inboxes: 4 rows, all duplicates by `lower(email)` of rows in
--     email_accounts (same 4 Jordan-warming inboxes).
--   - Only 1 of the 4 rows has a non-null `last_send_at` (2026-05-21).
--   - No unique business data lives here; every column has a counterpart
--     on email_accounts (daily_cap -> daily_send_cap, enabled=true ->
--     status='active', etc.).
--   - email_drafts rows with sender_inbox_id NOT NULL: 4. All 4 already
--     reference email_accounts(id), 0 reference sender_inboxes(id).
--
-- Decision
-- --------
-- Option A: DROP TABLE. Zero readers post-PR #80, zero FK dependants, the
-- single legacy writer (drain-send-queue mirror) is removed in the same PR,
-- and all business data has a canonical home on email_accounts.
--
-- Reversibility
-- -------------
-- Schema reversal: re-run the relevant block of 20260504000001 (the table
-- DDL, indexes, RLS policies, updated_at trigger). The DDL is preserved in
-- that migration; this drop does not delete history.
--
-- Data reversal: irreversible by design — the 4 rows are duplicates of
-- email_accounts and would be reseeded from there. No application
-- depends on the lost `created_at`/`notes` text on the legacy rows.
-- =============================================================================

begin;

-- Guardrails. Refuse to drop if anything has crept back in since the audit:
--   1. Any inbound FK targeting sender_inboxes (would break referential
--      integrity on drop).
--   2. Any draft row whose sender_inbox_id resolves to a sender_inboxes row
--      but NOT an email_accounts row (would orphan after drop).
do $$
declare
  v_inbound_fks int;
  v_orphan_drafts int;
begin
  select count(*) into v_inbound_fks
    from pg_constraint c
   where c.contype = 'f'
     and c.confrelid = 'public.sender_inboxes'::regclass;
  if v_inbound_fks > 0 then
    raise exception
      'refusing to drop sender_inboxes: % inbound FK constraint(s) still target it. '
      'Audit those references first.', v_inbound_fks;
  end if;

  select count(*) into v_orphan_drafts
    from public.email_drafts d
   where d.sender_inbox_id is not null
     and exists (select 1 from public.sender_inboxes si where si.id = d.sender_inbox_id)
     and not exists (select 1 from public.email_accounts ea where ea.id = d.sender_inbox_id);
  if v_orphan_drafts > 0 then
    raise exception
      'refusing to drop sender_inboxes: % email_drafts row(s) reference a '
      'sender_inboxes id with no matching email_accounts row. Reconcile first.',
      v_orphan_drafts;
  end if;
end $$;

-- Drop the table. The associated indexes (sender_inboxes_org_email_uidx,
-- sender_inboxes_org_enabled_idx), the RLS policies, the
-- set_sender_inboxes_updated_at trigger, and the sender_inboxes_org_id_fkey
-- outbound FK are all dropped automatically with the table.
drop table if exists public.sender_inboxes;

-- Post-drop probe: confirm the table is gone.
do $$
begin
  if exists (
    select 1 from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'sender_inboxes' and c.relkind = 'r'
  ) then
    raise exception 'sender_inboxes still exists after DROP';
  end if;
end $$;

commit;
