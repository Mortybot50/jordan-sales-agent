-- =============================================================================
-- LeadFlow Sourcing — Contact crawler enrichment status
-- Migration: 20260524141419_venue_contact_enrichment_status
-- =============================================================================
-- Adds the state-machine columns the crawl-venue-contacts Edge Function uses
-- to coordinate with the cron drainer:
--   * contact_enrichment_status  — venue-level enrichment state
--   * last_crawled_at            — observability + future re-crawl cadence
--   * partial index on 'pending' — fast cron-drainer pick-list
--
-- Also adds a unique constraint on (org_id, venue_id, email) — required for
-- idempotent upserts (the discover-leads path was doing a manual maybeSingle
-- pre-check; the crawler will use ON CONFLICT DO NOTHING instead). Live DB
-- has 0 existing dupes on this key (verified via execute_sql 24/05).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Enrichment status on venues
-- ---------------------------------------------------------------------------

ALTER TABLE venues
  ADD COLUMN IF NOT EXISTS contact_enrichment_status TEXT NOT NULL DEFAULT 'pending';

ALTER TABLE venues
  DROP CONSTRAINT IF EXISTS venues_contact_enrichment_status_check;

ALTER TABLE venues
  ADD CONSTRAINT venues_contact_enrichment_status_check
  CHECK (contact_enrichment_status IN ('pending', 'crawled_found', 'crawled_empty', 'failed'));

ALTER TABLE venues
  ADD COLUMN IF NOT EXISTS last_crawled_at TIMESTAMPTZ;

-- Partial index — only the rows the cron drainer actually scans every 5 min
CREATE INDEX IF NOT EXISTS venues_enrichment_status_idx
  ON venues(contact_enrichment_status)
  WHERE contact_enrichment_status = 'pending';

-- ---------------------------------------------------------------------------
-- 2. Unique key for idempotent contact upserts
-- ---------------------------------------------------------------------------
-- Allow (org_id, venue_id, email) re-runs to be no-ops via ON CONFLICT.
-- Plain unique index (no partial WHERE) — supabase-js's `.upsert({onConflict})`
-- does NOT emit the WHERE predicate, so a partial index is not match-able from
-- the client. PG's default NULL distinctness already lets loose-contact rows
-- (NULL venue_id or NULL email) coexist without colliding.

CREATE UNIQUE INDEX IF NOT EXISTS contacts_org_venue_email_uniq
  ON contacts(org_id, venue_id, email);

-- ---------------------------------------------------------------------------
-- 3. Widen contacts.source CHECK to admit 'website_crawl'
-- ---------------------------------------------------------------------------
-- The Edge Function inserts contacts with source='website_crawl'. The base
-- constraint (20260520_leadflow_sourcing_phase1) did not include this value,
-- so a fresh DB replay would reject every crawler row. Live DB was patched
-- out-of-band 24/05; this clause makes the migration file replayable.

ALTER TABLE contacts
  DROP CONSTRAINT IF EXISTS contacts_source_check;

ALTER TABLE contacts
  ADD CONSTRAINT contacts_source_check
  CHECK (source = ANY (ARRAY[
    'outscraper', 'google_places', 'vcglr',
    'broadsheet', 'timeout', 'concrete_playground', 'good_food',
    'urban_list', 'hospitality_mag', 'general_news',
    'fiverr_legacy', 'manual', 'salesforce_import',
    'csv_import', 'linkedin_import',
    'website_crawl'
  ]));
