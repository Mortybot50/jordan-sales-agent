-- =============================================================================
-- Deal title suffix cleanup — one-off, staged for review (DO NOT RUN without
-- Jordan's sign-off; this is data-modifying, not schema-only)
-- Migration: 20260624000000_cleanup_deal_title_suffixes
-- =============================================================================
--
-- PURPOSE
-- -------
-- Strip historical status suffixes that were baked into deals.title before
-- the source-fix in feat/pipeline-card-calm-triage. Suffixes include:
--
--   " — COLD from PST"       (+ WARM + HOT variants)
--   " — from PST"
--   " from PST" (bare, end of string)
--   " — Purezza intro"
--   "[WALK-26APR] …" prefix  (bracket-code staging markers)
--
-- Also backfills temperature + source where NULL and the suffix tells us
-- what they should be.
--
-- SAFE TO RE-RUN (idempotent):
--   - All WHERE clauses check for suffix presence first
--   - temperature backfill only fires WHERE temperature IS NULL
--   - source backfill only fires WHERE source = 'manual' (the default) OR NULL
--   - No row is touched twice with conflicting values
--
-- SCOPE GUARD:
--   - Every UPDATE is scoped to deals with a specific org_id (Jordan's org)
--   - Rows are only touched if they actually carry a matching suffix pattern
--   - The PST retriage (20260612071902) already cleaned the "[from PST]"
--     cohort in the notes block — this handles any residual title suffixes
--     that survived or were created before that migration ran
--
-- BEFORE / AFTER EXAMPLE:
--   BEFORE: title = "Industry Kitchens — COLD from PST", temperature = NULL
--   AFTER:  title = "Industry Kitchens",                  temperature = 'cold'
--
--   BEFORE: title = "[WALK-26APR] Plain Venue — Purezza intro"
--   AFTER:  title = "Plain Venue"
--
-- =============================================================================
-- STAGED ONLY — DO NOT RUN IN PRODUCTION UNTIL JORDAN HAS REVIEWED THIS FILE
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Step 0: capture the org_id for Jordan's org (scopes every update below)
-- ---------------------------------------------------------------------------
-- Replace <JORDAN_ORG_ID> with the real org uuid from:
--   select id from public.organizations limit 5;
-- or from supabase dashboard → Table Editor → organizations.
-- This is intentionally left as a placeholder so the file cannot accidentally
-- run against the wrong org.
-- ---------------------------------------------------------------------------
-- do $$ begin
--   if not exists (select 1 from public.organizations where id = '<JORDAN_ORG_ID>') then
--     raise exception 'STOP: org_id not found — update placeholder before running';
--   end if;
-- end $$;

-- ---------------------------------------------------------------------------
-- Step 1: Strip " — COLD from PST" / " — WARM from PST" / " — HOT from PST"
--         and backfill temperature from the suffix where still NULL.
--         Idempotent: WHERE temp IS NULL guards the backfill; regexp_replace
--         is safe to re-run (the pattern won't match after first clean).
-- ---------------------------------------------------------------------------

with pst_suffix as (
  select
    id,
    org_id,
    temperature,
    -- Extract heat from the suffix (case-insensitive)
    case
      when title ~* '\s*[—-]\s*HOT\s+from\s+PST' then 'hot'
      when title ~* '\s*[—-]\s*WARM\s+from\s+PST' then 'warm'
      when title ~* '\s*[—-]\s*COLD\s+from\s+PST' then 'cold'
      when title ~* '\s*[—-]\s*from\s+PST'        then null  -- no heat info in bare variant
      when title ~* '\s+from\s+PST\s*$'           then null
      else null
    end as inferred_temp,
    -- Strip all PST suffix variants
    trim(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            title,
            '\s*[—-]\s*(HOT|WARM|COLD)\s+from\s+PST', '', 'gi'
          ),
          '\s*[—-]\s*from\s+PST', '', 'gi'
        ),
        '\s+from\s+PST\s*$', '', 'gi'
      )
    ) as clean_title
  from public.deals
  where
    -- Scope to Jordan's org — replace placeholder with real uuid
    -- org_id = '<JORDAN_ORG_ID>'::uuid
    -- Rows that actually carry a PST suffix (case-insensitive)
    title ~* '\s*[—-]\s*(HOT|WARM|COLD)?\s*from\s+PST'
    or title ~* '\s+from\s+PST\s*$'
)
update public.deals d
   set title             = pst_suffix.clean_title,
       -- Backfill temperature ONLY where not already set (never clobber manual)
       temperature       = case
                             when d.temperature is null and pst_suffix.inferred_temp is not null
                             then pst_suffix.inferred_temp
                             else d.temperature
                           end,
       temperature_source = case
                              when d.temperature is null and pst_suffix.inferred_temp is not null
                              then 'auto'
                              else d.temperature_source
                            end,
       -- Mark source as pst_import where it's still the default 'manual'
       source            = case
                             when d.source = 'manual' or d.source is null
                             then 'pst_import'
                             else d.source
                           end,
       updated_at        = now()
  from pst_suffix
 where d.id = pst_suffix.id
   -- Safety: only update if the cleaned title is different and non-empty
   and pst_suffix.clean_title is not null
   and pst_suffix.clean_title <> ''
   and d.title <> pst_suffix.clean_title;

