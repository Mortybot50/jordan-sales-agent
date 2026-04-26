-- Morning briefing send-log for idempotency.
-- The pg_cron job will fire hourly and the Edge Function gates on Melbourne
-- local hour matching each user's email_notifications.briefing_time_hour.
-- If a transient retry happens (e.g. pg_net flakes), the unique index on
-- (user_id, sent_local_date) prevents duplicate sends to the same user
-- on the same Melbourne calendar day.

CREATE TABLE IF NOT EXISTS public.briefing_sends (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  sent_at         timestamptz NOT NULL DEFAULT now(),
  -- Melbourne calendar date the briefing was sent for (e.g. 2026-04-27).
  -- Computed at insert time; used for idempotency.
  sent_local_date date NOT NULL DEFAULT (now() AT TIME ZONE 'Australia/Melbourne')::date,
  item_count      integer,
  resend_message_id text,
  error           text
);

CREATE UNIQUE INDEX IF NOT EXISTS briefing_sends_user_local_date_uidx
  ON public.briefing_sends (user_id, sent_local_date);

CREATE INDEX IF NOT EXISTS briefing_sends_sent_at_idx
  ON public.briefing_sends (sent_at DESC);

ALTER TABLE public.briefing_sends ENABLE ROW LEVEL SECURITY;

-- Users can read their own send history; service role bypasses RLS for inserts.
DROP POLICY IF EXISTS briefing_sends_self_read ON public.briefing_sends;
CREATE POLICY briefing_sends_self_read
  ON public.briefing_sends
  FOR SELECT
  USING (user_id = auth.uid());
