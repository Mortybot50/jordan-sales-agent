-- =============================================================================
-- LeadFlow — pattern-guess attempt marker
-- Migration: 20260714033442_venue_guess_attempted_at
-- =============================================================================
-- Additive, nullable, no data loss, RLS untouched, no permission changes.
--
-- venues.guess_attempted_at records WHEN enrich-venue-contacts last ran the
-- pattern-guess-then-verify step against a venue. Without it, the guess batch
-- re-selects the same highest-icp_score venues every run and re-spends
-- ZeroBounce credits on venues that already returned invalid / role-only /
-- catch-all — while starving every venue past the first `limit` rows.
--
-- The guess batch now filters `guess_attempted_at IS NULL`, so each run drains
-- a fresh slice of the backlog. Only a genuine verification attempt (or a
-- no-candidate / already-deliverable determination) sets the marker; an
-- out-of-credits / provider-error pause leaves it NULL so the venue re-queues
-- when credits return. Provenance only; never gates outreach.
-- =============================================================================

alter table public.venues
  add column if not exists guess_attempted_at timestamptz;

comment on column public.venues.guess_attempted_at is
  'When enrich-venue-contacts last ran pattern-guess-then-verify for this venue. '
  'NULL = never attempted (or a credits/provider pause left it re-queued). '
  'Bounds ZeroBounce credit spend and stops batch starvation. Never gates outreach.';

-- ---------------------------------------------------------------------------
-- Probe: column exists.
-- ---------------------------------------------------------------------------
do $$
declare has_col int;
begin
  select count(*) into has_col
    from information_schema.columns
   where table_schema = 'public' and table_name = 'venues'
     and column_name = 'guess_attempted_at';
  if has_col < 1 then
    raise exception 'guess_attempted_at column was not created';
  end if;
end $$;
