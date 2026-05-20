-- =============================================================================
-- LeadFlow Sourcing — Codex P1 fixes
-- Migration: 20260520220000_sourcing_codex_fixes
-- =============================================================================
-- Addresses three P1 findings from Codex review of commit aabc255:
--
-- 1. place_id unique index must be scoped per org (multi-tenant safety).
--    The original idx_venues_place_id on venues(place_id) was global —
--    in a multi-org deployment, two orgs discovering the same Google place_id
--    would collide. Replace with a (org_id, place_id) partial unique index.
--
-- 2. Cron schedules in 20260520210000 used app.settings.service_role_key
--    (GUC), which is empty on prod. Re-schedule using vault.decrypted_secrets
--    exactly as the Week 2 hotfix migration (20260519000005) prescribes.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Fix place_id unique index — org-scoped
-- ---------------------------------------------------------------------------

DROP INDEX IF EXISTS idx_venues_place_id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_venues_org_place_id
  ON venues(org_id, place_id) WHERE place_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Fix cron schedules — vault-backed auth
-- ---------------------------------------------------------------------------

DO $$ BEGIN
  PERFORM cron.unschedule(jobid)
  FROM cron.job
  WHERE jobname IN (
    'leadflow-vcglr-poll-weekly',
    'leadflow-publication-poll-4h',
    'leadflow-publication-poll-daily',
    'leadflow-publication-poll-weekly'
  );
EXCEPTION WHEN others THEN NULL;
END $$;

SELECT cron.schedule(
  'leadflow-vcglr-poll-weekly',
  '0 16 * * 0',
  $cron$
    SELECT net.http_post(
      url     := 'https://bsevgxhnxlkzkcalevbb.supabase.co/functions/v1/vcglr-poll',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || (
          SELECT decrypted_secret FROM vault.decrypted_secrets
           WHERE name = 'service_role_key' LIMIT 1
        )
      ),
      body    := '{}'::jsonb
    );
  $cron$
);

SELECT cron.schedule(
  'leadflow-publication-poll-4h',
  '0 */4 * * *',
  $cron$
    SELECT net.http_post(
      url     := 'https://bsevgxhnxlkzkcalevbb.supabase.co/functions/v1/publication-poll',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || (
          SELECT decrypted_secret FROM vault.decrypted_secrets
           WHERE name = 'service_role_key' LIMIT 1
        )
      ),
      body    := '{"sources":["broadsheet","concrete_playground","hospitality_mag"]}'::jsonb
    );
  $cron$
);

SELECT cron.schedule(
  'leadflow-publication-poll-daily',
  '30 2 * * *',
  $cron$
    SELECT net.http_post(
      url     := 'https://bsevgxhnxlkzkcalevbb.supabase.co/functions/v1/publication-poll',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || (
          SELECT decrypted_secret FROM vault.decrypted_secrets
           WHERE name = 'service_role_key' LIMIT 1
        )
      ),
      body    := '{"sources":["timeout","urban_list","general_news"]}'::jsonb
    );
  $cron$
);

SELECT cron.schedule(
  'leadflow-publication-poll-weekly',
  '0 3 * * 1',
  $cron$
    SELECT net.http_post(
      url     := 'https://bsevgxhnxlkzkcalevbb.supabase.co/functions/v1/publication-poll',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || (
          SELECT decrypted_secret FROM vault.decrypted_secrets
           WHERE name = 'service_role_key' LIMIT 1
        )
      ),
      body    := '{"sources":["good_food"]}'::jsonb
    );
  $cron$
);

-- ---------------------------------------------------------------------------
-- Probe: no sourcing cron jobs reference the legacy GUC
-- ---------------------------------------------------------------------------
DO $$
DECLARE legacy_refs INT;
BEGIN
  SELECT COUNT(*) INTO legacy_refs FROM cron.job
   WHERE jobname LIKE 'leadflow-%'
     AND command LIKE '%app.settings.service_role_key%';
  IF legacy_refs > 0 THEN
    RAISE EXCEPTION 'sourcing cron jobs still reference the legacy GUC — fix needed';
  END IF;
END $$;
