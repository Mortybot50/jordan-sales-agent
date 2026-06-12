-- =============================================================================
-- PST mailbox-import re-triage (one-off, data-only)
-- Migration: 20260612071902_pst_retriage
-- =============================================================================
-- The 02/06 PST import dumped 317 deals titled with raw email addresses, all
-- at the $800 placeholder, WARM ones (253) heaped into Replied and COLD (64)
-- into Contacted, with the real signal buried in a structured notes block:
--   [purezza-pst-promote] ... / Inbox/Sent: I/S / Last contact: YYYY-MM-DD
-- and a thread_excerpt jsonb {subject, last_body}.
--
-- SQL below mirrors supabase/functions/_shared/temperature.ts EXACTLY
-- (rules pinned by tests/unit/temperature.test.ts). Tuning discovery 12/06:
-- the import's Inbox/Sent counts include Jordan's own messages and auto-acks
-- (every COLD row has inbox>=1) — the importer's own warm/cold VERDICT in the
-- notes header is the genuine-human-reply signal, not inbox>0.
--   stage:   invoice-like subject -> Closed (existing customer; outcome left
--            NULL so the card shows "Mark outcome" for Jordan to confirm)
--            WARM verdict -> Replied | any thread -> Contacted | else New
--   temp:    hot  = WARM verdict AND (>=2 inbound with ZERO sent back, OR a
--                   human reply within 30d — the UNVERIFIED_HOT_WINDOW; PST
--                   replies were never intent-classified so they decay faster
--                   than the 60d intent-verified window)
--            warm = WARM verdict | cold = otherwise
--   title:   business name — non-freemail email domain, else local part
--   last_touch_at: parsed "Last contact" date
--   contract_value: NULL the $800 placeholder (PST rows only)
--
-- BEFORE state backed up in full:
--   ~/workspace/leadflow-audit/pst-retriage-backup-2026-06-12.sql (317 rows)
-- Before counts: Contacted:64 | Replied:253
-- Scope guard: every UPDATE keys on title ILIKE '%from PST%' — deals Jordan
-- created by hand are untouched.
-- =============================================================================

with pst as (
  select d.id,
    (d.notes ~* 'warm lead') as warm_verdict,
    coalesce(nullif(substring(d.notes from 'Inbox/Sent:\s*(\d+)\s*/'), ''), '0')::int as inbox,
    coalesce(nullif(substring(d.notes from 'Inbox/Sent:\s*\d+\s*/\s*(\d+)'), ''), '0')::int as sent,
    substring(d.notes from 'Last contact:\s*(\d{4}-\d{2}-\d{2})') as last_contact,
    (d.notes ~* 'ZERO sent back') as zero_sent_back,
    coalesce((d.thread_excerpt->>'subject') ~* 'invoice|payment requ|receipt|statement|order confirm', false) as existing_customer,
    c.email as contact_email
  from public.deals d
  left join public.contacts c on c.id = d.contact_id
  where d.title ilike '%from PST%'
),
calc as (
  select p.*,
    case
      when p.existing_customer then 'Closed'
      when p.warm_verdict then 'Replied'
      when p.sent > 0 or p.inbox > 0 then 'Contacted'
      else 'New'
    end as new_stage,
    case
      when p.warm_verdict and (
             (p.zero_sent_back and p.inbox >= 2)
             or (p.last_contact is not null and p.last_contact::date >= current_date - 30)
           ) then 'hot'
      when p.warm_verdict then 'warm'
      else 'cold'
    end as new_temp,
    case
      when p.contact_email is null or position('@' in p.contact_email) = 0 then null
      when lower(split_part(p.contact_email, '@', 2)) in (
        'gmail.com','googlemail.com','yahoo.com','yahoo.com.au','hotmail.com',
        'hotmail.com.au','outlook.com','outlook.com.au','live.com','live.com.au',
        'bigpond.com','bigpond.net.au','icloud.com','me.com','msn.com','aol.com',
        'optusnet.com.au','iinet.net.au','internode.on.net','protonmail.com','proton.me'
      ) then lower(split_part(p.contact_email, '@', 1))
      else lower(split_part(p.contact_email, '@', 2))
    end as business_title
  from pst p
)
update public.deals d
   set stage_id = (select s.id from public.pipeline_stages s
                    where s.org_id = d.org_id and s.name = calc.new_stage),
       temperature = calc.new_temp,
       temperature_source = 'auto',
       last_touch_at = coalesce(calc.last_contact::timestamptz, d.last_touch_at),
       title = coalesce(calc.business_title, d.title),
       contract_value = case when d.contract_value = 800 then null else d.contract_value end,
       updated_at = now()
  from calc
 where d.id = calc.id;
