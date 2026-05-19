-- =============================================================================
-- LeadFlow native sender — Week 2 P0 hotfix: cron auth via vault.
-- Migration: 20260519000005_fix_cron_auth_via_vault
-- =============================================================================
-- The Week 2 cron schedules in 20260519000004_pgcron_schedules.sql used
--   'Bearer ' || current_setting('app.settings.service_role_key', true)
-- which silently expanded to 'Bearer ' (empty) when the GUC was never set via
--   ALTER DATABASE postgres SET app.settings.service_role_key = '...'
-- The bootstrap step was missed on prod; every cron tick since 18/05 has been
-- silently 401-ing at the function-side auth gate. See
-- /tmp/gstack-leadflow-week2-test-gate-73465.log for the full diagnosis.
--
-- Fix: read the service role key from vault.decrypted_secrets, which is the
-- documented, key-rotation-friendly secret store. The vault row
-- name='service_role_key' is seeded out-of-band (already present on prod as
-- of 19/05 — see probe below). Any future rotation lands in vault, the cron
-- picks it up automatically next tick.
--
-- This migration is reversion-safe: re-running it is idempotent because
-- cron.unschedule + cron.schedule are themselves idempotent in this shape.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0. Pre-flight: vault.secrets must already contain 'service_role_key'.
--    DO NOT seed the key from inside a migration — keys must never live in
--    source-controlled SQL. Fail loudly if it's missing; the human operator
--    seeds it via `vault.create_secret('<key>', 'service_role_key', ...)`
--    before re-running.
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
-- 1. Unschedule the existing leadflow-* cron jobs. Wrapped in EXCEPTION so a
--    fresh DB (no prior jobs) doesn't blow up.
-- ---------------------------------------------------------------------------
do $$ begin
  perform cron.unschedule(jobid) from cron.job
   where jobname in (
     'leadflow-enqueue-sends',
     'leadflow-drain-queue',
     'leadflow-process-bounces'
   );
exception when others then null;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Re-schedule with vault-sourced bearer token.
--    Each command pulls decrypted_secret inline so a vault rotation takes
--    effect immediately on the next tick (no schedule churn required).
-- ---------------------------------------------------------------------------

select cron.schedule(
  'leadflow-enqueue-sends',
  '*/5 * * * *',
  $cron$
    select net.http_post(
      url     := 'https://bsevgxhnxlkzkcalevbb.supabase.co/functions/v1/enqueue-sends',
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

select cron.schedule(
  'leadflow-drain-queue',
  '*/2 * * * *',
  $cron$
    select net.http_post(
      url     := 'https://bsevgxhnxlkzkcalevbb.supabase.co/functions/v1/drain-send-queue',
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

select cron.schedule(
  'leadflow-process-bounces',
  '*/30 * * * *',
  $cron$
    select net.http_post(
      url     := 'https://bsevgxhnxlkzkcalevbb.supabase.co/functions/v1/process-bounces',
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
-- 3. Probe: three schedules now live AND none still reference the legacy GUC.
-- ---------------------------------------------------------------------------
do $$
declare
  n int;
  legacy_refs int;
begin
  select count(*) into n from cron.job
   where jobname in ('leadflow-enqueue-sends','leadflow-drain-queue','leadflow-process-bounces');
  if n < 3 then raise exception 'expected 3 leadflow schedules, found %', n; end if;

  select count(*) into legacy_refs from cron.job
   where jobname like 'leadflow-%'
     and command like '%app.settings.service_role_key%';
  if legacy_refs > 0 then
    raise exception 'one or more leadflow cron jobs still reference the legacy GUC';
  end if;
end $$;
