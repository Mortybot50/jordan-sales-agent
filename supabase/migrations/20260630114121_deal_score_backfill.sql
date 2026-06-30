-- Canonical per-deal lead score (0–100), banded within temperature tier.
-- Pairs with the tier/score sync fix: tier = deals.temperature, score =
-- deals.score. Contacts list, dashboard + detail page all read these, matching
-- the Kanban (which already reads temperature). See plan:
-- tier-score-sync-fix-2026-06-30.md
--
-- Idempotent: the column is added only if absent, the CHECK is added only if
-- absent, and the backfill only writes rows where score IS NULL — so a re-run
-- is a no-op and never overwrites an existing (incl. future manual) score.
-- temperature is NOT touched, so manually-set tiers (temperature_source =
-- 'manual') are preserved.

begin;

-- 1. Score column + range guard.
alter table public.deals
  add column if not exists score integer;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'deals_score_range'
  ) then
    alter table public.deals
      add constraint deals_score_range check (score is null or (score >= 0 and score <= 100));
  end if;
end$$;

-- 2. Backfill score from the same import signals used for tiering, banded so
--    tier + score can never disagree:
--      hot  -> 80 + 20 * sig   (80–100)
--      warm -> 50 + 29 * sig   (50–79)
--      cold ->  0 + 49 * sig   (0–49)
--    sig = clamp01(0.6 * wpNorm + 0.4 * recencyNorm)
--      wpNorm     = clamp01((win_probability - 15) / 70), null -> 0.5
--      recencyNorm from days since last_touch_at:
--                   <=14 -> 1.0, >=180 -> 0.0, linear between, null -> 0.3
update public.deals d
set score = case d.temperature
      when 'hot'  then round(80 + 20 * s.sig)::int
      when 'warm' then round(50 + 29 * s.sig)::int
      when 'cold' then round(0  + 49 * s.sig)::int
    end
from (
  select
    id,
    least(1.0, greatest(0.0, 0.6 * wp_norm + 0.4 * recency_norm)) as sig
  from (
    select
      id,
      least(1.0, greatest(0.0,
        coalesce((win_probability - 15)::numeric / 70.0, 0.5)
      )) as wp_norm,
      case
        when last_touch_at is null then 0.3
        when extract(epoch from (now() - last_touch_at)) / 86400.0 <= 14 then 1.0
        when extract(epoch from (now() - last_touch_at)) / 86400.0 >= 180 then 0.0
        else 1.0 - (extract(epoch from (now() - last_touch_at)) / 86400.0 - 14) / (180.0 - 14)
      end as recency_norm
    from public.deals
  ) n
) s
where s.id = d.id
  and d.temperature is not null
  and d.score is null;

commit;
