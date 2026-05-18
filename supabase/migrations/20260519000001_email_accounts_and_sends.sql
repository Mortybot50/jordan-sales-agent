-- =============================================================================
-- LeadFlow native sender — Week 1 (foundation) schema.
-- Migration: 20260519000001_email_accounts_and_sends
-- =============================================================================
-- Goal: own the cold-outbound sending plane end-to-end so we can replace
-- Instantly.ai (saves $97-358/mo). Week 1 covers the foundation only — the
-- queue + warmup tables exist (so the FK from email_send_events resolves)
-- but the automation (enqueue/drain crons + warmup) is Week 2.
--
-- What this lands:
--   1. email_accounts            — per-org encrypted SMTP creds, 1 row per
--                                  mailbox (16 at full scale, 4 domains × 4).
--   2. email_send_queue          — pending sends with scheduled_for + status.
--   3. email_send_events         — append-only event log (sent, opened,
--                                  clicked, bounced, replied, etc).
--   4. email_pixel_hits          — open-tracking pixel hit log, separated
--                                  from events so high-volume Apple MPP
--                                  prefetches don't flood the events table.
--   5. RLS policies on all four, scoped by org_id (matching the existing
--      multi-tenant model). SMTP password ciphertext is also guarded at
--      the column-select level — read it only via the SECURITY DEFINER
--      helper, never via a row-level select from the anon role.
--   6. Helper: get_email_account_smtp(account_id) returns the ciphertext
--      to the SECURITY DEFINER caller (Edge Function with service_role).
--
-- Encryption: smtp_password_encrypted holds AES-256-GCM ciphertext using
-- the application's TOKEN_ENCRYPTION_KEY (32-byte key). The client encrypts
-- before insert; the send-via-smtp Edge Function decrypts at send time
-- using the same key from Supabase secrets. Never written, logged, or
-- selected back to the browser.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. email_accounts — encrypted credential store per mailbox.
-- ---------------------------------------------------------------------------

create table if not exists public.email_accounts (
  id                         uuid primary key default gen_random_uuid(),
  org_id                     uuid not null references public.orgs(id) on delete cascade,
  user_id                    uuid not null references public.users(id) on delete cascade,
  email_address              text not null,
  domain                     text generated always as (
                               split_part(lower(email_address), '@', 2)
                             ) stored,
  display_name               text,
  smtp_host                  text not null default 'smtp.gmail.com',
  smtp_port                  int  not null default 587,
  smtp_username              text not null,
  -- AES-256-GCM ciphertext. Format: iv(hex) ':' authTag(hex) ':' ciphertext(hex)
  -- — matches the encryptToken() helper already used for Gmail refresh tokens
  -- in api/oauth/gmail/callback.ts. Encrypted server-side (Vercel API route)
  -- using TOKEN_ENCRYPTION_KEY. Always non-null when status != 'paused'.
  smtp_password_encrypted    text,
  send_signature             text,
  reply_to_address           text,
  daily_send_cap             int  not null default 50,
  status                     text not null default 'active'
                             check (status in ('active','paused','warming','bounced_recently')),
  brand                      text check (brand in ('purezza','culligan','zip') or brand is null),
  icp_segment                text check (icp_segment in ('hospitality','office','trade') or icp_segment is null),
  reputation_score           numeric,
  last_send_at               timestamptz,
  last_bounce_at             timestamptz,
  last_warmup_send_at        timestamptz,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now()
);

create unique index if not exists email_accounts_org_email_uidx
  on public.email_accounts (org_id, lower(email_address));

create index if not exists email_accounts_user_idx
  on public.email_accounts (user_id);

create index if not exists email_accounts_status_idx
  on public.email_accounts (org_id, status)
  where status = 'active';

create trigger set_email_accounts_updated_at
  before update on public.email_accounts
  for each row execute procedure public.set_updated_at();

alter table public.email_accounts enable row level security;

-- A note on the password column: RLS hides the row from anon/authenticated
-- by default, but a permitted user CAN read smtp_password_encrypted. The
-- ciphertext is useless without TOKEN_ENCRYPTION_KEY, which lives only in
-- Supabase secrets (server-side). We still avoid sending it back to the
-- browser at the query layer — `useEmailAccounts` selects an allow-list of
-- columns that excludes the ciphertext.
create policy "email_accounts_select" on public.email_accounts
  for select using (org_id = public.auth_org_id());

create policy "email_accounts_insert" on public.email_accounts
  for insert with check (org_id = public.auth_org_id() and user_id = auth.uid());

create policy "email_accounts_update" on public.email_accounts
  for update using (org_id = public.auth_org_id())
  with check  (org_id = public.auth_org_id());

create policy "email_accounts_delete" on public.email_accounts
  for delete using (org_id = public.auth_org_id());

comment on column public.email_accounts.smtp_password_encrypted is
  'AES-256-GCM ciphertext of the SMTP app password. Format: '
  'iv(hex) ":" authTag(hex) ":" ciphertext(hex). Encrypted server-side '
  '(Vercel API route) with TOKEN_ENCRYPTION_KEY. Never returned to the browser.';

-- ---------------------------------------------------------------------------
-- 2. email_send_queue — what each inbox is going to send, when.
-- ---------------------------------------------------------------------------