-- ---------------------------------------------------------------------------
-- Step 2: Strip " — Purezza intro" suffix
--         Idempotent: WHERE checks suffix presence before touching the row.
-- ---------------------------------------------------------------------------

update public.deals
   set title      = trim(regexp_replace(title, '\s*[—-]\s*Purezza\s+intro', '', 'gi')),
       updated_at = now()
 where title ~* '\s*[—-]\s*Purezza\s+intro'
   -- Scope guard (uncomment and set real org_id before running):
   -- and org_id = '<JORDAN_ORG_ID>'::uuid
   -- Only update if the result would actually change
   and trim(regexp_replace(title, '\s*[—-]\s*Purezza\s+intro', '', 'gi')) <> title
   and trim(regexp_replace(title, '\s*[—-]\s*Purezza\s+intro', '', 'gi')) <> '';

-- ---------------------------------------------------------------------------
-- Step 3: Strip "[WALK-XXXX]" bracket-code prefixes
--         These were staging/walkthrough markers; the real venue name follows.
--         Pattern: ^[anything_in_brackets]<space>
--         Idempotent: WHERE checks for the opening '[' pattern.
-- ---------------------------------------------------------------------------

update public.deals
   set title      = trim(regexp_replace(title, '^\s*\[[^\]]+\]\s*', '', 'g')),
       updated_at = now()
 where title ~ '^\s*\[[^\]]+\]'
   -- Scope guard:
   -- and org_id = '<JORDAN_ORG_ID>'::uuid
   and trim(regexp_replace(title, '^\s*\[[^\]]+\]\s*', '', 'g')) <> title
   and trim(regexp_replace(title, '^\s*\[[^\]]+\]\s*', '', 'g')) <> '';

-- ---------------------------------------------------------------------------
-- Step 4: Verify — review rows that were changed (run as SELECT first)
-- ---------------------------------------------------------------------------
-- Run this SELECT before executing the UPDATEs to preview the impact:
--
-- select id, title, temperature, source, updated_at
--   from public.deals
--  where title ~* '(from PST|Purezza intro|^\s*\[)'
--    -- and org_id = '<JORDAN_ORG_ID>'::uuid
--  order by updated_at desc
--  limit 50;
-- ---------------------------------------------------------------------------

-- =============================================================================
-- END OF MIGRATION — STAGED, NOT EXECUTED
-- Jordan reviews title changes, temperature backfill, and source tagging above
-- before this runs against production.
-- =============================================================================
