-- =============================================================================
-- Deal Drawer Rebuild (2026-06-10)
--
-- Adds explainable win-probability + conversation-recap columns to deals, plus a
-- scheduled_send_at hook on email_drafts for the new "Schedule follow-up" CTA.
--
-- Column naming: deliberately uses `win_probability` (not `lead_score`) because
-- the existing Deal type already exposes a derived `lead_score` field joined
-- from the lead_scores history table, used by 5+ files (ScoreBadge, sort,
-- filter on Contacts + Pipeline list). The new column is a different concept:
-- a rule-based, explainable win probability computed at backfill time and
-- editable via UI later. Names match the UI label ("Win Probability: 75%").
--
-- All columns are nullable + non-defaulted — won't break existing inserts.
-- =============================================================================

alter table public.deals
  add column if not exists thread_excerpt jsonb,
  add column if not exists win_probability int,
  add column if not exists win_probability_breakdown jsonb;

alter table public.deals
  drop constraint if exists deals_win_probability_range;
alter table public.deals
  add constraint deals_win_probability_range
    check (win_probability is null or (win_probability between 0 and 100));

comment on column public.deals.thread_excerpt is
  'Last-message thread context from PST import. JSONB shape: { subject, last_from, last_body, last_date, msg_count_inbound, msg_count_outbound, full_recent }. Populated by scripts/backfill-deal-thread-excerpt.py.';

comment on column public.deals.win_probability is
  'Explainable rule-based win probability (0-100). Drives the progress bar at the top of DealDrawer. Distinct from the lead_scores history table (hot/warm/cold tiering used elsewhere). NULL when uncomputed.';

comment on column public.deals.win_probability_breakdown is
  'JSONB array of { rule, weight, applied, detail? } records explaining how win_probability was computed. Drives the tap-to-expand breakdown popover.';

alter table public.email_drafts
  add column if not exists scheduled_send_at timestamptz;

comment on column public.email_drafts.scheduled_send_at is
  'User-scheduled send time set from the Schedule Follow-up CTA in DealDrawer. NULL = not scheduled. Auto-send worker (separate PR) will consume this column.';
