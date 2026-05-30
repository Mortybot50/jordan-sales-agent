-- P1-CP-08: switch leadflow-morning-briefing + leadflow-sequence-tick
-- cron job bodies from the broken `current_setting('app.settings.service_role_key', true)`
-- pattern to Supabase Vault. Closes the gap flagged in AUDIT-2026-05-28.
--
-- Background
-- ----------
-- The original 26/04 + 27/04 cron migrations used a Postgres custom GUC
-- (`app.settings.service_role_key`) that Supabase managed Postgres rejects
-- — it returns NULL even when set via ALTER DATABASE. Confirmed 04/05/2026
-- during the LeadFlow cron rewire. Production was patched in place via
-- supabase-mcp (Vault pattern) but the SOURCE migrations stayed broken,
-- so a fresh-clone replay re-introduced the bug.
--
-- This migration normalises BOTH cron jobs to read from
-- `vault.decrypted_secrets WHERE name = 'service_role_key'`. It runs
-- unschedule-then-schedule so it's idempotent regardless of which body
-- is currently registered (works on a remote that has the broken bodies,
-- a remote that already runs Vault via the MCP patch, or a fresh clone).
--
-- Prerequisite: the secret must exist in Vault. The 04/05/2026 rewire
-- already created it (vault id baa7db3e-40b0-4e8a-82df-faea19784d58 on
-- bsevgxhnxlkzkcalevbb). Fresh-project setup needs:
--
--   SELECT vault.create_secret('<service-role-key>'::text, 'service_role_key');
--
-- See ~/.claude/rules/dev/supabase-migrations.md "Service-role keys & Vault"
-- for the canonical pattern + the broken `current_setting` story.

-- ──────────────────────────────────────────────────────────────────────
-- 1. Unschedule existing cron jobs (idempotent — safe if absent)
-- ──────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  PERFORM cron.unschedule(jobid)
  FROM cron.job
  WHERE jobname IN ('leadflow-morning-briefing', 'leadflow-sequence-tick');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- ──────────────────────────────────────────────────────────────────────
-- 2. Reschedule morning-briefing — hourly at HH:00 UTC
--    Edge Function gates on Melbourne local hour matching each user's
--    email_notifications.briefing_time_hour preference. DST-safe.
-- ──────────────────────────────────────────────────────────────────────

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

-- ──────────────────────────────────────────────────────────────────────
-- 3. Reschedule sequence-tick — hourly at HH:15 (offset from briefing
--    to spread Edge Function load)
-- ──────────────────────────────────────────────────────────────────────

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
