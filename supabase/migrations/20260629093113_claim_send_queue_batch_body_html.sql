-- Threads body_html through the send-queue claim RPC so drain-send-queue can
-- send the styled HTML body (signature image logos) instead of re-deriving HTML
-- from text via textToHtml().
--
-- The RETURNS TABLE signature changes (adds body_html), so CREATE OR REPLACE is
-- not allowed — Postgres rejects a return-type change in place. We DROP then
-- recreate, and re-apply the full grant/revoke set from BOTH prior migrations:
--   20260519000004_pgcron_schedules.sql      → revoke from public, grant service_role
--   20260611071849_function_execute_lockdown → revoke from public, anon, authenticated
--
-- Body is otherwise identical to the original: same status filter, same
-- FOR UPDATE SKIP LOCKED claim, same status=sending transition.
--
-- Idempotent: DROP ... IF EXISTS, then recreate. Safe to re-run.

drop function if exists public.claim_send_queue_batch(int);

create function public.claim_send_queue_batch(p_batch int default 20)
returns table (
  id                uuid,
  org_id            uuid,
  email_account_id  uuid,
  draft_id          uuid,
  to_email          text,
  subject           text,
  body              text,
  body_html         text
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
    u.id, u.org_id, u.email_account_id, u.draft_id, u.to_email, u.subject, u.body, u.body_html;
end;
$$;

revoke all on function public.claim_send_queue_batch(int) from public;
revoke execute on function public.claim_send_queue_batch(int) from anon, authenticated;
grant execute on function public.claim_send_queue_batch(int) to service_role;

comment on function public.claim_send_queue_batch(int) is
  'Atomically claims up to p_batch queued sends whose scheduled_for is due. '
  'Uses FOR UPDATE SKIP LOCKED so two concurrent drain-send-queue ticks never '
  'claim the same row. Sets status=sending; the caller must follow up with a '
  'terminal status. Returns body_html so the worker can send the styled HTML '
  'signature without re-deriving markup from text.';
