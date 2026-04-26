-- pg_cron job for the morning briefing.
--
-- Schedule strategy: fire HOURLY at HH:00 UTC. The Edge Function gates on
-- the Melbourne local hour matching each user's
-- email_notifications.briefing_time_hour preference. This is DST-safe
-- (no schedule edits when AEDT ↔ AEST flip) and respects the per-user
-- 5am–9am AEST options the Settings UI exposes.
--
-- Idempotency: briefing_sends has UNIQUE (user_id, sent_local_date) so
-- duplicate fires (transient pg_net retries) are no-ops, not duplicate emails.
--
-- Service role key: NEVER hardcode. We read it from a Postgres custom
-- setting `app.settings.service_role_key` that Morty must set ONCE via
-- the Supabase SQL editor:
--
--   ALTER DATABASE postgres SET app.settings.service_role_key = '<service_role_key>';
--
-- (Setting it on the database means it persists across sessions and is
-- visible to pg_cron's background worker. NOT visible to anon/authenticated
-- roles because of GUC permissions.)

DO $$
BEGIN
  -- Unschedule any prior version idempotently.
  PERFORM cron.unschedule(jobid)
  FROM cron.job
  WHERE jobname = 'leadflow-morning-briefing';
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'leadflow-morning-briefing',
  '0 * * * *',
  $cron$
    SELECT net.http_post(
      url     := 'https://bsevgxhnxlkzkcalevbb.supabase.co/functions/v1/send-morning-briefing',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
      ),
      body    := '{}'::jsonb
    );
  $cron$
);
