-- =============================================================================
-- VCGLR licences (bulk-download sync) — GATE-5 ship
-- Migration: 20260527140000_vcglr_licences
-- =============================================================================
-- Replaces the legacy HTML scrape of liquor.vcglr.vic.gov.au with a weekly
-- bulk-download worker against the data.vic.gov.au CKAN API
-- (`Current_Victorian_Licences_By_Location-<DD>-<Month>-<YYYY>.xlsx`,
-- CC-BY 4.0). Spike: clients/jordan/plans/VCGLR-VALIDATION-2026-05-27.md.
--
-- Two shared (tenant-agnostic) tables:
--   vcglr_licences  — raw snapshot rows, keyed on licence_number
--   vcglr_signals   — internal diff event log (new_grant / cancellation /
--                     transfer)
--
-- ICP-matching new_grant rows still propagate to the per-org `signals` table
-- (signal_source='vcglr', signal_type='new_opening') via the Edge Function —
-- the existing unique partial index on
-- (org_id, signal_source, (detail->>'licence_number')) handles dedup.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. vcglr_licences — raw snapshot rows
-- ---------------------------------------------------------------------------
-- VCGLR data is a public CC-BY 4.0 dataset, so the table is tenant-agnostic
-- (no org_id). Read access is granted to authenticated users so the UI can
-- surface licence detail; writes are limited to service_role.

CREATE TABLE IF NOT EXISTS vcglr_licences (
  licence_number  TEXT PRIMARY KEY,
  licensee        TEXT,
  trading_name    TEXT,
  category        TEXT,
  address         TEXT,
  suburb          TEXT,
  postcode        TEXT,
  lat             NUMERIC,
  lng             NUMERIC,
  council         TEXT,
  region          TEXT,
  trading_hours   TEXT,
  status          TEXT NOT NULL DEFAULT 'current'
                  CHECK (status IN ('current', 'cancelled')),
  first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  snapshot_date   DATE NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_vcglr_licences_council_status
  ON vcglr_licences(council, status);

CREATE INDEX IF NOT EXISTS idx_vcglr_licences_suburb_status
  ON vcglr_licences(suburb, status);

CREATE INDEX IF NOT EXISTS idx_vcglr_licences_snapshot_date
  ON vcglr_licences(snapshot_date);

ALTER TABLE vcglr_licences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "vcglr_licences_select_authenticated" ON vcglr_licences
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "vcglr_licences_service_role" ON vcglr_licences
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ---------------------------------------------------------------------------
-- 2. vcglr_signals — internal diff event log
-- ---------------------------------------------------------------------------
-- One row per detected event (new_grant / cancellation / transfer) between
-- two snapshots. Provides a permanent, source-agnostic audit trail
-- independent of per-org `signals`. ICP-matching new_grant events feed
-- forward to per-org `signals` via the Edge Function.

CREATE TABLE IF NOT EXISTS vcglr_signals (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  licence_number        TEXT NOT NULL REFERENCES vcglr_licences(licence_number)
                        ON DELETE CASCADE,
  event_type            TEXT NOT NULL
                        CHECK (event_type IN ('new_grant', 'cancellation', 'transfer')),
  detected_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  snapshot_date_before  DATE,
  snapshot_date_after   DATE NOT NULL,
  payload               JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (licence_number, event_type, snapshot_date_after)
);

CREATE INDEX IF NOT EXISTS idx_vcglr_signals_event_type_detected
  ON vcglr_signals(event_type, detected_at DESC);

CREATE INDEX IF NOT EXISTS idx_vcglr_signals_snapshot_date_after
  ON vcglr_signals(snapshot_date_after);

ALTER TABLE vcglr_signals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "vcglr_signals_select_authenticated" ON vcglr_signals
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "vcglr_signals_service_role" ON vcglr_signals
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ---------------------------------------------------------------------------
-- 3. Cron — re-point weekly schedule from vcglr-poll to vcglr-sync
-- ---------------------------------------------------------------------------
-- The legacy `vcglr-poll` Edge Function scraped the dead ALARM portal.
-- It is replaced in this PR by `vcglr-sync` (bulk XLSX). Drop the old
-- schedule and create a new one targeting the new function.
--
-- Schedule: Monday 14:00 UTC = Tuesday 00:00 AEST. Source publishes monthly
-- with ~12-day lag (per spike), so weekly poll is more than enough.
--
-- Auth: vault-backed service_role_key, same pattern as
-- 20260520220000_sourcing_codex_fixes.sql.

DO $$ BEGIN
  PERFORM cron.unschedule(jobid)
  FROM cron.job
  WHERE jobname IN ('leadflow-vcglr-poll-weekly', 'leadflow-vcglr-sync-weekly');
EXCEPTION WHEN others THEN NULL;
END $$;

SELECT cron.schedule(
  'leadflow-vcglr-sync-weekly',
  '0 14 * * 1',
  $cron$
    SELECT net.http_post(
      url     := 'https://bsevgxhnxlkzkcalevbb.supabase.co/functions/v1/vcglr-sync',
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
