-- =============================================================================
-- Temperature backfill for non-PST deals (the PST cohort was set by
-- 20260612071902_pst_retriage). Stage-based defaults for rows the classifier
-- has no activity history for — auto-source, so any future derivation or a
-- manual call by Jordan freely overrides.
--   Meeting Booked / Site Visit -> hot   (a meeting IS the hot signal)
--   Replied                     -> warm
--   everything else open        -> cold
--   closed stages               -> left NULL (heat is meaningless there)
-- =============================================================================

update public.deals d
   set temperature = case
         when s.name in ('Meeting Booked', 'Site Visit') then 'hot'
         when s.name = 'Replied' then 'warm'
         else 'cold'
       end,
       temperature_source = 'auto'
  from public.pipeline_stages s
 where s.id = d.stage_id
   and d.temperature is null
   and s.is_closed = false;
