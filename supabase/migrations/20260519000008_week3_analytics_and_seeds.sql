-- =============================================================================
-- LeadFlow native sender — Week 3 analytics + cutover prep.
-- Migration: 20260519000008_week3_analytics_and_seeds
-- =============================================================================
-- Lands:
--   1. compute_inbox_reputation(uuid) — deterministic 0-100 score per inbox
--      based on last 14 days of email_send_events.
--   2. inbox_placement_seeds         — daily seed-test addresses + manual
--                                      placement records (inbox / promos / spam).
--   3. postmaster_grades             — manual record of Postmaster Tools grade
--                                      per sending domain per day.
--   4. cron: leadflow-reputation-refresh — hourly job that writes
--      compute_inbox_reputation() into email_accounts.reputation_score.
--
-- All RLS scoped via auth_org_id() / auth.uid() to match the existing
-- multi-tenant pattern (see 20260519000001).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. compute_inbox_reputation — deterministic score.
--    < 10 sends in window → return 50 (insufficient data baseline).
--    Otherwise:
--      100
--        - (bounce_rate_pct  *  5)
--        - (complain_rate_pct * 20)
--        + min(reply_rate_pct, 25)        ← capped bonus, no penalty
--    Clamped to [0, 100], rounded to 1 decimal.
-- ---------------------------------------------------------------------------
create or replace function public.compute_inbox_reputation(p_account_id uuid)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_sent       int;
  v_bounced    int;
  v_replied    int;
  v_complained int;
  v_score      numeric;
begin
  select
    count(*) filter (where event_type = 'sent'),
    count(*) filter (where event_type = 'bounced'),
    count(*) filter (where event_type = 'replied'),
    count(*) filter (where event_type = 'spam_complaint')
  into v_sent, v_bounced, v_replied, v_complained
  from public.email_send_events
  where email_account_id = p_account_id
    and event_at > now() - interval '14 days';

  if v_sent < 10 then
    return 50.0;
  end if;

  v_score := 100.0
    - (v_bounced::numeric    / v_sent * 100.0 *  5.0)
    - (v_complained::numeric / v_sent * 100.0 * 20.0)
    + least(v_replied::numeric / v_sent * 100.0, 25.0);

  return greatest(0.0, least(100.0, round(v_score, 1)));
end $$;

revoke all on function public.compute_inbox_reputation(uuid) from public;
grant execute on function public.compute_inbox_reputation(uuid) to authenticated, service_role;

comment on function public.compute_inbox_reputation(uuid) is
  'Deterministic inbox reputation 0-100 based on last 14 days of '
  'email_send_events. Returns 50 if < 10 sends in window. Bounce x5 weight, '
  'spam_complaint x20 weight, reply bonus capped at +25.';

-- ---------------------------------------------------------------------------
-- 2. inbox_placement_seeds — daily seed test sends + manual placement.
-- ---------------------------------------------------------------------------
create table if not exists public.inbox_placement_seeds (
  id                     uuid primary key default gen_random_uuid(),
  org_id                 uuid not null references public.orgs(id) on delete cascade,
  user_id                uuid not null references public.users(id) on delete cascade,
  domain                 text not null,
  seed_address           text not null,
  seed_provider          text not null
                         check (seed_provider in (
                           'hotmail','outlook','gmail_personal','protonmail','yahoo'
                         )),
  sent_at                timestamptz not null default now(),
  placement              text
                         check (placement in ('inbox','promotions','spam','unknown')),
  placement_recorded_at  timestamptz,
  created_at             timestamptz not null default now()
);

create index if not exists inbox_placement_seeds_org_sent_idx
  on public.inbox_placement_seeds (org_id, sent_at desc);

create index if not exists inbox_placement_seeds_domain_sent_idx
  on public.inbox_placement_seeds (org_id, domain, sent_at desc);

alter table public.inbox_placement_seeds enable row level security;

create policy "inbox_placement_seeds_select" on public.inbox_placement_seeds
  for select using (org_id = public.auth_org_id());

create policy "inbox_placement_seeds_insert" on public.inbox_placement_seeds
  for insert with check (
    org_id = public.auth_org_id() and user_id = auth.uid()
  );

create policy "inbox_placement_seeds_update" on public.inbox_placement_seeds
  for update using (org_id = public.auth_org_id())
  with check (org_id = public.auth_org_id());

create policy "inbox_placement_seeds_delete" on public.inbox_placement_seeds
  for delete using (org_id = public.auth_org_id());

comment on table public.inbox_placement_seeds is
  'Daily seed-test sends to user-controlled seed addresses across major '
  'providers. Placement is manually recorded by the user after they check '
  'each seed inbox 5-10 minutes after send.';

-- ---------------------------------------------------------------------------
-- 3. postmaster_grades — manual record of Postmaster Tools grade per domain.
--    Revision 2 explicitly bans an automated postmaster API poller; the user
--    visits https://postmaster.google.com weekly, reads the grade, and
--    pastes it here.
-- ---------------------------------------------------------------------------
create table if not exists public.postmaster_grades (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.orgs(id) on delete cascade,
  user_id       uuid not null references public.users(id) on delete cascade,
  domain        text not null,
  grade         text not null
                check (grade in ('High','Medium','Low','Bad','Unknown')),
  recorded_at   timestamptz not null default now(),
  notes         text,
  created_at    timestamptz not null default now()
);

create index if not exists postmaster_grades_org_domain_idx
  on public.postmaster_grades (org_id, domain, recorded_at desc);

alter table public.postmaster_grades enable row level security;

create policy "postmaster_grades_select" on public.postmaster_grades
  for select using (org_id = public.auth_org_id());

create policy "postmaster_grades_insert" on public.postmaster_grades
  for insert with check (
    org_id = public.auth_org_id() and user_id = auth.uid()
  );

create policy "postmaster_grades_update" on public.postmaster_grades
  for update using (org_id = public.auth_org_id())
  with check (org_id = public.auth_org_id());

create policy "postmaster_grades_delete" on public.postmaster_grades
  for delete using (org_id = public.auth_org_id());

comment on table public.postmaster_grades is
  'Manual record of postmaster.google.com reputation grade per sending '
  'domain. User-curated weekly. Surfaced on the analytics dashboard so '
  'reputation trend is visible alongside live send metrics.';

-- ---------------------------------------------------------------------------
-- 4. Cron — hourly reputation refresh into email_accounts.reputation_score.
--    Same `app.settings.service_role_key` GUC pattern as the other
--    leadflow-* schedules. Hourly cadence: reputation is slow-moving;
--    minute cadence would waste compute on no-signal recomputes.
-- ---------------------------------------------------------------------------
do $$ begin
  perform cron.unschedule(jobid) from cron.job
   where jobname = 'leadflow-reputation-refresh';
exception when others then null;
end $$;

select cron.schedule(
  'leadflow-reputation-refresh',
  '0 * * * *',
  $cron$
    update public.email_accounts ea
       set reputation_score = public.compute_inbox_reputation(ea.id),
           updated_at = now()
     where ea.status in ('active','warming','bounced_recently');
  $cron$
);

-- Probe: cron row exists.
do $$
declare n int;
begin
  select count(*) into n from cron.job where jobname = 'leadflow-reputation-refresh';
  if n <> 1 then
    raise exception 'expected exactly 1 leadflow-reputation-refresh schedule, found %', n;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Seed an initial reputation pass so the dashboard isn't all-null on day 1.
-- ---------------------------------------------------------------------------
update public.email_accounts ea
   set reputation_score = public.compute_inbox_reputation(ea.id)
 where ea.status in ('active','warming','bounced_recently');
