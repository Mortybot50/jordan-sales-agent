-- =============================================================================
-- Warm-reply WhatsApp push — schema (P0-3)
-- Migration: 20260526092804_warm_reply_push
-- =============================================================================
-- Adds:
--   - notification_log: audit + outbound queue for real-time pings
--   - users columns: notify_whatsapp_e164, notify_warm_replies,
--     notify_quiet_hours_start, notify_quiet_hours_end
--
-- This PR ships warm-reply pings only. The CHECK on kind keeps the door open
-- for future bounce_spike / cron_failure / sequence_failed pings (table-level
-- support now, UI/logic phase 2). RLS mirrors the per-user pattern from
-- claude_conversations (20260526051228) — users only see their own org's rows.
--
-- Delivery model: this PR uses the `notification_log` table itself as the
-- outbound queue (status='queued'). The OpenClaw gateway does not currently
-- expose an HTTP webhook for outbound WhatsApp — sends happen via the
-- `npx openclaw agent --channel whatsapp` CLI. A small launchd/cron poller
-- on the Mac mini will read `WHERE status='queued' ORDER BY created_at` and
-- mark rows 'sent' or 'failed'. The poller is out of scope for this PR; the
-- ship summary asks Morty whether to (a) wire the CLI poller, or (b) build a
-- real HTTP webhook on the gateway side.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. NOTIFICATION_LOG
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS notification_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  channel      TEXT NOT NULL,
  target       TEXT NOT NULL,
  kind         TEXT NOT NULL,
  activity_id  UUID REFERENCES activities(id) ON DELETE SET NULL,
  status       TEXT NOT NULL,
  reason       TEXT,
  body         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at      TIMESTAMPTZ
);

ALTER TABLE notification_log
  DROP CONSTRAINT IF EXISTS notification_log_channel_check;
ALTER TABLE notification_log
  ADD CONSTRAINT notification_log_channel_check
  CHECK (channel IN ('whatsapp', 'email', 'none'));

ALTER TABLE notification_log
  DROP CONSTRAINT IF EXISTS notification_log_kind_check;
ALTER TABLE notification_log
  ADD CONSTRAINT notification_log_kind_check
  CHECK (kind IN ('warm_reply', 'sequence_failed', 'bounce_spike', 'cron_failure', 'test_ping'));

ALTER TABLE notification_log
  DROP CONSTRAINT IF EXISTS notification_log_status_check;
ALTER TABLE notification_log
  ADD CONSTRAINT notification_log_status_check
  CHECK (status IN ('queued', 'sent', 'failed', 'skipped'));

-- Idempotency probe: classify-reply-intent looks up (kind, activity_id,
-- created_at > now() - interval '1 hour') to decide whether to enqueue.
-- Partial index speeds up that probe for the warm_reply hot path.
CREATE INDEX IF NOT EXISTS idx_notification_log_warm_reply_dedupe
  ON notification_log (activity_id, created_at DESC)
  WHERE kind = 'warm_reply' AND activity_id IS NOT NULL;

-- Queue poller scans queued rows in FIFO order.
CREATE INDEX IF NOT EXISTS idx_notification_log_queue
  ON notification_log (status, created_at)
  WHERE status = 'queued';

CREATE INDEX IF NOT EXISTS idx_notification_log_user_recent
  ON notification_log (user_id, created_at DESC);

ALTER TABLE notification_log ENABLE ROW LEVEL SECURITY;

-- Users see their own org's notification audit (debugging, "send test ping"
-- result). Service role bypasses for Edge Function inserts and the future
-- queue poller.
CREATE POLICY "notification_log_select" ON notification_log
  FOR SELECT USING (org_id = auth_org_id() AND user_id = auth.uid());

CREATE POLICY "notification_log_service_role" ON notification_log
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ---------------------------------------------------------------------------
-- 2. USERS COLUMNS — per-user notification preferences
-- ---------------------------------------------------------------------------

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS notify_whatsapp_e164 TEXT,
  ADD COLUMN IF NOT EXISTS notify_warm_replies BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS notify_quiet_hours_start INTEGER,
  ADD COLUMN IF NOT EXISTS notify_quiet_hours_end INTEGER;

-- 0-23 AEST hour bounds. Inclusive start, exclusive end — matches the
-- Edge Function's `hour >= start && hour < end` check.
ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_notify_quiet_hours_start_range;
ALTER TABLE users
  ADD CONSTRAINT users_notify_quiet_hours_start_range
  CHECK (notify_quiet_hours_start IS NULL OR (notify_quiet_hours_start >= 0 AND notify_quiet_hours_start <= 23));

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_notify_quiet_hours_end_range;
ALTER TABLE users
  ADD CONSTRAINT users_notify_quiet_hours_end_range
  CHECK (notify_quiet_hours_end IS NULL OR (notify_quiet_hours_end >= 0 AND notify_quiet_hours_end <= 24));
