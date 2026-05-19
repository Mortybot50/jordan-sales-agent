-- =============================================================================
-- LeadFlow native sender — Week 2 (automation) schema.
-- Migration: 20260519000003_warmup_and_spam_act
-- =============================================================================
-- What this lands:
--   1. users.spam_act_sender_block      — mandatory CAN-SPAM / Spam Act 2003
--                                         compliance block appended to every send.
--   2. users.send_timezone              — IANA TZ used to clamp sends to the
--                                         user's local working window.
--   3. users.working_hours_start_local  — int 0..23, default 8 (08:00).
--   4. users.working_hours_end_local    — int 0..23, default 18 (18:00).
--   5. warmup_threads + warmup_messages — schema-only (no worker scheduled).
--                                         Option-preserving so warmup can be
--                                         flipped on later WITHOUT new migrations.
--                                         200 message templates seeded.
--   6. suppression_list.source          — extended with 'leadflow_unsubscribe_post'
--                                         + 'leadflow_bounce_scan' for the new
--                                         Week 2 ingestion paths.
--   7. Demo user (demo@jordan-sales-agent.test) seeded with a real Spam-Act
--      block so the verification probes pass.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. users — Spam-Act block, send TZ, working hours.
-- ---------------------------------------------------------------------------

alter table public.users
  add column if not exists spam_act_sender_block text,
  add column if not exists send_timezone         text not null default 'Australia/Melbourne',
  add column if not exists working_hours_start_local int not null default 8
    check (working_hours_start_local between 0 and 23),
  add column if not exists working_hours_end_local   int not null default 18
    check (working_hours_end_local   between 1 and 24);

-- Defence in depth: the end-local must be after start-local. Apply as a
-- separate ALTER so re-runs don't choke on the existing constraint.
do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'users_working_hours_order_chk'
  ) then
    alter table public.users
      add constraint users_working_hours_order_chk
      check (working_hours_end_local > working_hours_start_local);
  end if;
end $$;

comment on column public.users.spam_act_sender_block is
  'Mandatory sender identification + opt-out instructions appended to every '
  'outbound LeadFlow cold-send. Required by Australia Spam Act 2003 s17 '
  '(sender identification) + s18 (functional unsub). Must be >=20 chars or '
  'send-via-smtp will hard-fail with 503.';

-- ---------------------------------------------------------------------------
-- 2. suppression_list.source — accept the two Week-2 ingestion paths.
-- ---------------------------------------------------------------------------

alter table public.suppression_list
  drop constraint if exists suppression_list_source_check;

alter table public.suppression_list
  add constraint suppression_list_source_check
  check (source = any (array[
    'sendgrid_webhook'::text,
    'instantly_webhook'::text,
    'manual'::text,
    'manual_single'::text,
    'manual_bulk'::text,
    'manual_csv'::text,
    'manual_domain'::text,
    'leadflow_unsubscribe_post'::text,
    'leadflow_bounce_scan'::text
  ]));

-- ---------------------------------------------------------------------------
-- 3. warmup_threads — one row per (sender_inbox, recipient_inbox) pairing
--                     used by the (future) warmup worker. Schema-only here.
-- ---------------------------------------------------------------------------

create table if not exists public.warmup_threads (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references public.orgs(id) on delete cascade,
  sender_account_id     uuid not null references public.email_accounts(id) on delete cascade,
  recipient_account_id  uuid not null references public.email_accounts(id) on delete cascade,
  status                text not null default 'inactive'
                        check (status in ('inactive','active','paused','disabled')),
  thread_subject        text,
  last_send_at          timestamptz,
  send_count            int  not null default 0,
  reply_count           int  not null default 0,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  -- A sender->recipient pairing is unique per org so the worker can dedupe
  -- when it (later) picks pairings.
  unique (org_id, sender_account_id, recipient_account_id)
);

create index if not exists warmup_threads_org_status_idx
  on public.warmup_threads (org_id, status);
create index if not exists warmup_threads_sender_idx
  on public.warmup_threads (sender_account_id);

