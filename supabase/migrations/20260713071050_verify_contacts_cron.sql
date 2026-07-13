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
-- 0b. Atomic claim: the drainer reserves pending contacts before spending a
--     ZeroBounce credit on them, so two overlapping ticks never double-verify
--     (and never burn duplicate paid API calls) on the same row.
--
--     verification_claimed_at is a soft lease, NOT a verification state — the
--     CHECK-constrained verification_status vocabulary is untouched. A claim
--     older than 15 min is considered stale and re-claimable, so a run that
--     dies mid-batch (e.g. ZeroBounce 502) doesn't strand its contacts.
-- ---------------------------------------------------------------------------
alter table public.contacts
  add column if not exists verification_claimed_at timestamptz;

create or replace function public.leadflow_claim_pending_contacts(p_limit int)
returns table (id uuid, email text)
language sql
security definer
set search_path = ''
as $$
  update public.contacts c
     set verification_claimed_at = now()
   where c.id in (
     select c2.id
       from public.contacts c2
       join public.venues v on v.id = c2.venue_id
      where c2.verification_status = 'pending'
        and c2.email is not null
        and v.review_status is distinct from 'rejected'
        and (c2.verification_claimed_at is null
             or c2.verification_claimed_at < now() - interval '15 minutes')
      order by c2.email_tier asc nulls last
      limit greatest(1, least(coalesce(p_limit, 100), 200))
      for update of c2 skip locked
   )
  returning c.id, c.email;
$$;

revoke all on function public.leadflow_claim_pending_contacts(int) from public;
grant execute on function public.leadflow_claim_pending_contacts(int) to service_role;

comment on function public.leadflow_claim_pending_contacts(int) is
  'Atomically leases up to p_limit pending contacts for ZeroBounce verification '
  '(best email_tier first, excludes rejected venues) via FOR UPDATE SKIP LOCKED, '
  'stamping verification_claimed_at. Overlapping drainer ticks never claim the '
  'same row. Claims older than 15 min are re-leasable. service_role only.';

-- ---------------------------------------------------------------------------
-- 1. Drainer function: fire one async http_post to verify-contacts. The Edge
--    Function claims a batch via leadflow_claim_pending_contacts() so this
--    stays a thin trigger.
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
  if exists (select 1 from cron.job where jobname = 'leadflow-verify-contacts') then
    perform cron.unschedule('leadflow-verify-contacts');
  end if;
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
