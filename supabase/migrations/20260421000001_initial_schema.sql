-- =============================================================================
-- LeadFlow Jordan Sales Agent — Initial Schema
-- Migration: 20260421000001_initial_schema
-- =============================================================================
-- Multi-tenant from day 1. All tables include org_id uuid references orgs(id).
-- RLS policies enforce org_id = (auth.jwt() ->> 'org_id')::uuid on every table.
-- Service-role key (Edge Functions) bypasses RLS. User-facing queries use anon/authed key.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- TENANT ROOT
-- ---------------------------------------------------------------------------

create table orgs (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  slug       text unique not null,
  created_at timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- USERS (within an org)
-- ---------------------------------------------------------------------------

create table users (
  id         uuid primary key references auth.users(id) on delete cascade,
  org_id     uuid not null references orgs(id) on delete cascade,
  full_name  text,
  email      text,
  role       text default 'member' check (role in ('owner', 'member')),
  created_at timestamptz default now()
);

-- Auto-create org + user row on signup
-- NOTE: org slug is generated from email domain; Jordan is sole user for v1
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  v_org_id uuid;
  v_slug   text;
begin
  -- Derive slug from email or random
  v_slug := coalesce(
    lower(split_part(new.email, '@', 2)),
    'org-' || substr(new.id::text, 1, 8)
  );
  -- Ensure uniqueness
  while exists (select 1 from public.orgs where slug = v_slug) loop
    v_slug := v_slug || '-' || substr(gen_random_uuid()::text, 1, 4);
  end loop;

  -- Create org
  insert into public.orgs (name, slug)
  values (coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)), v_slug)
  returning id into v_org_id;

  -- Create user profile
  insert into public.users (id, org_id, full_name, email, role)
  values (
    new.id,
    v_org_id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    new.email,
    'owner'
  );

  -- Seed default pipeline stages for this org
  insert into public.pipeline_stages (org_id, name, position, is_closed, color) values
    (v_org_id, 'New Lead',        1, false, '#94a3b8'),
    (v_org_id, 'Contacted',       2, false, '#60a5fa'),
    (v_org_id, 'Replied',         3, false, '#34d399'),
    (v_org_id, 'Meeting Booked',  4, false, '#a78bfa'),
    (v_org_id, 'Site Visit',      5, false, '#f472b6'),
    (v_org_id, 'Demo Completed',  6, false, '#fb923c'),
    (v_org_id, 'Negotiating',     7, false, '#fbbf24'),
    (v_org_id, 'Closed Won',      8, true,  '#22c55e'),
    (v_org_id, 'Closed Lost',     9, true,  '#ef4444');

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();

-- ---------------------------------------------------------------------------
-- VENUES (hospitality venues — company-level entity)
-- ---------------------------------------------------------------------------

