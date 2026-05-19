-- =============================================================================
-- LeadFlow native sender — Week 2 P1 follow-up: cron monitor view.
-- Migration: 20260519000006_cron_monitor_view
-- =============================================================================
-- pg_cron's cron.job_run_details reports `succeeded` whenever net.http_post()
-- returns synchronously, regardless of the eventual HTTP status. The actual
-- status_code lands in net._http_response after the async callback resolves.
-- So a job that 401s for 12 hours straight (Week 2 P0) shows up as a clean
-- `succeeded` in job_run_details — the failure is invisible without joining
-- the two tables.
--
-- This view stitches them together via a LATERAL join on the time window so
-- operators can read one row per cron tick and see the HTTP status. Restricted
-- to leadflow-* jobs to keep the surface small.
-- =============================================================================

create or replace view public.cron_job_run_status as
select
  jrd.runid,
  jrd.jobid,
  j.jobname,
  jrd.start_time,
  jrd.end_time,
  jrd.status        as pg_cron_status,
  hr.status_code    as http_status,
  hr.error_msg      as http_error,
  hr.content_type   as http_content_type
from cron.job_run_details jrd
join cron.job j on j.jobid = jrd.jobid
left join lateral (
  -- Best-effort match: pick the http_response within 5 sec after the cron tick.
  -- This isn't perfectly stable under high concurrency but is good enough for
  -- the leadflow cron cadence (slowest tick is every 2 min).
  select *
    from net._http_response r
   where r.created between jrd.start_time and jrd.start_time + interval '5 seconds'
   order by r.created asc
   limit 1
) hr on true
where j.jobname like 'leadflow-%';

comment on view public.cron_job_run_status is
  'Joins cron.job_run_details with net._http_response so the HTTP status of '
  'each leadflow-* cron tick is visible. Without this view, pg_cron reports '
  '`succeeded` for every tick regardless of the eventual HTTP 4xx/5xx.';

-- The view exposes ONLY cron job metadata + HTTP status codes for our own
-- functions — no PII, no payloads. Safe to expose to authenticated app users
-- for the in-app health dashboard. service_role keeps full read access.
grant select on public.cron_job_run_status to authenticated, service_role;
