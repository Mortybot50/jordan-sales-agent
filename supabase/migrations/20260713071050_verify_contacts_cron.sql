-- =============================================================================
-- LeadFlow Sourcing — verify-contacts (ZeroBounce) cron drainer
-- Migration: 20260713071050_verify_contacts_cron
-- =============================================================================
-- Closes the gap where every discovered contact sat at verification_status=
-- 'pending' forever: the ZEROBOUNCE_API_KEY was set as a Supabase secret but
-- nothing ever called ZeroBounce. Every 10 minutes this fires a fire-and-forget
-- POST to the verify-contacts Edge Function, which drains up to 100 pending
-- contacts per tick (best email_tier first), calls ZeroBounce validatebatch,
-- and writes back verification_status / verified_at / catch_all_flag.
--
-- IMPORTANT: verifying a contact NEVER makes it auto-sendable. Outreach stays
-- behind the human approve-lead gate. This cron only fills in the verification
-- verdict so the approve gate has real data to filter on.
--
-- Auth: vault.decrypted_secrets name='service_role_key' (same pattern as
-- 20260524160000_crawl_venue_contacts_cron.sql). Vault row is already seeded on
-- prod — DO NOT add the key from inside this migration.
--
-- Idempotent: cron.unschedule + cron.schedule shape, safe to re-run.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0. Pre-flight: vault.secrets must contain 'service_role_key'.
-- ---------------------------------------------------------------------------
do $$
declare n int;
begin
  select count(*) into n from vault.secrets where name = 'service_role_key';
  if n < 1 then
    raise exception
      'vault.secrets is missing the service_role_key entry. Seed it once via '
      'select vault.create_secret(''<service_role_jwt>'', ''service_role_key'', '
      '''LeadFlow cron auth''); then re-run this migration.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Drainer function: fire one async http_post to verify-contacts. The Edge
--    Function does the batching (pulls the pending backlog, best tier first,
--    excludes contacts on rejected venues) so this stays a thin trigger.
-- ---------------------------------------------------------------------------
create or replace function public.leadflow_drain_verify_queue()
returns void
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  bearer text;
begin
  select decrypted_secret into bearer
    from vault.decrypted_secrets
   where name = 'service_role_key'
   limit 1;

  if bearer is null then
    raise warning 'leadflow_drain_verify_queue: no service_role_key in vault — skipping tick';
    return;
  end if;

  perform net.http_post(
    url     := 'https://bsevgxhnxlkzkcalevbb.supabase.co/functions/v1/verify-contacts',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || bearer
    ),
    body    := jsonb_build_object('limit', 100)
  );
end;
$$;

revoke all on function public.leadflow_drain_verify_queue() from public;

comment on function public.leadflow_drain_verify_queue() is
  'Fires one async POST to the verify-contacts Edge Function, which drains the '
  'pending email-verification backlog through ZeroBounce. Driven every 10 min by '
  'the leadflow-verify-contacts cron. Never enrols or sends — verification only.';

-- ---------------------------------------------------------------------------
-- 2. Unschedule any prior copy, then re-schedule fresh (every 10 min).
-- ---------------------------------------------------------------------------
do $$ begin
  perform cron.unschedule(jobid) from cron.job
   where jobname = 'leadflow-verify-contacts';
exception when others then null;
end $$;

select cron.schedule(
  'leadflow-verify-contacts',
  '*/10 * * * *',
  $cron$ select public.leadflow_drain_verify_queue(); $cron$
);

-- ---------------------------------------------------------------------------
-- 3. Probe: schedule lives.
-- ---------------------------------------------------------------------------
do $$
declare n int;
begin
  select count(*) into n from cron.job where jobname = 'leadflow-verify-contacts';
  if n < 1 then raise exception 'leadflow-verify-contacts schedule not registered'; end if;
end $$;
