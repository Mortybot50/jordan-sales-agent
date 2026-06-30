-- Monthly gate: exclude held deals from achieved ACV.
--
-- "Hold for next month" moved from a pipeline stage to the deals.is_held flag
-- (20260630101357_kanban_temperature_axis.sql). recompute_monthly_gate() still
-- only excluded the now-deleted 'Hold for Next Month' stage by name, so a
-- current-month won deal that gets held would still inflate achieved_acv. And
-- the recompute trigger never fired on is_held changes, so toggling the hold
-- didn't re-run the gate at all.
--
-- This migration:
--   1. Re-defines recompute_monthly_gate to exclude is_held = true deals.
--   2. Re-creates the trigger so it also fires when is_held changes.

begin;

CREATE OR REPLACE FUNCTION recompute_monthly_gate(
  p_org_id uuid,
  p_user_id uuid,
  p_month date
)
RETURNS void
LANGUAGE plpgsql
-- search_path pinned by 20260611071849_function_execute_lockdown — preserve it.
SET search_path = public
AS $$
DECLARE
  v_month_start timestamptz;
  v_month_end timestamptz;
  v_achieved numeric(10,2);
  v_target numeric(10,2);
  v_already_hit boolean;
  v_prior_month date;
BEGIN
  -- Calendar month boundary in Australia/Melbourne
  v_month_start := (p_month::timestamp AT TIME ZONE 'Australia/Melbourne');
  v_month_end := ((p_month + interval '1 month')::timestamp AT TIME ZONE 'Australia/Melbourne');

  -- Sum acv of close-won deals in this month. Exclude lost stages and any deal
  -- flagged held for next month (is_held) — held deals defer to a later gate.
  SELECT COALESCE(SUM(d.acv), 0) INTO v_achieved
    FROM deals d
    LEFT JOIN pipeline_stages ps ON ps.id = d.stage_id
    WHERE d.org_id = p_org_id
      AND d.close_won_at IS NOT NULL
      AND d.close_won_at >= v_month_start
      AND d.close_won_at < v_month_end
      AND COALESCE(d.is_held, false) = false
      AND COALESCE(ps.name, '') NOT IN ('Hold for Next Month', 'Closed Lost', 'Lost');

  -- Upsert the gate row
  INSERT INTO monthly_gates (org_id, user_id, month, achieved_acv)
    VALUES (p_org_id, p_user_id, p_month, v_achieved)
  ON CONFLICT (org_id, user_id, month) DO UPDATE
    SET achieved_acv = EXCLUDED.achieved_acv,
        updated_at = now()
  RETURNING hit_gate, target_acv INTO v_already_hit, v_target;

  -- If we just crossed the threshold this run, lock it + unlock prior month commission
  IF v_achieved >= v_target AND NOT v_already_hit THEN
    UPDATE monthly_gates
       SET hit_gate = true,
           locked_at = now(),
           updated_at = now()
     WHERE org_id = p_org_id AND user_id = p_user_id AND month = p_month;

    v_prior_month := (p_month - interval '1 month')::date;
    UPDATE monthly_gates
       SET prior_month_commission_status = 'unlocked',
           updated_at = now()
     WHERE org_id = p_org_id AND user_id = p_user_id AND month = v_prior_month
       AND prior_month_commission_status = 'pending';
  END IF;
END;
$$;

-- Re-create the trigger so a hold/unhold (is_held change) recomputes the gate.
-- The trigger function was renamed to _fn by the function-lockdown migration.
DROP TRIGGER IF EXISTS trg_deals_recompute_gate ON deals;
CREATE TRIGGER trg_deals_recompute_gate
  AFTER INSERT OR UPDATE OF close_won_at, acv, stage_id, owner_user_id, is_held
  ON deals
  FOR EACH ROW
  EXECUTE FUNCTION trg_deals_recompute_gate_fn();

commit;
