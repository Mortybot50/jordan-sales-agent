-- pg_cron job for sequence-tick — fires hourly at :15 (offset from the
-- morning-briefing's :00 to spread load on the Edge Function runtime).
--
-- Service role key is read from Supabase Vault via vault.decrypted_secrets.
-- The secret must be seeded ONCE per project (typically via supabase-mcp):
--
--   SELECT vault.create_secret('<service-role-key>'::text, 'service_role_key');
--
-- The older `ALTER DATABASE postgres SET app.settings.service_role_key`
-- pattern is REJECTED by Supabase managed Postgres — confirmed 04/05/2026.
-- See 20260426000009_morning_briefing_cron.sql for the same Vault pattern,
-- and ~/.claude/rules/dev/supabase-migrations.md "Service-role keys & Vault".

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
        'Authorization', 'Bearer ' || (
          SELECT decrypted_secret
          FROM vault.decrypted_secrets
          WHERE name = 'service_role_key'
          LIMIT 1
        )
      ),
      body    := '{}'::jsonb
    );
  $cron$
);
