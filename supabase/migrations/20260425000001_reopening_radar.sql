-- =============================================================================
-- LeadFlow Jordan Sales Agent — Reopening Radar
-- Migration: 20260425000001_reopening_radar
-- =============================================================================
-- Watches for VIC venues that move from CLOSED → ACTIVE (or change
-- licensee / change name at the same address) and flags them as fresh
-- reopening events for Jordan to pick up.
--
-- Multi-tenant from day 1 — org_id on every row, full RLS.
-- Note: orgs table (not "organizations") — schema was established in
-- 20260421000001_initial_schema.sql.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- VENUE OBSERVATIONS (snapshots of licence/status per source per venue)
-- ---------------------------------------------------------------------------

create table venue_observations (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references orgs(id) on delete cascade,
  source           text not null check (source in ('vcglr','google_places','manual')),
  external_id      text,                 -- VCGLR licence number, Google place_id, null for manual
  venue_name       text not null,
  address          text,
  suburb           text,
  licence_type     text,
  licence_number   text,
  licensee         text,
  business_status  text not null check (business_status in (
    'ACTIVE','CLOSED_PERMANENTLY','CLOSED_TEMPORARILY','SUSPENDED'
  )),
  observed_at      timestamptz not null default now(),
  evidence_url     text,
  raw              jsonb,
  created_at       timestamptz default now()
);

create index on venue_observations (org_id, source, external_id, observed_at desc);
create index on venue_observations (org_id, observed_at desc);

-- ---------------------------------------------------------------------------
-- REOPENING EVENTS (detected transitions — the actionable signal)
-- ---------------------------------------------------------------------------

create table reopening_events (
  id                        uuid primary key default gen_random_uuid(),
  org_id                    uuid not null references orgs(id) on delete cascade,
  venue_observation_prior   uuid references venue_observations(id) on delete set null,
  venue_observation_new     uuid not null references venue_observations(id) on delete cascade,
  event_type                text not null check (event_type in (
    'reopened','licensee_changed','renamed','status_flip','manual'
  )),
  detected_at               timestamptz not null default now(),
  dismissed_at              timestamptz,
  contact_id                uuid references contacts(id) on delete set null,
  created_at                timestamptz default now()
);

-- Primary query path: "undismissed, unconverted events for my org, newest first"
create index on reopening_events (org_id, detected_at desc)
  where dismissed_at is null and contact_id is null;

create index on reopening_events (org_id, detected_at desc);

-- ---------------------------------------------------------------------------
-- CONTACTS — signal_reopening payload so the pipeline card can pill it
-- ---------------------------------------------------------------------------

alter table contacts
  add column if not exists signal_reopening jsonb;

-- =============================================================================
-- RLS — same pattern as every other table (auth_org_id() helper)
-- =============================================================================

alter table venue_observations enable row level security;

create policy "venue_observations_select" on venue_observations
  for select using (org_id = auth_org_id());

create policy "venue_observations_insert" on venue_observations
  for insert with check (org_id = auth_org_id());

-- No user-side update/delete — observations are immutable audit records.
-- Service-role (Edge Fns) bypass RLS for the polling worker.

alter table reopening_events enable row level security;

create policy "reopening_events_select" on reopening_events
  for select using (org_id = auth_org_id());

create policy "reopening_events_insert" on reopening_events
  for insert with check (org_id = auth_org_id());

create policy "reopening_events_update" on reopening_events
  for update using (org_id = auth_org_id())
  with check (org_id = auth_org_id());

-- No delete — dismissal uses `dismissed_at` soft-delete.
