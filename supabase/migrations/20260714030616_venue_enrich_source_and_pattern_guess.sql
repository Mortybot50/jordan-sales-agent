-- =============================================================================
-- LeadFlow — in-house email enrichment: provenance + pattern-guess source
-- Migration: 20260714030616_venue_enrich_source_and_pattern_guess
-- =============================================================================
-- Two additive changes, no data loss, RLS untouched, no permission changes:
--
-- 1. venues.enrich_source — records HOW a venue's website was resolved when it
--    did not arrive with one (media listings from Broadsheet / Hospitality Mag
--    / Good Food / News / VCGLR give a NAME + SUBURB only). The in-house
--    enrichment chain resolves the official website via the already-paid Google
--    Places text search; this column captures that provenance so reporting can
--    tell an organically-sourced website apart from a Places-resolved one.
--    Values used by the enrich-venue-contacts function:
--      'places_textsearch'  — resolved to a website by "<name> <suburb>" lookup
--      'places_no_website'  — Places matched the venue but it has no website
--      'places_no_match'    — Places returned no plausible match (dead-end)
--      (NULL) — website came with the original source row / not yet attempted
--    The three non-null markers double as an idempotency guard: the batch
--    resolver skips any venue whose enrich_source is already set, so a re-run
--    never re-bills Places for a venue it has already tried.
--    Kept as a free-text column (no CHECK) so a future resolver can add a value
--    without a constraint migration; the writer is the only producer.
--
-- 2. contacts_source_check widened to allow 'pattern_guess' — the source tag for
--    emails GENERATED as standard address patterns (info@, first.last@ …) for a
--    known domain and then CONFIRMED valid by ZeroBounce. A guessed address is
--    NEVER stored unless ZeroBounce returns status=valid for it, so this source
--    only ever labels a real, verified mailbox. Widening a CHECK IN-set is safe
--    (strict superset of the prior set).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. venues.enrich_source (additive, nullable)
-- ---------------------------------------------------------------------------
alter table public.venues
  add column if not exists enrich_source text;

comment on column public.venues.enrich_source is
  'How the website was resolved when the venue arrived name-only. '
  '''places_textsearch'' = resolved via Google Places "<name> <suburb>" lookup '
  'by enrich-venue-contacts. NULL = website came with the original source row. '
  'Provenance only; never gates outreach.';

-- ---------------------------------------------------------------------------
-- 2. Widen contacts_source_check to include the pattern-guess source.
--    Full existing set preserved + 'pattern_guess' appended.
-- ---------------------------------------------------------------------------
alter table public.contacts drop constraint if exists contacts_source_check;
alter table public.contacts add constraint contacts_source_check
  check (source = any (array[
    'outscraper', 'google_places', 'vcglr', 'broadsheet', 'timeout',
    'concrete_playground', 'good_food', 'urban_list', 'hospitality_mag',
    'general_news', 'fiverr_legacy', 'manual', 'salesforce_import',
    'csv_import', 'linkedin_import', 'website_crawl', 'hunter_enrich',
    'pattern_guess'
  ]));

-- ---------------------------------------------------------------------------
-- 3. Probe: enrich_source column exists.
-- ---------------------------------------------------------------------------
do $$
declare has_col int;
begin
  select count(*) into has_col
    from information_schema.columns
   where table_schema = 'public' and table_name = 'venues'
     and column_name = 'enrich_source';
  if has_col < 1 then
    raise exception 'enrich_source column was not created';
  end if;
end $$;
