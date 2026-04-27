-- pg_cron job for sequence-tick — fires hourly at :15 (offset from the
-- morning-briefing's :00 to spread load on the Edge Function runtime).
--
-- Service role key is read from `app.settings.service_role_key`, set ONCE
-- via the Supabase SQL editor:
--
--   ALTER DATABASE postgres SET app.settings.service_role_key = '<service_role_key>';
--
-- See 20260426000009_morning_briefing_cron.sql for the same pattern.

DO $$
BEGIN
  PERFORM cron.unschedule(jobid)
  FROM cron.job
  WHERE jobname = 'leadflow-sequence-tick';
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'leadflow-sequence-tick',
  '15 * * * *',
  $cron$
    SELECT net.http_post(
      url     := 'https://bsevgxhnxlkzkcalevbb.supabase.co/functions/v1/sequence-tick',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
      ),
      body    := '{}'::jsonb
    );
  $cron$
);
