-- P0-2: Add a $1M ceiling on every monetary column on deals.
--
-- A seed deal at $99,999,999.99 (the "[WALK-26APR] Mega-value (numeric ceiling)"
-- row) leaked into the dashboard's open-pipeline tile as $100M after the
-- 25/04/2026 walkthrough seed pass. Realistic hospitality cold-outreach deals
-- top out well under $200k; $1M leaves >5x headroom for any imaginable
-- multi-year package and still catches the "$5,000 → $5,000,000" typo class.
--
-- The single offending row was deleted in the same change. This migration is
-- idempotent (safe to re-run) and refuses to apply if ANY surviving row would
-- violate the ceiling, so it can never half-apply against drifted data.
--
-- Rollback:
--   ALTER TABLE public.deals
--     DROP CONSTRAINT IF EXISTS deals_contract_value_ceiling_check,
--     DROP CONSTRAINT IF EXISTS deals_acv_ceiling_check,
--     DROP CONSTRAINT IF EXISTS deals_tcv_ceiling_check,
--     DROP CONSTRAINT IF EXISTS deals_final_value_ceiling_check;

-- 1. Preflight — fail loud if existing data would violate the ceiling, with a
--    count + the offending ids, rather than letting ADD CONSTRAINT throw an
--    opaque check_violation mid-statement.
do $$
declare
  v_bad bigint;
  v_ids text;
begin
  select count(*),
         coalesce(string_agg(id::text, ', ' order by id), '')
    into v_bad, v_ids
  from public.deals
  where coalesce(contract_value, 0) > 1000000
     or coalesce(acv, 0)            > 1000000
     or coalesce(tcv, 0)            > 1000000
     or coalesce(final_value, 0)    > 1000000;

  if v_bad > 0 then
    raise exception
      'deals_value_ceiling preflight: % deal row(s) exceed the $1M ceiling and must be corrected before this migration can apply. Offending ids: %',
      v_bad, v_ids
      using errcode = 'check_violation';
  end if;
end $$;

-- 2. Constraints — idempotent: drop-if-exists before add so a re-run (or a
--    partial earlier apply) reconverges cleanly.
alter table public.deals
  drop constraint if exists deals_contract_value_ceiling_check,
  drop constraint if exists deals_acv_ceiling_check,
  drop constraint if exists deals_tcv_ceiling_check,
  drop constraint if exists deals_final_value_ceiling_check;

alter table public.deals
  add constraint deals_contract_value_ceiling_check
    check (contract_value is null or contract_value <= 1000000),
  add constraint deals_acv_ceiling_check
    check (acv is null or acv <= 1000000),
  add constraint deals_tcv_ceiling_check
    check (tcv is null or tcv <= 1000000),
  add constraint deals_final_value_ceiling_check
    check (final_value is null or final_value <= 1000000);
