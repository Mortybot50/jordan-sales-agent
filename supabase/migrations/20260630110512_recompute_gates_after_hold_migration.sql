-- One-time gate recompute after the held-deal migration.
--
-- 20260630101357_kanban_temperature_axis.sql moved current-month won deals
-- out of the (now-deleted) 'Hold for Next Month' stage. At that point the
-- gate trigger was still the old version, which excluded only the stage name
-- and not the new is_held flag — so on a fresh replay it could write an
-- inflated monthly_gates.achieved_acv. The corrected function+trigger landed
-- in 20260630105154_gate_exclude_held_deals.sql, but a CREATE OR REPLACE does
-- NOT recompute rows that already exist, so any stale achieved_acv would
-- linger until the next deal update fired the trigger.
--
-- This migration recomputes every existing gate row with the corrected
-- function so achieved_acv is consistent immediately after replay. On the
-- live DB this is a verified no-op (the single gate row already reads 0 and
-- recomputes to 0), but it keeps a fresh clone correct.
--
-- Idempotent: recompute_monthly_gate recalculates achieved_acv from scratch,
-- so re-running yields the same result. Safe to replay.

begin;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT org_id, user_id, month FROM monthly_gates LOOP
    PERFORM recompute_monthly_gate(r.org_id, r.user_id, r.month);
  END LOOP;
END;
$$;

commit;
