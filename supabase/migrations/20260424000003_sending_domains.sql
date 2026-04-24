-- Week 4 polish: sending infrastructure schema.
--
-- Stores per-user sending-domain metadata: status, DNS record checks
-- (SPF/DKIM/DMARC), inbox & warmup progress, and provider label.
-- Everything is manually editable in Settings — no auto DNS/warmup
-- polling in this migration (Week 6 work).

create table sending_domains (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references orgs(id) on delete cascade,
  user_id           uuid not null references auth.users(id) on delete cascade,
  domain            text not null,
  status            text not null default 'not_configured'
                    check (status in ('not_configured','pending_dns','warming_up','active','paused','error')),
  spf_status        text default 'unknown'
                    check (spf_status in ('unknown','pass','fail')),
  dkim_status       text default 'unknown'
                    check (dkim_status in ('unknown','pass','fail')),
  dmarc_status      text default 'unknown'
                    check (dmarc_status in ('unknown','pass','fail','missing')),
  inbox_count       int not null default 0,
  warmup_day        int not null default 0,
  warmup_target_day int not null default 21,
  provider          text,
  notes             text,
  last_checked_at   timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index on sending_domains(user_id);
create index on sending_domains(org_id, status);

alter table sending_domains enable row level security;

create policy "users see own sending domains" on sending_domains for select
  using (user_id = auth.uid());

create policy "users update own sending domains" on sending_domains for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "users insert own sending domains" on sending_domains for insert
  with check (user_id = auth.uid());

create policy "users delete own sending domains" on sending_domains for delete
  using (user_id = auth.uid());
