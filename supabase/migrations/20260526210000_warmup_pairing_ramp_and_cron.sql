-- =============================================================================
-- LeadFlow warmup network — pairing seed + ramp column + cron schedule.
-- Migration: 20260526210000_warmup_pairing_ramp_and_cron
-- =============================================================================
-- Context. PR #64 (20260519000003_warmup_and_spam_act) shipped the warmup
-- schema and 200 templates, but explicitly deferred the worker, the cron,
-- and the inter-inbox pairing seed. The audit on 2026-05-26 confirmed:
--   warmup_threads: 0 rows
--   email_accounts.last_warmup_send_at: NULL on all 4 inboxes
--   email_send_events warmup-tagged: 0 ever
-- This migration lands the missing pieces (data + schedule).
--
-- The corresponding Edge Function `send-warmup-tick` is deployed
-- separately. This migration only seeds data + cron — no code dependency.
--
-- What this lands:
--   1. email_accounts.warmup_day            — int 0..14, drives daily quota.
--   2. email_accounts.warmup_day_bumped_on  — date, idempotency for the
--                                             once-per-day bump.
--   3. warmup_threads                       — 12 directed pairs for the
--                                             LeadFlow org (4 inboxes × 3
--                                             other recipients each).
--   4. pg_cron 'leadflow-warmup-tick'       — every 30 min; the Edge
--                                             Function gates working-hours
--                                             against Australia/Melbourne.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Ramp columns on email_accounts.
-- ---------------------------------------------------------------------------

alter table public.email_accounts
  add column if not exists warmup_day integer not null default 0
    check (warmup_day >= 0 and warmup_day <= 14);

alter table public.email_accounts
  add column if not exists warmup_day_bumped_on date;

comment on column public.email_accounts.warmup_day is
  'Day-counter for the warmup ramp. 0 = never warmed; 1..14 = ramp days. '
  'Daily send quota = min(1 + warmup_day, 10). Bumped at most once per '
  'calendar day (Australia/Melbourne) by send-warmup-tick.';

comment on column public.email_accounts.warmup_day_bumped_on is
  'Australia/Melbourne date on which warmup_day was last incremented. '
  'Used to gate the once-per-day bump and avoid double-incrementing '
  'across cron ticks within the same local day.';

-- ---------------------------------------------------------------------------
-- 2. Pairing seed — populate warmup_threads with the full directed graph
--    between the 4 LeadFlow inboxes for org 5557189e-5c2d-4990-afad-6aa1861826cd.
--    With N inboxes you get N*(N-1) directed pairs (each inbox sends to
--    each of the others). 4 inboxes -> 12 rows.
--
--    Idempotent: the existing unique (org_id, sender, recipient) constraint
--    means re-running this migration is a no-op for any pair already seeded.
-- ---------------------------------------------------------------------------

insert into public.warmup_threads (
  org_id, sender_account_id, recipient_account_id, status, thread_subject
)
select
  s.org_id,
  s.id            as sender_account_id,
  r.id            as recipient_account_id,
  'active'        as status,
  null            as thread_subject  -- worker picks subject per send from warmup_messages
from public.email_accounts s
join public.email_accounts r
  on r.org_id = s.org_id
 and r.id <> s.id
where s.org_id = '5557189e-5c2d-4990-afad-6aa1861826cd'
  and s.status in ('active','warming')
  and r.status in ('active','warming')
on conflict (org_id, sender_account_id, recipient_account_id) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Probe: confirm the expected pairing count landed for the LeadFlow org.
--    With 4 active inboxes we want 12. If there are fewer active inboxes
--    we still want N*(N-1) — fail loudly if the count is wrong.
-- ---------------------------------------------------------------------------
do $$
declare
  n_inboxes int;
  n_pairs   int;
  expected  int;
begin
  select count(*) into n_inboxes
    from public.email_accounts
   where org_id = '5557189e-5c2d-4990-afad-6aa1861826cd'
     and status in ('active','warming');

  select count(*) into n_pairs
    from public.warmup_threads
   where org_id = '5557189e-5c2d-4990-afad-6aa1861826cd'
     and status = 'active';

  expected := n_inboxes * (n_inboxes - 1);
  if n_pairs < expected then
    raise exception
      'warmup_threads pairing seed expected % active rows for org, found %',
      expected, n_pairs;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. pg_cron: leadflow-warmup-tick.
--
--    Two-layer quiet-hours clamp:
--      a) cron string narrows to UTC hours that COULD correspond to
--         09:00-17:00 Australia/Melbourne.
--         - AEST  (UTC+10): Melbourne 09-17 = UTC 23-07
--         - AEDT  (UTC+11): Melbourne 09-17 = UTC 22-06
--         Union with slack: UTC 21:00 - 08:59. We can't day-clamp here
--         because Saturday UTC overlaps Sunday Melbourne — defer to (b).
--      b) Edge Function gates against Australia/Melbourne wall-clock
--         AND weekday (Mon-Fri only). Handles DST automatically.
--
--    Pre-flight: vault.secrets must already contain 'service_role_key'
--    (seeded out-of-band per 20260519000005). We re-assert that here so
--    a fresh DB doesn't end up with a broken schedule.
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

-- Unschedule any previous instance so re-running is idempotent.
do $$ begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'leadflow-warmup-tick';
exception when others then null;
end $$;

select cron.schedule(
  'leadflow-warmup-tick',
  '*/30 21-23,0-8 * * *',  -- UTC slot covering 09-17 AEST/AEDT; function gates Mon-Fri + exact hours
  $cron$
    select net.http_post(
      url     := 'https://bsevgxhnxlkzkcalevbb.supabase.co/functions/v1/send-warmup-tick',
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
-- 5. Probe: confirm the schedule landed.
-- ---------------------------------------------------------------------------
do $$
declare n int;
begin
  select count(*) into n from cron.job where jobname = 'leadflow-warmup-tick';
  if n < 1 then raise exception 'expected leadflow-warmup-tick schedule, found %', n; end if;
end $$;
