-- =============================================================================
-- Deal temperature (hot / warm / cold)
-- Migration: 20260612071247_deal_temperature
-- =============================================================================
-- Jordan's at-a-glance kanban needs a temperature chip per card. Placement
-- decision: DEALS, not contacts — the kanban card is a deal, one contact can
-- hold several deals at different heat, and every derivation input (inbound
-- replies, meetings, PST import metadata) is deal-scoped. lead_scores set the
-- precedent (also deal-scoped).
--
-- temperature_source records who set it:
--   'auto'   — derived by the classifier (re-derivation MAY update it)
--   'manual' — Jordan overrode it (re-derivation must NEVER clobber it)
-- =============================================================================

alter table public.deals
  add column if not exists temperature text
    check (temperature in ('hot', 'warm', 'cold')),
  add column if not exists temperature_source text not null default 'auto'
    check (temperature_source in ('auto', 'manual'));

comment on column public.deals.temperature is
  'Lead heat for the kanban chip. NULL = never derived. hot=positive-intent inbound or meeting/visit within 60d; warm=any inbound reply ever; cold=outbound only / never contacted.';
comment on column public.deals.temperature_source is
  'auto = classifier-derived (re-derivable). manual = operator override (never clobbered by re-derivation).';

-- Board filters by temperature on every render.
create index if not exists deals_org_temperature_idx
  on public.deals (org_id, temperature);
