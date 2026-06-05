-- P0-2: Add a $1M ceiling on every monetary column on deals.
--
-- A seed deal at $99,999,999.99 (the "[WALK-26APR] Mega-value (numeric ceiling)"
-- row) leaked into the dashboard's open-pipeline tile as $100M after the
-- 25/04/2026 walkthrough seed pass. Realistic hospitality cold-outreach deals
-- top out well under $200k; $1M leaves >5x headroom for any imaginable
-- multi-year package and still catches the "$5,000 → $5,000,000" typo class.
--
-- The single offending row was deleted in the same change. Every other
-- row is well below this ceiling on every column (verified pre-apply).
ALTER TABLE public.deals
  ADD CONSTRAINT deals_contract_value_ceiling_check
    CHECK (contract_value IS NULL OR contract_value <= 1000000),
  ADD CONSTRAINT deals_acv_ceiling_check
    CHECK (acv IS NULL OR acv <= 1000000),
  ADD CONSTRAINT deals_tcv_ceiling_check
    CHECK (tcv IS NULL OR tcv <= 1000000),
  ADD CONSTRAINT deals_final_value_ceiling_check
    CHECK (final_value IS NULL OR final_value <= 1000000);
