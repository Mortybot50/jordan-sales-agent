-- =============================================================================
-- LeadFlow Sourcing — crawl drain priority + transient-failure retry
-- Migration: 20260713071051_crawl_queue_priority_and_retry
-- =============================================================================
-- Two small, targeted changes to the existing crawl pipeline. Discovery→crawl
-- is ALREADY wired (discover-leads inserts venues at the default
-- contact_enrichment_status='pending', and leadflow-crawl-pending-venues drains
-- them every 5 min — see 20260524160000_crawl_venue_contacts_cron.sql). This
-- migration does NOT add a new crawl path; it tunes the existing one.
--
--   1. Reorder the drain by icp_score DESC so the best-fit venues get crawled
--      first, and skip venues with no website (nothing to crawl). Previously it
--      drained oldest-first regardless of fit or crawlability.
--
--   2. One-time retry: flip venues stuck at contact_enrichment_status='failed'
--      that HAVE a website back to 'pending', so the existing drain re-crawls
--      them. 'failed' is a transient outcome (fetch error / timeout), unlike
--      'crawled_empty' which is deterministic (the crawler reached the site and
--      found no domain-matched email). We deliberately do NOT re-crawl
--      crawled_empty rows: re-running a deterministic empty crawl yields nothing
--      and just hammers the venue's website for no gain.
--
-- Idempotent: create-or-replace + a WHERE-guarded UPDATE that no-ops on replay.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Redefine the drainer: icp_score DESC, website-only, else unchanged.
-- ---------------------------------------------------------------------------
create or replace function public.leadflow_drain_crawl_queue()
returns integer
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v record;
  bearer text;
  fired integer := 0;
begin
  select decrypted_secret into bearer
    from vault.decrypted_secrets
   where name = 'service_role_key'
   limit 1;

  if bearer is null then
    raise warning 'leadflow_drain_crawl_queue: no service_role_key in vault — skipping tick';
    return 0;
  end if;

  for v in
    select id
      from venues
     where contact_enrichment_status = 'pending'
       and website is not null
       and length(trim(website)) > 0
     order by icp_score desc nulls last, created_at asc nulls last
     limit 20
  loop
    perform net.http_post(
      url     := 'https://bsevgxhnxlkzkcalevbb.supabase.co/functions/v1/crawl-venue-contacts',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || bearer
      ),
      body    := jsonb_build_object('venue_id', v.id)
    );
    fired := fired + 1;
  end loop;

  return fired;
end;
$$;

revoke all on function public.leadflow_drain_crawl_queue() from public;

-- ---------------------------------------------------------------------------
-- 2. One-time retry of transient failures that still have a website to crawl.
--    Gated on last_crawled_at before this migration's authoring instant so it
--    is replay-idempotent: a venue that fails a crawl AFTER this migration ran
--    will NOT be re-flipped by a later replay of this file (Supabase only runs
--    each migration once, but a manual re-run stays safe). On a fresh DB there
--    are no failed venues yet, so it no-ops.
-- ---------------------------------------------------------------------------
update public.venues
   set contact_enrichment_status = 'pending'
 where contact_enrichment_status = 'failed'
   and website is not null
   and length(trim(website)) > 0
   and (last_crawled_at is null or last_crawled_at < timestamptz '2026-07-13 07:10:51+00');
