-- =============================================================================
-- notification_log: add 'sending' claim status for the outbound drainer
-- Migration: 20260612090000_notification_log_sending_status
-- =============================================================================
-- The warm-reply / test-ping outbound drainer (runs on the Mac mini as a
-- launchd service, outside this repo) claims a queued row by flipping it to
-- 'sending' BEFORE dispatching the WhatsApp send. This makes the claim
-- crash-safe: if the drainer dies mid-send, the row is visibly stuck in
-- 'sending' (a reaper/alert can surface it) rather than being silently
-- re-sent on the next poll.
--
-- Lifecycle:
--   queued  -> sending -> sent     (happy path)
--   queued  -> sending -> failed   (after one retry w/ backoff)
--   sending -> sending             (never; claim is a single atomic UPDATE
--                                    ... WHERE status='queued' RETURNING)
--
-- This is an additive CHECK-constraint widening. No data is modified.
-- =============================================================================

ALTER TABLE notification_log
  DROP CONSTRAINT IF EXISTS notification_log_status_check;
ALTER TABLE notification_log
  ADD CONSTRAINT notification_log_status_check
  CHECK (status IN ('queued', 'sending', 'sent', 'failed', 'skipped'));

-- Reaper-friendly index: surface rows stuck in 'sending' (drainer crashed
-- mid-dispatch) ordered by when they were claimed.
CREATE INDEX IF NOT EXISTS idx_notification_log_sending_stuck
  ON notification_log (status, created_at)
  WHERE status = 'sending';
