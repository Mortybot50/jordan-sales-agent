-- =============================================================================
-- Jordan Sales Agent — Week 3 Day 1: Activities archive + email_manual type
-- Migration: 20260422000002_activities_archive_and_manual
-- =============================================================================

-- 1. Add archived_at column (for briefing reply archive action)
ALTER TABLE activities
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

-- 2. Add email_manual to activity_type check constraint
ALTER TABLE activities DROP CONSTRAINT IF EXISTS activities_activity_type_check;
ALTER TABLE activities ADD CONSTRAINT activities_activity_type_check
  CHECK (activity_type = ANY(ARRAY[
    'email_sent', 'email_opened', 'email_clicked', 'reply_received',
    'call_note', 'meeting_note', 'task_completed', 'stage_change',
    'bounce', 'unsubscribe',
    'email_inbound', 'email_outbound', 'deal_created', 'note', 'meeting_booked',
    'email_manual'
  ]));

-- 3. Partial index: only index non-archived activities for briefing queries
CREATE INDEX IF NOT EXISTS activities_archived_briefing_idx
  ON activities(activity_type, occurred_at DESC)
  WHERE archived_at IS NULL;
