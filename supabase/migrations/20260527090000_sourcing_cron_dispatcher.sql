-- =============================================================================
-- LeadFlow Sourcing — saved-search cron dispatcher
-- Migration: 20260527090000_sourcing_cron_dispatcher
-- =============================================================================
-- Two concerns, one migration:
--   1. lead_search_runs.triggered_by column ('manual' | 'cron') so the audit
--      trail records which path created a run. Default 'manual' so the
--      thousand-row legacy backfill is a no-op.
--   2. pg_cron schedule `leadflow-sourcing-cron` (every 5 min) that posts to
--      sourcing-cron-tick. Vault-sourced bearer token, same pattern as
--      enqueue-sends / drain-send-queue / publication-poll.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Add triggered_by column to lead_search_runs
-- ---------------------------------------------------------------------------

alter table lead_search_runs
  add column if not exists triggered_by text not null default 'manual';

alter table lead_search_runs
  drop constraint if exists lead_search_runs_triggered_by_check;

alter table lead_search_runs
  add constraint lead_search_runs_triggered_by_check
  check (triggered_by in ('manual', 'cron'));

create index if not exists idx_lead_search_runs_triggered_by
  on lead_search_runs(triggered_by);

-- ---------------------------------------------------------------------------
-- 2. Pre-flight: vault.secrets must already contain 'service_role_key'.
--    Same guard as 20260519000005 — keys never live in source-controlled SQL.
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
-- 3. Unschedule any stale version, then schedule fresh.
-- ---------------------------------------------------------------------------

do $$ begin
  perform cron.unschedule(jobid) from cron.job
   where jobname = 'leadflow-sourcing-cron';
exception when others then null;
end $$;

select cron.schedule(
  'leadflow-sourcing-cron',
  '*/5 * * * *',
  $cron$
    select net.http_post(
      url     := 'https://bsevgxhnxlkzkcalevbb.supabase.co/functions/v1/sourcing-cron-tick',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || (
          select decrypted_secret from vault.decrypted_secrets
           where name = 'service_role_key' limit 1
        )
      ),
      body    := '{}'::jsonb
    );
  $cron$
);

-- ---------------------------------------------------------------------------
-- 4. Probes
-- ---------------------------------------------------------------------------

do $$
declare
  n int;
begin
  -- Cron job exists
  select count(*) into n from cron.job where jobname = 'leadflow-sourcing-cron';
  if n <> 1 then
    raise exception 'expected exactly 1 leadflow-sourcing-cron job, found %', n;
  end if;

  -- Column landed
  perform 1 from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'lead_search_runs'
      and column_name  = 'triggered_by';
  if not found then
    raise exception 'lead_search_runs.triggered_by column missing after migration';
  end if;
end $$;