create table venues (
  id                     uuid primary key default gen_random_uuid(),
  org_id                 uuid not null references orgs(id) on delete cascade,
  name                   text not null,
  google_place_id        text,
  address                text,
  suburb                 text,
  state                  text default 'VIC',
  postcode               text,
  website                text,
  phone                  text,
  -- Venue classification
  venue_type             text check (venue_type in ('restaurant','cafe','hotel','event_space','bar','club','pub')),
  service_style          text check (service_style in ('fine_dining','casual','fast_casual','pub_bistro','events')),
  -- Hospitality-specific fields (moat vs generic CRMs)
  cover_count            int,              -- seating capacity — influences email personalisation
  kitchen_type           text check (kitchen_type in ('full_kitchen','prep_only','cold_only','none')),
  competitor_water_usage text check (competitor_water_usage in ('bottled','tap','purezza','other_filtered','unknown')),
  licensing_status       text check (licensing_status in ('licensed','unlicensed','pending','unknown')),
  seasonality_window     text,             -- e.g. 'nov-apr' for Mornington Peninsula
  -- ICP scoring
  icp_score              int check (icp_score between 0 and 100),
  -- Source tracking
  source                 text check (source in ('google_places','csv_import','linkedin_import','manual','signal')),
  source_details         jsonb,
  is_excluded            boolean default false,  -- fast-food chains etc
  notes                  text,
  created_at             timestamptz default now(),
  updated_at             timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- CONTACTS (decision-makers at venues — person-level entity)
-- ---------------------------------------------------------------------------

create table contacts (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references orgs(id) on delete cascade,
  venue_id     uuid references venues(id) on delete set null,
  full_name    text not null,
  role         text check (role in ('venue_manager','owner','f_b_director','head_chef','events_manager')),
  email        text,
  phone        text,
  linkedin_url text,
  is_primary   boolean default false,  -- primary decision-maker at venue
  notes        text,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- PIPELINE STAGES (configurable per org)
-- ---------------------------------------------------------------------------

create table pipeline_stages (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references orgs(id) on delete cascade,
  name       text not null,
  position   int not null,
  is_closed  boolean default false,
  color      text,
  created_at timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- DEALS (pipeline opportunity — links venue + contact + stage)
-- ---------------------------------------------------------------------------

create table deals (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references orgs(id) on delete cascade,
  venue_id         uuid references venues(id) on delete set null,
  contact_id       uuid references contacts(id) on delete set null,
  stage_id         uuid references pipeline_stages(id) on delete set null,
  title            text,
  contract_value   numeric(10,2) default 800,   -- $800 commission per close
  contract_months  int,                          -- 36 or 48 month agreement
  follow_up_due    timestamptz,
  last_touch_at    timestamptz,
  closed_at        timestamptz,
  lost_reason      text,
  notes            text,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- ACTIVITIES (unified timeline — email/call/note/meeting per deal)
-- ---------------------------------------------------------------------------

create table activities (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references orgs(id) on delete cascade,
  deal_id       uuid references deals(id) on delete set null,
  contact_id    uuid references contacts(id) on delete set null,
  activity_type text not null check (activity_type in (
    'email_sent','email_opened','email_clicked','reply_received',
    'call_note','meeting_note','task_completed','stage_change',
    'bounce','unsubscribe'
  )),
  subject       text,
  body          text,
  metadata      jsonb,  -- sendgrid message_id, open counts, click URLs, In-Reply-To header, etc.
  occurred_at   timestamptz default now(),
  created_at    timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- SEQUENCES (email campaign templates)
-- ---------------------------------------------------------------------------

create table sequences (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references orgs(id) on delete cascade,
  name        text not null,  -- '3-Stage Purezza Cold Outreach'
  description text,
  is_active   boolean default true,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- Individual steps within a sequence
create table sequence_steps (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references orgs(id) on delete cascade,
  sequence_id      uuid references sequences(id) on delete cascade,
  step_number      int not null,  -- 1 (cold), 2 (soft follow-up), 3 (yes/no close)
  delay_days       int not null,  -- days after previous step
  subject_template text,
  body_template    text,          -- Handlebars vars: {{venue_name}}, {{contact_first_name}}, {{ai_hook}}, {{calendly_link}}
  step_type        text default 'email',
  stop_on_reply    boolean default true,
  stop_on_meeting  boolean default true,
  created_at       timestamptz default now()
);

-- Tracks which deal is enrolled in which sequence at which step
create table sequence_enrollments (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references orgs(id) on delete cascade,
  deal_id               uuid references deals(id) on delete cascade,
  sequence_id           uuid references sequences(id) on delete cascade,
  current_step          int default 1,
  status                text default 'active' check (status in (
    'active','paused','completed','stopped_reply','stopped_meeting','stopped_manual'
  )),
  next_send_at          timestamptz,
  processing_started_at timestamptz,  -- optimistic lock for concurrency control
  enrolled_at           timestamptz default now(),
  completed_at          timestamptz,
  step_snapshots        jsonb          -- snapshot of steps at enrollment time (prevents mid-run template surprises)
);

-- Prevent double-enrollment: a deal can only be in a given sequence once when active
-- TODO(week-5): Verify this index is used correctly in sequence-trigger worker
create unique index on sequence_enrollments(deal_id, sequence_id)
  where status = 'active';

-- ---------------------------------------------------------------------------
-- TASKS / REMINDERS
-- ---------------------------------------------------------------------------

create table tasks (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references orgs(id) on delete cascade,
  deal_id      uuid references deals(id) on delete set null,
  contact_id   uuid references contacts(id) on delete set null,
  title        text not null,
  description  text,
  due_at       timestamptz,
  completed_at timestamptz,
  task_type    text check (task_type in ('follow_up','call','review_reply','review_draft','general')),
  created_at   timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- LEAD SCORES (hot/warm/cold — history)
-- ---------------------------------------------------------------------------

create table lead_scores (
  id        uuid primary key default gen_random_uuid(),
  org_id    uuid not null references orgs(id) on delete cascade,
  deal_id   uuid references deals(id) on delete cascade,
  score     int not null check (score between 0 and 100),
  tier      text not null check (tier in ('hot','warm','cold')),
  factors   jsonb,  -- breakdown: opens, clicks, reply_days_ago, stage, etc.
  scored_at timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- TIMING SIGNALS (new venue openings, leadership changes)
-- ---------------------------------------------------------------------------

create table signals (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references orgs(id) on delete cascade,
  venue_id      uuid references venues(id) on delete set null,
  contact_id    uuid references contacts(id) on delete set null,  -- required for leadership_change signals
  signal_type   text not null check (signal_type in ('new_venue_opening','leadership_change','instagram_activity')),
  signal_source text not null check (signal_source in ('vcglr','proxycurl','instagram','manual')),
  headline      text,       -- e.g. "New liquor licence issued: Fitzroy Wine Bar"
  detail        jsonb,      -- raw signal data; VCGLR must include licence_number as dedup key
  detected_at   timestamptz default now(),
  actioned_at   timestamptz,
  is_actioned   boolean default false
);

-- Prevent duplicate VCGLR signals — use licence_number as stable dedup key
-- TODO(week-7): Validate VCGLR data includes licence_number before relying on this (GATE-5)
create unique index on signals(org_id, signal_source, (detail->>'licence_number'))
  where signal_source = 'vcglr' and detail->>'licence_number' is not null;

-- ---------------------------------------------------------------------------
-- AUTO-SOURCED VENUE CANDIDATES (awaiting Jordan's review)
-- ---------------------------------------------------------------------------

create table auto_sourced_candidates (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references orgs(id) on delete cascade,
  google_place_id  text unique,
  raw_data         jsonb,            -- full Places API response
  name             text,
  address          text,
  suburb           text,
  venue_type_guess text,
  icp_score_guess  int,
  status           text default 'pending' check (status in ('pending','accepted','rejected')),
  reviewed_at      timestamptz,
  created_at       timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- EMAIL DRAFTS (AI-generated, awaiting Jordan's approval)
-- ---------------------------------------------------------------------------

create table email_drafts (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references orgs(id) on delete cascade,
  deal_id         uuid references deals(id) on delete set null,
  contact_id      uuid references contacts(id) on delete set null,
  draft_type      text not null check (draft_type in ('cold_outreach','follow_up_soft','follow_up_close','reply')),
  subject         text,
  body            text,
  prompt_context  jsonb,   -- what the AI was given to generate this draft
  status          text default 'pending' check (status in ('pending','approved','edited','rejected','sent','draft_failed')),
  sent_at         timestamptz,
  sendgrid_msg_id text,    -- TODO(week-4): Populate from Instantly.ai/SendGrid on send
  created_at      timestamptz default now()
);

-- Jordan's edits to AI drafts (the learning loop)
-- Every edit logged: original vs edited text + word diff for pattern extraction
create table draft_edits (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references orgs(id) on delete cascade,
  draft_id   uuid references email_drafts(id) on delete cascade,
  original   text,
  edited     text,
  edit_delta jsonb,  -- { before: string, after: string, word_diff: array } — deterministic, not LLM
  created_at timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- SUPPRESSION LIST (Spam Act 2003 compliance)
-- ---------------------------------------------------------------------------

create table suppression_list (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references orgs(id) on delete cascade,
  email         text not null check (email = lower(email)),  -- always store lowercased
  reason        text not null check (reason in ('bounce_hard','bounce_soft','unsubscribe','spam_complaint')),
  source        text check (source in ('sendgrid_webhook','instantly_webhook','manual')),
  suppressed_at timestamptz default now()
);

-- Case-insensitive unique constraint (strip +aliases at app layer before insert)
create unique index on suppression_list(org_id, lower(email));

-- ---------------------------------------------------------------------------
-- WORKER RUN LOG (observability — every background worker logs here)
-- ---------------------------------------------------------------------------

create table worker_runs (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid references orgs(id) on delete set null,  -- null for system-level workers
  worker_name      text not null,  -- 'briefing-worker'|'sequence-trigger'|'scoring-worker' etc
  started_at       timestamptz default now(),
  completed_at     timestamptz,
  status           text check (status in ('running','success','success_empty','failed','partial')),
  items_processed  int default 0,
  error_message    text,
  metadata         jsonb   -- e.g. { sections: { replies: 2, followups: 3 }, sendgrid_msg_id: '...' }
);

create index on worker_runs(worker_name, started_at desc);

-- ---------------------------------------------------------------------------
-- CALENDLY EVENTS (meeting booking webhooks)
-- ---------------------------------------------------------------------------

create table calendly_events (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references orgs(id) on delete cascade,
  deal_id        uuid references deals(id) on delete set null,
  event_type     text check (event_type in ('invitee.created','invitee.canceled')),
  invitee_email  text,
  event_start    timestamptz,
  raw_payload    jsonb,
  received_at    timestamptz default now(),
  -- Prevent double-fire from Calendly
  unique (invitee_email, event_start)
);

-- =============================================================================
-- INDEXES (performance — key query patterns)
-- =============================================================================

create index on venues(org_id, icp_score desc);
create index on venues(org_id, licensing_status);
create index on contacts(org_id, venue_id);
create index on deals(org_id, stage_id);
create index on deals(org_id, follow_up_due);
create index on deals(org_id, last_touch_at desc);
create index on activities(deal_id, occurred_at desc);
create index on activities(org_id, activity_type, occurred_at desc);
create index on email_drafts(org_id, status) where status = 'pending';
create index on signals(org_id, is_actioned) where not is_actioned;
create index on auto_sourced_candidates(org_id, status) where status = 'pending';
create index on suppression_list(org_id, email);
create index on lead_scores(deal_id, scored_at desc);
-- Dedup guard for SendGrid duplicate webhook delivery (index at app layer)
-- TODO(week-4): Add unique index on activities(org_id, (metadata->>'sg_message_id'), activity_type)

-- =============================================================================
-- UPDATED_AT TRIGGER (auto-update updated_at on row change)
-- =============================================================================

create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger set_venues_updated_at   before update on venues   for each row execute procedure set_updated_at();
create trigger set_contacts_updated_at before update on contacts for each row execute procedure set_updated_at();
create trigger set_deals_updated_at    before update on deals    for each row execute procedure set_updated_at();
create trigger set_sequences_updated_at before update on sequences for each row execute procedure set_updated_at();
