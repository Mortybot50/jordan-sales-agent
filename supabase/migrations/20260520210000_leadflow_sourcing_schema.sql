-- =============================================================================
-- LeadFlow Sourcing — Phase 1 Schema
-- Migration: 20260520210000_leadflow_sourcing_schema
-- =============================================================================
-- Adds the full sourcing data model:
--   - venue_groups table (multi-site linkage)
--   - Extends venues: place_id dedup key, business_status, group_id FK,
--     enriched source enum, socials, ratings, flags
--   - Extends contacts: email_tier, source, verification_status, catch-all flags
--   - Extends signals: new signal types + sources for publication monitoring
--   - lead_searches + lead_search_runs tables (saved search + run history)
--   - Cron schedules for discovery engines
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. VENUE GROUPS (Lucas Group, Solotel, etc.)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS venue_groups (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  abn        TEXT,
  notes      TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(org_id, name)
);

ALTER TABLE venue_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "venue_groups_select" ON venue_groups
  FOR SELECT USING (org_id = auth_org_id());

CREATE POLICY "venue_groups_insert" ON venue_groups
  FOR INSERT WITH CHECK (org_id = auth_org_id());

CREATE POLICY "venue_groups_update" ON venue_groups
  FOR UPDATE USING (org_id = auth_org_id());

CREATE POLICY "venue_groups_delete" ON venue_groups
  FOR DELETE USING (org_id = auth_org_id());

-- Service role bypass (Edge Functions need write access)
CREATE POLICY "venue_groups_service_role" ON venue_groups
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ---------------------------------------------------------------------------
-- 2. EXTEND VENUES
-- ---------------------------------------------------------------------------

-- 2a. Google Maps / Places identifiers
ALTER TABLE venues
  ADD COLUMN IF NOT EXISTS place_id    TEXT,
  ADD COLUMN IF NOT EXISTS cid         TEXT,
  ADD COLUMN IF NOT EXISTS kgmid       TEXT;

-- Unique partial index for place_id dedup (primary dedup key)
CREATE UNIQUE INDEX IF NOT EXISTS idx_venues_place_id
  ON venues(place_id) WHERE place_id IS NOT NULL;

-- 2b. Business status
ALTER TABLE venues
  ADD COLUMN IF NOT EXISTS business_status TEXT;

ALTER TABLE venues
  DROP CONSTRAINT IF EXISTS venues_business_status_check;

ALTER TABLE venues
  ADD CONSTRAINT venues_business_status_check
  CHECK (business_status IN ('OPERATIONAL', 'CLOSED_TEMPORARILY', 'CLOSED_PERMANENTLY', 'UNKNOWN'));

-- 2c. Multi-site group FK (venue_groups created above)
ALTER TABLE venues
  ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES venue_groups(id) ON DELETE SET NULL;

-- 2d. Widen source enum to include all sourcing pipeline values
--     (existing values: google_places, csv_import, linkedin_import, manual, signal)
ALTER TABLE venues
  DROP CONSTRAINT IF EXISTS venues_source_check;

ALTER TABLE venues
  ADD CONSTRAINT venues_source_check
  CHECK (source = ANY (ARRAY[
    'outscraper', 'google_places', 'vcglr',
    'broadsheet', 'timeout', 'concrete_playground', 'good_food',
    'urban_list', 'hospitality_mag', 'general_news',
    'fiverr_legacy', 'manual', 'salesforce_import',
    -- preserve legacy values already in DB
    'csv_import', 'linkedin_import', 'signal'
  ]));

-- 2e. Sourcing flags
ALTER TABLE venues
  ADD COLUMN IF NOT EXISTS multi_site_flag BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS archived       BOOLEAN NOT NULL DEFAULT FALSE;

-- 2f. Enrichment fields
ALTER TABLE venues
  ADD COLUMN IF NOT EXISTS rating        NUMERIC,
  ADD COLUMN IF NOT EXISTS review_count  INTEGER,
  ADD COLUMN IF NOT EXISTS verified      BOOLEAN,
  ADD COLUMN IF NOT EXISTS working_hours JSONB,
  ADD COLUMN IF NOT EXISTS about_blob    JSONB;

-- lat + lng already exist (added in geocode batch migration) — skip

-- 2g. Social links
ALTER TABLE venues
  ADD COLUMN IF NOT EXISTS social_facebook  TEXT,
  ADD COLUMN IF NOT EXISTS social_instagram TEXT,
  ADD COLUMN IF NOT EXISTS social_linkedin  TEXT,
  ADD COLUMN IF NOT EXISTS social_twitter   TEXT;

