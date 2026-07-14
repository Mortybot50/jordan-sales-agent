-- Backfill venues.venue_type from source_details.category / .subtypes for
-- venues that landed in the table BEFORE the discover-leads venue_type
-- seeding shipped (2026-06-09). Pre-ship Outscraper inserts left both
-- venue_type AND source_details NULL, so the morning cold-outreach batch
-- on 2026-06-09 had to be hand-classified to unblock Variant A selection.
--
-- This migration mirrors the TypeScript classifier at
--   supabase/functions/_shared/venue-type-mapper.ts
-- in SQL (POSIX regex with `\m`/`\M` word boundaries). If you change the
-- priority order or add a needle there, mirror it here in the same order.
--
-- Idempotent: only touches rows where venue_type IS NULL AND source_details
-- has at least one of `category` / `subtypes`. Safe to re-run; subsequent
-- runs will be no-ops until new candidate rows appear.
--
-- Until discover-leads has run enough times to populate source_details on
-- pre-existing venues (or a re-sync writes those fields in), this migration
-- will be a NO-OP — the 60 Outscraper-sourced venues from before 2026-06-09
-- all have source_details = NULL. That is expected. Ship anyway so the
-- backfill runs against future-populated rows automatically.
--
-- Rollback: there is no schema change to revert. To clear a backfill, run
--   update venues set venue_type = null where ... -- with a narrow filter.
-- (Manual; not a migration.)

do $$
declare
  total_scanned int := 0;
  total_updated int := 0;
  breakdown record;
begin
  select count(*) into total_scanned
  from venues
  where venue_type is null
    and source_details is not null
    and (
      source_details ->> 'category' is not null
      or source_details ->> 'subtypes' is not null
    );

  raise notice 'venue_type backfill: % candidate venues to scan', total_scanned;

  if total_scanned = 0 then
    raise notice 'venue_type backfill: nothing to do — exiting';
    return;
  end if;

  -- Classify and update in a single CTE-driven UPDATE. The CASE chain is the
  -- SQL mirror of the TS classifier's RULES list — keep both in sync.
  --
  -- POSIX-regex notes:
  --   \m  = word-boundary start (transition non-word → word)
  --   \M  = word-boundary end   (transition word → non-word)
  --   ~   = case-sensitive match (we lowercase the haystack first)
  --
  -- Underscore normalisation: PostgreSQL's POSIX regex treats `_` as a word
  -- character, so `\mclub\M` would NOT match inside `night_club`. The TS
  -- mapper's matchesNeedle() uses `\p{L}\p{N}` for word chars (no underscore)
  -- and treats `_` as a separator. We normalise underscores to spaces here so
  -- the two engines classify Google Places types like `night_club` /
  -- `meal_takeaway` consistently.
  with candidates as (
    select
      id,
      replace(
        lower(
          concat_ws(
            ' | ',
            source_details ->> 'category',
            source_details ->> 'subtypes'
          )
        ),
        '_',
        ' '
      ) as blob
    from venues
    where venue_type is null
      and source_details is not null
      and (
        source_details ->> 'category' is not null
        or source_details ->> 'subtypes' is not null
      )
  ),
  classified as (
    select
      id,
      case
        when blob ~ '\m(wine bar|cocktail bar|sports bar)\M' then 'bar'
        when blob ~ '\mbar\M'                                 then 'bar'
        when blob ~ '\m(gastropub|irish pub)\M'               then 'pub'
        when blob ~ '\mpub\M'                                 then 'pub'
        when blob ~ '\mhotel\M'                               then 'hotel'
        when blob ~ '\minn\M'                                 then 'hotel'
        when blob ~ '\m(nightclub|night club)\M'              then 'club'
        when blob ~ '\mclub\M'                                then 'club'
        when blob ~ '\mcoffee shop\M'                         then 'cafe'
        when blob ~ '\m(café|cafe)\M'                         then 'cafe'
        when blob ~ '\mcoffee\M'                              then 'cafe'
        when blob ~ '\m(fast food restaurant|fast food)\M'    then 'qsr'
        when blob ~ '\m(qsr|takeaway|take-out)\M'             then 'qsr'
        when blob ~ '\m(pizza restaurant|italian restaurant|mexican restaurant|asian restaurant)\M' then 'restaurant'
        when blob ~ '\mrestaurant\M'                          then 'restaurant'
        when blob ~ '\m(wedding venue|event venue|function centre|function center|banquet hall)\M' then 'function_centre'
        when blob ~ '\m(event space|meeting room|conference centre)\M' then 'event_space'
        else null
      end as new_type
    from candidates
  )
  update venues v
  set venue_type = c.new_type,
      updated_at = now()
  from classified c
  where v.id = c.id
    and c.new_type is not null
    and v.venue_type is null;  -- belt-and-braces idempotency guard

  get diagnostics total_updated = row_count;

  raise notice 'venue_type backfill: % venues updated (of % scanned, % left null)',
    total_updated, total_scanned, total_scanned - total_updated;

  -- Final per-venue_type breakdown across the whole table.
  for breakdown in
    select venue_type, count(*) as n
    from venues
    where venue_type is not null
    group by venue_type
    order by venue_type
  loop
    raise notice 'venue_type backfill totals: % now classified as %',
      breakdown.n, breakdown.venue_type;
  end loop;
end $$;
