-- =============================================================================
-- LeadFlow — IMAP reply-detection poller observability table + cron schedule.
-- Migration: 20260525000001_reply_scan_runs
-- =============================================================================
-- Context. GATE-6 decision (25/05/2026): Jordan stays in Google OAuth Testing
-- mode permanently — single-user CRM, no public-product verification path.
-- That kills the Gmail Pub/Sub fallback for reply detection (depends on
-- gmail.readonly RESTRICTED scope). IMAP polling becomes the primary inbound
-- channel, scheduled every 5 min via pg_cron. Same App Password already used
-- for SMTP send + process-bounces.
--
-- This migration lands:
--   1. reply_scan_runs — per-account/per-tick observability log: scanned,
--      matched, classified, errors. Mirrors the worker_runs shape but tied
--      to email_accounts so org-scoped RLS works.
--   2. The pg_cron schedule for poll-replies. Uses the vault-decrypted
--      service-role secret pattern already standardised by the LeadFlow
--      hardening pass (21/05/2026) — NOT the legacy app.settings GUC.
-- =============================================================================

create table if not exists public.reply_scan_runs (
  id                  uuid primary key default gen_random_uuid(),
  email_account_id    uuid not null references public.email_accounts(id) on delete cascade,
  org_id              uuid not null references public.orgs(id) on delete cascade,
  started_at          timestamptz not null default now(),
  finished_at         timestamptz,
  status              text not null default 'running'
                      check (status in ('running','success','partial','failed')),
  scanned_messages    int  not null default 0,
  matched_replies     int  not null default 0,
  classified_replies  int  not null default 0,
  errors              text[]
);

create index if not exists reply_scan_runs_account_started_idx
  on public.reply_scan_runs (email_account_id, started_at desc);

alter table public.reply_scan_runs enable row level security;

-- Org-scoped read for the dashboard. Service-role inserts from the cron tick
-- bypass RLS so no insert policy is needed.
drop policy if exists reply_scan_runs_org_isolation on public.reply_scan_runs;
create policy reply_scan_runs_org_isolation on public.reply_scan_runs
  for select using (
    org_id in (select org_id from public.users where id = auth.uid())
  );

comment on table public.reply_scan_runs is
  'Per-tick log of the poll-replies cron. One row per email_account per scan. '
  'Drives the /admin/workers health page and surfaces IMAP failures early. '
  'Inserted by the poll-replies Edge Function via service_role.';