-- 2h. Composite dedup index (backup when place_id absent)
CREATE INDEX IF NOT EXISTS idx_venues_phone_postcode
  ON venues(phone, postcode);

CREATE INDEX IF NOT EXISTS idx_venues_group_id
  ON venues(group_id);

CREATE INDEX IF NOT EXISTS idx_venues_business_status
  ON venues(business_status);

-- ---------------------------------------------------------------------------
-- 3. EXTEND CONTACTS
-- ---------------------------------------------------------------------------

-- 3a. Email tier (1=named DM, 2=role mailbox, 3=generic)
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS email_tier INTEGER;

ALTER TABLE contacts
  DROP CONSTRAINT IF EXISTS contacts_email_tier_check;

ALTER TABLE contacts
  ADD CONSTRAINT contacts_email_tier_check
  CHECK (email_tier IN (1, 2, 3));

-- 3b. Source tracking
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'manual';

ALTER TABLE contacts
  DROP CONSTRAINT IF EXISTS contacts_source_check;

ALTER TABLE contacts
  ADD CONSTRAINT contacts_source_check
  CHECK (source = ANY (ARRAY[
    'outscraper', 'google_places', 'vcglr',
    'broadsheet', 'timeout', 'concrete_playground', 'good_food',
    'urban_list', 'hospitality_mag', 'general_news',
    'fiverr_legacy', 'manual', 'salesforce_import',
    'csv_import', 'linkedin_import'
  ]));

-- 3c. Email verification
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS verification_status TEXT DEFAULT 'pending';

ALTER TABLE contacts
  DROP CONSTRAINT IF EXISTS contacts_verification_status_check;

ALTER TABLE contacts
  ADD CONSTRAINT contacts_verification_status_check
  CHECK (verification_status IN (
    'pending', 'valid', 'invalid', 'catch_all', 'disposable', 'unknown'
  ));

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS catch_all_flag            BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS catch_all_send_separately BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS verified_at               TIMESTAMPTZ;

-- 3d. Indexes
CREATE INDEX IF NOT EXISTS idx_contacts_email_tier
  ON contacts(email_tier);

CREATE INDEX IF NOT EXISTS idx_contacts_verification_status
  ON contacts(verification_status);

-- ---------------------------------------------------------------------------
-- 4. EXTEND SIGNALS TABLE
-- ---------------------------------------------------------------------------
-- Adds sourcing-pipeline signal types and sources.
-- The existing signals table uses signal_type / signal_source.

ALTER TABLE signals
  ADD COLUMN IF NOT EXISTS evidence_url TEXT,
  ADD COLUMN IF NOT EXISTS suburb       TEXT;

ALTER TABLE signals
  DROP CONSTRAINT IF EXISTS signals_signal_type_check;

ALTER TABLE signals
  ADD CONSTRAINT signals_signal_type_check
  CHECK (signal_type = ANY (ARRAY[
    -- existing
    'new_venue_opening', 'leadership_change', 'instagram_activity',
    -- new sourcing types
    'new_opening', 'expansion', 'refurb', 'acquisition', 'key_hire', 'reopening'
  ]));

ALTER TABLE signals
  DROP CONSTRAINT IF EXISTS signals_signal_source_check;

ALTER TABLE signals
  ADD CONSTRAINT signals_signal_source_check
  CHECK (signal_source = ANY (ARRAY[
    -- existing
    'vcglr', 'proxycurl', 'instagram', 'manual',
    -- new sourcing sources
    'outscraper', 'google_places',
    'broadsheet', 'timeout', 'concrete_playground', 'good_food',
    'urban_list', 'hospitality_mag', 'general_news'
  ]));

