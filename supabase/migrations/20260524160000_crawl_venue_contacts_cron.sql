-- =============================================================================
-- LeadFlow Sourcing — crawl-venue-contacts cron drainer
-- Migration: 20260524160000_crawl_venue_contacts_cron
-- =============================================================================
-- Every 5 minutes, pick up to 20 venues with contact_enrichment_status='pending'
-- and fire-and-forget POST them to the crawl-venue-contacts Edge Function. The
-- function itself flips the venue status (crawled_found / crawled_empty /
-- failed), so the next tick naturally only picks up the remaining pending rows
-- via the partial index venues_enrichment_status_idx.
--
-- Auth: vault.decrypted_secrets name='service_role_key' (same pattern as
-- 20260519000005_fix_cron_auth_via_vault.sql). Vault row is already seeded on
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
-- 1. Drainer function: pick up to 20 pending venues, fire async http_post to
--    crawl-venue-contacts for each. Each call is independent — one failure
--    does not block the rest of the batch.
-- ---------------------------------------------------------------------------
create or replace function public.leadflow_drain_crawl_queue()
returns integer
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v record;
  bearer text;
  fired integer := 0;
begin
  select decrypted_secret into bearer
    from vault.decrypted_secrets
   where name = 'service_role_key'
   limit 1;

  if bearer is null then
    raise warning 'leadflow_drain_crawl_queue: no service_role_key in vault — skipping tick';
    return 0;
  end if;

  for v in
    select id
      from venues
     where contact_enrichment_status = 'pending'
     order by created_at asc nulls last
     limit 20
  loop
    perform net.http_post(
      url     := 'https://bsevgxhnxlkzkcalevbb.supabase.co/functions/v1/crawl-venue-contacts',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || bearer
      ),
      body    := jsonb_build_object('venue_id', v.id)
    );
    fired := fired + 1;
  end loop;

  return fired;
end;
$$;

revoke all on function public.leadflow_drain_crawl_queue() from public;

-- ---------------------------------------------------------------------------
-- 2. Unschedule any prior copy of the crawl cron, then re-schedule fresh.
-- ---------------------------------------------------------------------------
do $$ begin
  perform cron.unschedule(jobid) from cron.job
   where jobname = 'leadflow-crawl-pending-venues';
exception when others then null;
end $$;

select cron.schedule(
  'leadflow-crawl-pending-venues',
  '*/5 * * * *',
  $cron$ select public.leadflow_drain_crawl_queue(); $cron$
);

-- ---------------------------------------------------------------------------
-- 3. Probe: schedule lives.
-- ---------------------------------------------------------------------------
do $$
declare n int;
begin
  select count(*) into n from cron.job where jobname = 'leadflow-crawl-pending-venues';
  if n < 1 then raise exception 'leadflow-crawl-pending-venues schedule not registered'; end if;
end $$;
