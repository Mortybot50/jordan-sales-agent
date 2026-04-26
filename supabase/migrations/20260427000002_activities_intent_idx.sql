-- =============================================================================
-- Reply Intent Classifier — activities.metadata intent index
-- Migration: 20260427000002_activities_intent_idx
-- =============================================================================
-- Supports fast filtering/sorting by AI-classified reply intent on the
-- activities table. The classify-reply-intent edge function writes:
--   metadata ->> 'intent'           text  (positive | objection | unsubscribe | ooo | spam | referral | other)
--   metadata ->> 'intent_confidence' text  (stringified float 0.0-1.0)
--   metadata ->> 'intent_reason'     text  (one sentence)
--   metadata ->> 'classified_at'     text  (ISO-8601 timestamp)
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_activities_intent
  ON activities ((metadata ->> 'intent'));