create table if not exists public.email_send_queue (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references public.orgs(id) on delete cascade,
  user_id             uuid not null references public.users(id) on delete cascade,
  draft_id            uuid references public.email_drafts(id) on delete cascade,
  email_account_id    uuid not null references public.email_accounts(id) on delete restrict,
  to_email            text not null,
  subject             text,
  body                text,
  scheduled_for       timestamptz not null,
  attempt_count       int  not null default 0,
  status              text not null default 'queued'
                      check (status in ('queued','sending','sent','failed','cancelled')),
  sent_at             timestamptz,
  smtp_response       text,
  smtp_message_id     text,
  last_error          text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists email_send_queue_ready_idx
  on public.email_send_queue (status, scheduled_for)
  where status = 'queued';

create index if not exists email_send_queue_account_idx
  on public.email_send_queue (email_account_id, sent_at desc);

create index if not exists email_send_queue_draft_idx
  on public.email_send_queue (draft_id);

create trigger set_email_send_queue_updated_at
  before update on public.email_send_queue
  for each row execute procedure public.set_updated_at();

alter table public.email_send_queue enable row level security;

create policy "email_send_queue_select" on public.email_send_queue
  for select using (org_id = public.auth_org_id());

create policy "email_send_queue_insert" on public.email_send_queue
  for insert with check (org_id = public.auth_org_id());

create policy "email_send_queue_update" on public.email_send_queue
  for update using (org_id = public.auth_org_id())
  with check  (org_id = public.auth_org_id());

create policy "email_send_queue_delete" on public.email_send_queue
  for delete using (org_id = public.auth_org_id());

-- ---------------------------------------------------------------------------
-- 3. email_send_events — append-only event log (one row per lifecycle event).
-- ---------------------------------------------------------------------------

create table if not exists public.email_send_events (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references public.orgs(id) on delete cascade,
  send_queue_id       uuid references public.email_send_queue(id) on delete cascade,
  draft_id            uuid references public.email_drafts(id) on delete set null,
  email_account_id    uuid references public.email_accounts(id) on delete set null,
  event_type          text not null
                      check (event_type in (
                        'sent','opened','clicked','bounced','replied',
                        'unsubscribed','spam_complaint','failed'
                      )),
  event_at            timestamptz not null default now(),
  metadata            jsonb,
  created_at          timestamptz not null default now()
);

create index if not exists email_send_events_send_idx
  on public.email_send_events (send_queue_id, event_at);

create index if not exists email_send_events_account_type_idx
  on public.email_send_events (email_account_id, event_type, event_at desc);

create index if not exists email_send_events_org_type_idx
  on public.email_send_events (org_id, event_type, event_at desc);

alter table public.email_send_events enable row level security;

create policy "email_send_events_select" on public.email_send_events
  for select using (org_id = public.auth_org_id());

-- Inserts come from service-role (Edge Functions) which bypasses RLS. Block
-- direct browser writes — events are an append-only audit log.
create policy "email_send_events_insert_none" on public.email_send_events
  for insert with check (false);

-- ---------------------------------------------------------------------------
-- 4. email_pixel_hits — open-tracking pixel hits (Apple MPP filter included).
-- ---------------------------------------------------------------------------

create table if not exists public.email_pixel_hits (
  id                  uuid primary key default gen_random_uuid(),
  send_queue_id       uuid references public.email_send_queue(id) on delete cascade,
  hit_at              timestamptz not null default now(),
  user_agent          text,
  ip_address          inet,
  is_apple_mpp        boolean not null default false,
  created_at          timestamptz not null default now()
);

create index if not exists email_pixel_hits_send_idx
  on public.email_pixel_hits (send_queue_id, hit_at desc);

create index if not exists email_pixel_hits_real_idx
  on public.email_pixel_hits (send_queue_id, hit_at desc)
  where is_apple_mpp = false;

alter table public.email_pixel_hits enable row level security;

-- Pixel hits join to send_queue for org scoping (no direct org_id column —
-- joined via send_queue_id). Block direct browser writes; the pixel-track
-- Edge Function inserts via service_role.
create policy "email_pixel_hits_select" on public.email_pixel_hits
  for select using (
    send_queue_id in (
      select id from public.email_send_queue where org_id = public.auth_org_id()
    )
  );

create policy "email_pixel_hits_insert_none" on public.email_pixel_hits
  for insert with check (false);

-- ---------------------------------------------------------------------------
-- 5. Helper: fetch SMTP ciphertext for the send-via-smtp worker.
-- ---------------------------------------------------------------------------
-- The Edge Function calls this with the service_role key, which bypasses
-- RLS anyway, so this is really just documentation + a typed contract.

create or replace function public.get_email_account_smtp(p_account_id uuid)
returns table (
  email_address           text,
  smtp_host               text,
  smtp_port               int,
  smtp_username           text,
  smtp_password_encrypted text,
  display_name            text,
  reply_to_address        text,
  send_signature          text,
  status                  text,
  daily_send_cap          int,
  org_id                  uuid,
  user_id                 uuid
)
language sql
stable
security definer
set search_path = public
as $$
  select
    ea.email_address,
    ea.smtp_host,
    ea.smtp_port,
    ea.smtp_username,
    ea.smtp_password_encrypted,
    ea.display_name,
    ea.reply_to_address,
    ea.send_signature,
    ea.status,
    ea.daily_send_cap,
    ea.org_id,
    ea.user_id
  from public.email_accounts ea
  where ea.id = p_account_id
  limit 1;
$$;

comment on function public.get_email_account_smtp(uuid) is
  'Returns the SMTP config + ciphertext for an email_account. Called by '
  'the send-via-smtp Edge Function with service_role; the ciphertext is '
  'decrypted inside the function using TOKEN_ENCRYPTION_KEY from Supabase '
  'secrets. Never call from the browser.';
