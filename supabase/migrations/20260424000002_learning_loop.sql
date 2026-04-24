-- Learning Loop: edit tracking on email_drafts + weekly learning_digests.

-- 1. Edit-tracking columns on email_drafts
alter table email_drafts
  add column if not exists original_subject text,
  add column if not exists original_body text,
  add column if not exists edited_subject text,
  add column if not exists edited_body text,
  add column if not exists edit_logged_at timestamptz;

-- Backfill: copy existing subject/body into original_* so the column is never null going forward
update email_drafts
set original_subject = coalesce(original_subject, subject),
    original_body = coalesce(original_body, body)
where original_subject is null or original_body is null;

-- 2. learning_digests table
create table if not exists learning_digests (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references orgs(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  generated_at    timestamptz not null default now(),
  week_start      date not null,
  week_end        date not null,
  drafts_analysed int not null default 0,
  proposed_rules  jsonb not null default '[]'::jsonb,
  email_sent_at   timestamptz,
  status          text not null default 'pending'
                  check (status in ('pending','partially_actioned','fully_actioned','dismissed')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists learning_digests_user_status_idx
  on learning_digests (user_id, status);

create index if not exists learning_digests_org_week_idx
  on learning_digests (org_id, week_start desc);

alter table learning_digests enable row level security;

drop policy if exists "users see own digests" on learning_digests;
create policy "users see own digests" on learning_digests for select
  using (user_id = auth.uid());

drop policy if exists "users update own digests" on learning_digests;
create policy "users update own digests" on learning_digests for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- service role handles inserts (no policy needed — service role bypasses RLS)

-- 3. Enable pg_cron + pg_net for scheduled job
create extension if not exists pg_cron;
create extension if not exists pg_net;
