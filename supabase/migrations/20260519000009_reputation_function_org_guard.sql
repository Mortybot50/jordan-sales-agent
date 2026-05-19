-- =============================================================================
-- LeadFlow native sender — Week 3 P0 follow-up.
-- Migration: 20260519000009_reputation_function_org_guard
-- =============================================================================
-- Codex review (Pattern B) flagged `compute_inbox_reputation` as a SECURITY
-- DEFINER function readable by any authenticated user. Without an org guard,
-- a logged-in user from org A could enumerate account UUIDs for org B and
-- infer aggregate send / reply / bounce / complaint counts.
--
-- Fix: redeclare the function with an org-membership check up-front. If the
-- caller is not service_role and not a member of the account's org, return
-- null (which the hourly cron treats as "skip" since it still passes
-- service_role at write time).
-- =============================================================================

create or replace function public.compute_inbox_reputation(p_account_id uuid)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_account_org uuid;
  v_caller_org  uuid;
  v_sent       int;
  v_bounced    int;
  v_replied    int;
  v_complained int;
  v_score      numeric;
begin
  -- Resolve the account's org.
  select org_id into v_account_org
  from public.email_accounts
  where id = p_account_id;

  if v_account_org is null then
    return null;
  end if;

  -- Bypass cases (no caller-scope check):
  --   1. service_role HTTP caller (Edge Functions / REST API w/ service key)
  --   2. direct-SQL caller WITHOUT an end-user JWT context (pg_cron job,
  --      psql session, migration). These run as the cron role and have NO
  --      `request.jwt.claim.role` setting AND NO `request.jwt.claim.sub` —
  --      `auth.uid()` returns null. We detect that and treat them as trusted.
  --
  -- For authenticated end-user callers (Supabase Auth JWT), require an
  -- org-membership match against the account's org.
  if current_setting('request.jwt.claim.role', true) is distinct from 'service_role'
     and auth.uid() is not null
  then
    v_caller_org := public.auth_org_id();
    if v_caller_org is null or v_caller_org <> v_account_org then
      return null;
    end if;
  end if;

  select
    count(*) filter (where event_type = 'sent'),
    count(*) filter (where event_type = 'bounced'),
    count(*) filter (where event_type = 'replied'),
    count(*) filter (where event_type = 'spam_complaint')
  into v_sent, v_bounced, v_replied, v_complained
  from public.email_send_events
  where email_account_id = p_account_id
    and event_at > now() - interval '14 days';

  if v_sent < 10 then
    return 50.0;
  end if;

  v_score := 100.0
    - (v_bounced::numeric    / v_sent * 100.0 *  5.0)
    - (v_complained::numeric / v_sent * 100.0 * 20.0)
    + least(v_replied::numeric / v_sent * 100.0, 25.0);

  return greatest(0.0, least(100.0, round(v_score, 1)));
end $$;

comment on function public.compute_inbox_reputation(uuid) is
  'Deterministic inbox reputation 0-100 (last 14 days of email_send_events). '
  'Returns 50 if < 10 sends. Bounce x5, complaint x20, reply +25 cap. '
  'Org-guarded: callers not in the account org get null (service_role bypasses).';