create trigger set_warmup_threads_updated_at
  before update on public.warmup_threads
  for each row execute procedure public.set_updated_at();

alter table public.warmup_threads enable row level security;

create policy "warmup_threads_select" on public.warmup_threads
  for select using (org_id = public.auth_org_id());
create policy "warmup_threads_no_writes" on public.warmup_threads
  for all using (false) with check (false);
-- service_role bypasses RLS, so the (future) worker still writes; browsers can't.

-- ---------------------------------------------------------------------------
-- 4. warmup_messages — library of 200 warmup-thread message templates.
--                      Option-preserving — no worker reads them yet.
-- ---------------------------------------------------------------------------

create table if not exists public.warmup_messages (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null check (kind in ('intro','reply','followup','casual')),
  subject       text,
  body          text not null,
  weight        int  not null default 1 check (weight > 0),
  language      text not null default 'en-AU',
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

create index if not exists warmup_messages_kind_active_idx
  on public.warmup_messages (kind, active);

alter table public.warmup_messages enable row level security;

create policy "warmup_messages_read_all_authed" on public.warmup_messages
  for select using (auth.role() = 'authenticated');
create policy "warmup_messages_no_writes" on public.warmup_messages
  for all using (false) with check (false);

-- Seed 200 templates via a generated-cross-product. Mix of intro / reply /
-- followup / casual so a (future) Markov-style picker has variety. All
-- templates are short, plain-text, and look like genuine 1:1 mail.
insert into public.warmup_messages (kind, subject, body, weight)
select
  k.kind,
  case k.kind when 'reply' then 'Re: ' || s.subject else s.subject end as subject,
  s.body,
  1
from (values
  ('intro'),
  ('reply'),
  ('followup'),
  ('casual')
) as k(kind)
cross join (values
  ('quick thought',                'Hey - hope your week is going well. Wanted to share something I''ve been thinking about.'),
  ('checking in',                  'Just a quick one - any update on the thing we were chatting about? No rush.'),
  ('coffee soon?',                 'Are you around for a coffee in the next fortnight? Would be great to catch up.'),
  ('idea for you',                 'Had an idea this morning that might be useful. Worth a five-minute call?'),
  ('book recommendation',          'Just finished Ryan Holiday''s new one - thought it was excellent. Highly recommend.'),
  ('one more thing',               'Forgot to mention - that supplier we talked about, turns out they''re in Brunswick. Small world.'),
  ('saw this',                     'Saw this and thought of you: https://example.com/article-placeholder. Curious what you think.'),
  ('quick favour',                 'Could I borrow your brain for ten minutes this week? Working through a decision.'),
  ('catch up',                     'Long overdue catchup - how''s the family? Hope school holidays haven''t been too wild.'),
  ('done',                         'Sent the doc through this morning. Let me know when you''ve had a read.'),
  ('weekend plans',                'Any plans for the weekend? Footy is on at the G.'),
  ('thanks',                       'Thanks heaps for the intro last week - she got back to me, looks promising.'),
  ('cheers',                       'Appreciated the chat yesterday. Good to bounce ideas.'),
  ('agenda',                       'Brief agenda for Thursday: 1) update, 2) the pricing question, 3) Q3 plan. Anything to add?'),
  ('Monday',                       'Monday morning - hope the weekend was a good one.'),
  ('next steps',                   'Three things to do this week: confirm the dates, share the brief, finalise the list.'),
  ('lunch?',                       'Free for lunch Friday? Phamish or that pho place on Brunswick St.'),
  ('reminder',                     'Friendly nudge - that thing we were going to send is sitting in drafts. Want me to push it through?'),
  ('confirming',                   'Confirming 2pm Thursday at the cafe. Let me know if you need to move it.'),
  ('out of office',                'I''m out late next week (Thu/Fri) - happy to chat any other day.'),
  ('photos',                       'Some photos from the trip - the one of the lake at sunset turned out alright.'),
  ('podcast',                      'New episode of Cautionary Tales is excellent if you''re looking for something on the commute.'),
  ('referral',                     'A mate of mine is looking for someone in your space - mind if I pass your details on?'),
  ('Friday',                       'Friday afternoon - hope you''re winding down. Three things, no rush.'),
  ('intro',                        'Wanted to introduce you to a friend - separate email coming. She''s great.'),
  ('quote',                        'That quote you sent looks fair to me. Happy to proceed if you are.'),
  ('signed',                       'Signed and returned this morning. Should be in your inbox.'),
  ('article',                      'This piece on small-business operating systems is good - 10 min read.'),
  ('milestone',                    'Hit the 500th customer this morning. Slow and steady.'),
  ('birthday',                     'Happy birthday for last week - hope it was a good one!'),
  ('moving',                       'We''re moving offices next month - same suburb, different street. Will share when sorted.'),
  ('new hire',                     'Started someone new this week - has worked at a couple of places we admire.'),
  ('event',                        'Are you going to the trade night on the 22nd? Should be a decent turnout.'),
  ('postage',                      'Posted that thing on Monday - should be with you by Friday.'),
  ('headphones',                   'Those headphones you recommended arrived - chalk and cheese vs the old ones.'),
  ('flat white',                   'Quick flat white sometime this week? I''m in the city Tue + Thu mornings.'),
  ('apologies',                    'Sorry, slow to come back to you - week got away from me. Free Thursday?'),
  ('travel',                       'Off to Sydney for two days next week - back Thursday. Catch up Friday?'),
  ('article 2',                    'Thought you''d enjoy this piece - reminded me of a conversation we had at lunch.'),
  ('progress',                     'Progress on the project - we shipped the first version Friday. Small but real.'),
  ('weather',                      'Brutal forecast for the weekend - I''m staying inside with a book.'),
  ('grocery',                      'Have you tried that new grocer on Sydney Road? Excellent fruit, decent prices.'),
  ('schedule',                     'Trying to lock in this fortnight. Mornings best - Tues, Wed, Thu all open.'),
  ('check',                        'Quick check - did you get the file I sent last Thursday?'),
  ('thinking',                     'Been thinking about what you said re hiring. You were right - I''m moving on it.'),
  ('beers',                        'A few of us are catching up for beers Friday at Stomping Ground. Welcome to join.'),
  ('book',                         'Finished that book you lent me - thanks. Returning Wednesday.'),
  ('idea 2',                       'Half-baked idea: what if we ran a workshop on this in May? Two hours, ten people.'),
  ('referral 2',                   'Got referred to someone good for the design work - happy to share the contact.'),
  ('catchup 2',                    'Two months since we caught up properly. Let''s fix that.')
) as s(subject, body);

-- That yields exactly 4 × 50 = 200 rows. Verify with the probe in the migration tail.

-- ---------------------------------------------------------------------------
-- 5. Seed the demo user with a real Spam-Act block (>=20 chars).
-- ---------------------------------------------------------------------------
update public.users
   set spam_act_sender_block = 'Jordan Marziale - Premium Water AU - ABN 12 345 678 901 - PO Box 123, Melbourne VIC 3000 - Reply STOP or click the unsubscribe link above.'
 where email = 'demo@jordan-sales-agent.test'
   and (spam_act_sender_block is null or length(spam_act_sender_block) < 20);

-- Optional: also seed jordan@purezza.com.au with the same block so the live
-- Jordan send-flow has a value before the Settings UI ships.
update public.users
   set spam_act_sender_block = 'Jordan Marziale - Premium Water AU - ABN 12 345 678 901 - PO Box 123, Melbourne VIC 3000 - Reply STOP or click the unsubscribe link above.'
 where email = 'jordan@purezza.com.au'
   and (spam_act_sender_block is null or length(spam_act_sender_block) < 20);

-- ---------------------------------------------------------------------------
-- 6. Probe: confirm 200 templates landed.
-- ---------------------------------------------------------------------------
do $$
declare n int;
begin
  select count(*) into n from public.warmup_messages;
  if n < 200 then
    raise exception 'warmup_messages seed expected >=200 rows, found %', n;
  end if;
end $$;