-- ---------------------------------------------------------------------------
-- 5. LEAD SEARCHES (saved search definitions)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS lead_searches (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id               UUID NOT NULL REFERENCES auth.users(id),
  name                  TEXT NOT NULL,
  region                TEXT NOT NULL DEFAULT 'Victoria',
  suburb                TEXT,
  categories            TEXT[] NOT NULL,
  source_engine         TEXT NOT NULL,
  limit_per_run         INTEGER NOT NULL DEFAULT 1000,
  email_extraction      BOOLEAN NOT NULL DEFAULT TRUE,
  schedule_cron         TEXT,
  last_run_at           TIMESTAMPTZ,
  last_run_cost_usd     NUMERIC,
  last_run_result_count INTEGER,
  total_runs            INTEGER NOT NULL DEFAULT 0,
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE lead_searches
  DROP CONSTRAINT IF EXISTS lead_searches_source_engine_check;

ALTER TABLE lead_searches
  ADD CONSTRAINT lead_searches_source_engine_check
  CHECK (source_engine IN ('outscraper', 'google_places'));

ALTER TABLE lead_searches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lead_searches_select" ON lead_searches
  FOR SELECT USING (org_id = auth_org_id());

CREATE POLICY "lead_searches_insert" ON lead_searches
  FOR INSERT WITH CHECK (org_id = auth_org_id());

CREATE POLICY "lead_searches_update" ON lead_searches
  FOR UPDATE USING (org_id = auth_org_id());

CREATE POLICY "lead_searches_delete" ON lead_searches
  FOR DELETE USING (org_id = auth_org_id());

CREATE POLICY "lead_searches_service_role" ON lead_searches
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ---------------------------------------------------------------------------
-- 6. LEAD SEARCH RUNS (per-run history)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS lead_search_runs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  search_id        UUID NOT NULL REFERENCES lead_searches(id) ON DELETE CASCADE,
  org_id           UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at      TIMESTAMPTZ,
  status           TEXT NOT NULL DEFAULT 'pending',
  result_count     INTEGER,
  new_venue_count  INTEGER,
  cost_usd         NUMERIC,
  error_message    TEXT
);

ALTER TABLE lead_search_runs
  DROP CONSTRAINT IF EXISTS lead_search_runs_status_check;

ALTER TABLE lead_search_runs
  ADD CONSTRAINT lead_search_runs_status_check
  CHECK (status IN ('pending', 'running', 'success', 'failed', 'partial'));

CREATE INDEX IF NOT EXISTS idx_lead_search_runs_search_id
  ON lead_search_runs(search_id);

ALTER TABLE lead_search_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lead_search_runs_select" ON lead_search_runs
  FOR SELECT USING (org_id = auth_org_id());

CREATE POLICY "lead_search_runs_insert" ON lead_search_runs
  FOR INSERT WITH CHECK (org_id = auth_org_id());

CREATE POLICY "lead_search_runs_update" ON lead_search_runs
  FOR UPDATE USING (org_id = auth_org_id());

CREATE POLICY "lead_search_runs_service_role" ON lead_search_runs
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ---------------------------------------------------------------------------
-- 7. CRON SCHEDULES (publication-poll + vcglr-poll cadences)
-- ---------------------------------------------------------------------------
-- Note: Edge Functions must be deployed before cron fires.
-- Schedules added here; same pattern as leadflow sender crons.

-- Remove any stale versions first (idempotent)
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

-- VCGLR liquor licence register — weekly (Monday 02:00 AEST = Sunday 16:00 UTC)
SELECT cron.schedule(
  'leadflow-vcglr-poll-weekly',
  '0 16 * * 0',
  $cron$
    SELECT net.http_post(
      url     := 'https://bsevgxhnxlkzkcalevbb.supabase.co/functions/v1/vcglr-poll',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
      ),
      body    := '{}'::jsonb
    );
  $cron$
);

-- Publication poll — 4h cadence (Broadsheet, Concrete Playground, Hospitality Mag)
SELECT cron.schedule(
  'leadflow-publication-poll-4h',
  '0 */4 * * *',
  $cron$
    SELECT net.http_post(
      url     := 'https://bsevgxhnxlkzkcalevbb.supabase.co/functions/v1/publication-poll',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
      ),
      body    := '{"sources":["broadsheet","concrete_playground","hospitality_mag"]}'::jsonb
    );
  $cron$
);

-- Publication poll — daily cadence (Time Out, Urban List, General News)
SELECT cron.schedule(
  'leadflow-publication-poll-daily',
  '30 2 * * *',
  $cron$
    SELECT net.http_post(
      url     := 'https://bsevgxhnxlkzkcalevbb.supabase.co/functions/v1/publication-poll',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
      ),
      body    := '{"sources":["timeout","urban_list","general_news"]}'::jsonb
    );
  $cron$
);

-- Publication poll — weekly cadence (Good Food / The Age)
SELECT cron.schedule(
  'leadflow-publication-poll-weekly',
  '0 3 * * 1',
  $cron$
    SELECT net.http_post(
      url     := 'https://bsevgxhnxlkzkcalevbb.supabase.co/functions/v1/publication-poll',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
      ),
      body    := '{"sources":["good_food"]}'::jsonb
    );
  $cron$
);
