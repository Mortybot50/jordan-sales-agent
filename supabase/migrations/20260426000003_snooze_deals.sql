-- Win A: Snooze deal — hide from active pipeline + briefing until a chosen wake date.
-- See clients/jordan/plans/snooze-and-lost-reason-ship-summary.md
ALTER TABLE deals ADD COLUMN IF NOT EXISTS snoozed_until timestamptz;

CREATE INDEX IF NOT EXISTS idx_deals_snoozed
  ON deals (org_id, snoozed_until)
  WHERE snoozed_until IS NOT NULL;

COMMENT ON COLUMN deals.snoozed_until IS
  'When set and in future, deal is hidden from active views; auto-wakes at this time.';
