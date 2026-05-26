-- =============================================================================
-- Fix: select_next_sender RPC pointing at wrong table.
-- =============================================================================
-- BUG: select_next_sender returned a row from `sender_inboxes` (legacy mirror
-- table). The frontend approve flow then wrote that id into
-- email_drafts.sender_inbox_id, which has FK -> email_accounts. The FK
-- rejected the insert and the approve flow surfaced as:
--
--   insert or update on table "email_drafts" violates foreign key constraint
--   "email_drafts_sender_inbox_id_fkey"
--
-- Reported by Jordan in LeadFlow WhatsApp group 26/05/2026 20:09 AEST after
-- editing + approving the Nero's Kitchen seed draft.
--
-- ROOT CAUSE: The May 19 native-sender migrations created `email_accounts` as
-- the canonical send-path table (read by send-via-smtp + drain-send-queue +
-- enqueue-sends). `sender_inboxes` was kept as a legacy mirror used only by
-- reputation tracking. But the original select_next_sender RPC (from a
-- pre-May 19 migration) was never updated to point at email_accounts.
--
-- FIX: Rewrite select_next_sender to read from email_accounts. Logic is
-- identical (org filter, daily cap, last_send_at round-robin) but uses
-- email_accounts.daily_send_cap and ea.status = 'active' instead of
-- sender_inboxes.daily_cap and si.enabled.
--
-- ALREADY APPLIED TO PROD: yes, via Management API at 26/05/2026 20:30 AEST
-- for immediate unblock. This migration brings the schema repo in sync.
--
-- FOLLOW-UP TODO (not in this PR): decide whether to drop sender_inboxes
-- entirely or formalise it as a read-only reputation table.
-- =============================================================================

DROP FUNCTION IF EXISTS public.select_next_sender(uuid);

CREATE OR REPLACE FUNCTION public.select_next_sender(p_org_id uuid)
RETURNS email_accounts
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  with today_bounds as (
    select ((now() at time zone 'Australia/Melbourne')::date)::timestamp at time zone 'Australia/Melbourne' as ts_start
  ),
  sent_today as (
    select d.sender_inbox_id, count(*)::int as sends_today
    from public.email_drafts d, today_bounds tb
    where d.status in ('queued','sent')
      and coalesce(d.sent_at, d.generated_at, d.created_at) >= tb.ts_start
    group by d.sender_inbox_id
  )
  select ea.*
  from public.email_accounts ea
  left join sent_today st on st.sender_inbox_id = ea.id
  where ea.org_id = p_org_id
    and ea.status = 'active'
    and coalesce(st.sends_today, 0) < ea.daily_send_cap
  order by ea.last_send_at asc nulls first, ea.id asc
  limit 1;
$function$;
