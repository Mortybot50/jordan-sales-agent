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
-- Service role key: NEVER hardcode. We read it from Supabase Vault via
-- the `vault.decrypted_secrets` view. The secret must be created ONCE per
-- project (typically via supabase-mcp) before this migration applies:
--
--   SELECT vault.create_secret('<service-role-key>'::text, 'service_role_key');
--
-- NOTE: the older `ALTER DATABASE postgres SET app.settings.service_role_key`
-- pattern (with `current_setting('app.settings.service_role_key', true)` reads
-- inside the cron body) is REJECTED by Supabase managed Postgres — confirmed
-- 04/05/2026 during the LeadFlow cron rewire. Vault is the only working path.
-- See ~/.claude/rules/dev/supabase-migrations.md "Service-role keys & Vault".

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
