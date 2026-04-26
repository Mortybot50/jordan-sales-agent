-- =============================================================================
-- Jordan Sales Agent — Salesforce CSV Import
-- Migration: 20260427000001_salesforce_csv_import
-- =============================================================================
-- 1. Add contacts.metadata JSONB for storing Salesforce extra fields
-- 2. Add 'import' activity_type so the importer can log import events

-- 1. contacts.metadata — stores sf_title, sf_lead_source, sf_owner, sf_extra etc.
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;

-- 2. Extend activity_type check to include 'import'
ALTER TABLE activities DROP CONSTRAINT IF EXISTS activities_activity_type_check;
ALTER TABLE activities ADD CONSTRAINT activities_activity_type_check
  CHECK (activity_type = ANY(ARRAY[
    'email_sent', 'email_opened', 'email_clicked', 'reply_received',
    'call_note', 'meeting_note', 'task_completed', 'stage_change',
    'bounce', 'unsubscribe',
    'email_inbound', 'email_outbound', 'deal_created', 'note', 'meeting_booked',
    'email_manual', 'import'
  ]));
