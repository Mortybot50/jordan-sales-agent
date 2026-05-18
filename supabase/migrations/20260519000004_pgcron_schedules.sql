-- =============================================================================
-- LeadFlow native sender — Week 2 cron schedules + queue claim RPC.
-- Migration: 20260519000004_pgcron_schedules
-- =============================================================================
-- Installs three pg_cron jobs that drive the automation plane:
--   leadflow-enqueue-sends    every  5 min  → POST /functions/v1/enqueue-sends
--   leadflow-drain-queue      every  2 min  → POST /functions/v1/drain-send-queue
--   leadflow-process-bounces  every 30 min  → POST /functions/v1/process-bounces
--
-- All three use the existing `app.settings.service_role_key` GUC that the
-- morning-briefing + sequence-tick crons read. Set ONCE via:
--   ALTER DATABASE postgres SET app.settings.service_role_key = '<service_role_key>';
--
-- Plus:
--   1. A unique partial index on email_send_queue.draft_id so concurrent
--      enqueue-sends ticks cannot create two queue rows for the same draft.
--   2. A SECURITY DEFINER RPC `claim_send_queue_batch(p_batch int)` that uses
--      `FOR UPDATE SKIP LOCKED` to atomically claim a batch of due rows.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Unique partial index (idempotency for enqueue-sends).
--    Partial WHERE draft_id IS NOT NULL — some queue rows in future flows
--    may not be draft-backed (warmup messages later).
-- ---------------------------------------------------------------------------
create unique index if not exists email_send_queue_draft_unique
  on public.email_send_queue (draft_id)
  where draft_id is not null;

-- ---------------------------------------------------------------------------
-- 2. Atomic claim RPC for drain-send-queue.
-- ---------------------------------------------------------------------------
create or replace function public.claim_send_queue_batch(p_batch int default 20)
returns table (
  id                uuid,
  org_id            uuid,
  email_account_id  uuid,
  draft_id          uuid,
  to_email          text,
  subject           text,
  body              text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch int := greatest(1, least(coalesce(p_batch, 20), 100));
begin
  return query
  with claimed as (
    select q.id
    from public.email_send_queue q
    where q.status = 'queued'
      and q.scheduled_for <= now()
    order by q.scheduled_for
    for update skip locked
    limit v_batch
  )
  update public.email_send_queue u
     set status = 'sending',
         attempt_count = u.attempt_count + 1,
         updated_at    = now()
    from claimed c
   where u.id = c.id
  returning
    u.id, u.org_id, u.email_account_id, u.draft_id, u.to_email, u.subject, u.body;
end;
$$;

revoke all on function public.claim_send_queue_batch(int) from public;
grant execute on function public.claim_send_queue_batch(int) to service_role;

comment on function public.claim_send_queue_batch(int) is
  'Atomically claims up to p_batch queued sends whose scheduled_for is due. '
  'Uses FOR UPDATE SKIP LOCKED so two concurrent drain-send-queue ticks never '
  'claim the same row. Sets status=sending; the caller must follow up with a '
  'final status (sent/failed/bounced/cancelled).';

-- ---------------------------------------------------------------------------
-- 3. pg_cron schedules.
--    cron.unschedule(jobid) is wrapped in EXCEPTION so re-running this
--    migration is idempotent even if the row already exists.
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

select cron.schedule(
  'leadflow-enqueue-sends',
  '*/5 * * * *',
  $cron$
    select net.http_post(
      url     := 'https://bsevgxhnxlkzkcalevbb.supabase.co/functions/v1/enqueue-sends',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
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
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
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
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
      ),
      body    := '{}'::jsonb
    );
  $cron$
);

-- Probe: three schedules now live.
do $$
declare n int;
begin
  select count(*) into n from cron.job where jobname like 'leadflow-%' and
    jobname in ('leadflow-enqueue-sends','leadflow-drain-queue','leadflow-process-bounces');
  if n < 3 then raise exception 'expected 3 leadflow schedules, found %', n; end if;
end $$;
