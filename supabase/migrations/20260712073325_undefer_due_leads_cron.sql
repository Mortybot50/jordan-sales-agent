-- =============================================================================
-- Leads inbox — return deferred venues to the inbox once their timer elapses.
-- Migration: 20260712073325_undefer_due_leads_cron
-- =============================================================================
-- Bug closed: useDeferLead sets review_status='deferred' + review_defer_until,
-- and the success toast promises the venue "will return to the inbox
-- automatically" — but nothing ever flipped it back, so deferred venues
-- vanished permanently (the inbox only queries review_status='pending').
--
-- This installs:
--   1. public.undefer_due_leads() — flips every 'deferred' venue whose
--      review_defer_until is due back to 'pending' and clears the timer.
--      Returns the number of rows flipped (so the daily cron logs a count,
--      and the smoke test can invoke it directly).
--   2. A daily pg_cron job 'leadflow-undefer-leads' that runs it.
--
-- Scope: ONLY the deferred-return logic. Touches nothing else.
-- Idempotent: create-or-replace + unschedule-before-schedule; safe to replay.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. The un-defer function.
--    SECURITY DEFINER + SET search_path = '' per Supabase advisor guidance;
--    every object is therefore schema-qualified.
-- ---------------------------------------------------------------------------
create or replace function public.undefer_due_leads()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.venues
     set review_status      = 'pending',
         review_defer_until = null
   where review_status      = 'deferred'
     and review_defer_until is not null
     and review_defer_until <= now();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.undefer_due_leads() from public;
grant execute on function public.undefer_due_leads() to service_role;

comment on function public.undefer_due_leads() is
  'Returns deferred venues to the leads inbox: flips review_status deferred→pending '
  'and clears review_defer_until for every venue whose defer timer is due. '
  'Returns the row count flipped. Driven daily by the leadflow-undefer-leads cron.';

-- ---------------------------------------------------------------------------
-- 2. Daily schedule (02:15 UTC ≈ 12:15 AEST). Unschedule-first for idempotency.
-- ---------------------------------------------------------------------------
do $$ begin
  perform cron.unschedule(jobid) from cron.job
   where jobname = 'leadflow-undefer-leads';
exception when others then null;
end $$;

select cron.schedule(
  'leadflow-undefer-leads',
  '15 2 * * *',
  $cron$ select public.undefer_due_leads(); $cron$
);

-- Probe: the schedule is live.
do $$
declare n int;
begin
  select count(*) into n from cron.job where jobname = 'leadflow-undefer-leads';
  if n <> 1 then
    raise exception 'expected 1 leadflow-undefer-leads schedule, found %', n;
  end if;
end $$;
