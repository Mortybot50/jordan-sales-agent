-- Widen money columns on deals from numeric(10,2) (~$100M ceiling) to numeric(14,2) (~$1T).
-- Same precision (2 decimal places); just more digits left of the decimal so a typo extra zero
-- on a real $9.9M deal no longer overflows. commission_pct stays at numeric(5,2) since it's
-- a percentage (0-100). See walkthrough-audit-2026-04-26.md § B1.
--
-- Two triggers reference the columns we want to alter (acv, weekly_price_override) in their
-- UPDATE OF column lists, which blocks ALTER COLUMN TYPE. Drop and recreate them around the
-- alter; trigger functions themselves are untouched.

DROP TRIGGER IF EXISTS trg_deals_recompute_gate ON public.deals;
DROP TRIGGER IF EXISTS trg_compute_deal_financials ON public.deals;

ALTER TABLE deals
  ALTER COLUMN contract_value TYPE numeric(14,2),
  ALTER COLUMN acv            TYPE numeric(14,2),
  ALTER COLUMN tcv            TYPE numeric(14,2),
  ALTER COLUMN final_value    TYPE numeric(14,2),
  ALTER COLUMN commission_amount      TYPE numeric(14,2),
  ALTER COLUMN weekly_price_override  TYPE numeric(14,2);

CREATE TRIGGER trg_compute_deal_financials
  BEFORE INSERT OR UPDATE OF product_id, weekly_price_override, term_months, commission_pct
  ON public.deals
  FOR EACH ROW
  EXECUTE FUNCTION compute_deal_financials();

CREATE TRIGGER trg_deals_recompute_gate
  AFTER INSERT OR UPDATE OF close_won_at, acv, stage_id, owner_user_id
  ON public.deals
  FOR EACH ROW
  EXECUTE FUNCTION trg_deals_recompute_gate_fn();
