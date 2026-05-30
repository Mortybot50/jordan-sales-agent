-- =============================================================================
-- Drop SECURITY DEFINER from `cron_job_run_status` and `public_user_profiles`
-- Migration: 20260528100000_drop_security_definer_views
-- =============================================================================
-- Closes Supabase advisor ERROR-level finding `security_definer_view` for
-- both views. Recreates each WITH (security_invoker = true) so RLS / role
-- privileges on the underlying tables apply to the calling user.
--
-- cron_job_run_status still needs to be useful for the in-app cron health
-- dashboard, so the underlying cron + net tables are granted SELECT to the
-- `authenticated` role. The view's WHERE clause already restricts to
-- `leadflow-%` jobs, so even with SELECT on the underlying tables, the
-- dashboard only sees its own cron rows via the view path.
--
-- public_user_profiles is no longer consumed by any frontend code (Calendly
-- /book/:slug flow was ripped). Kept as a 0-row view for backwards-compat
-- with any external integrations; future cleanup may DROP it entirely.
-- =============================================================================

-- 1. cron_job_run_status — recreate with security_invoker
CREATE OR REPLACE VIEW public.cron_job_run_status WITH (security_invoker = true) AS
SELECT
  jrd.runid,
  jrd.jobid,
  j.jobname,
  jrd.start_time,
  jrd.end_time,
  jrd.status        AS pg_cron_status,
  hr.status_code    AS http_status,
  hr.error_msg      AS http_error,
  hr.content_type   AS http_content_type
FROM cron.job_run_details jrd
JOIN cron.job j ON j.jobid = jrd.jobid
LEFT JOIN LATERAL (
  SELECT *
    FROM net._http_response r
   WHERE r.created BETWEEN jrd.start_time AND jrd.start_time + INTERVAL '5 seconds'
   ORDER BY r.created ASC
   LIMIT 1
) hr ON TRUE
WHERE j.jobname LIKE 'leadflow-%';

COMMENT ON VIEW public.cron_job_run_status IS
  'Joins cron.job_run_details with net._http_response so the HTTP status of '
  'each leadflow-* cron tick is visible. Runs as the calling user '
  '(security_invoker=true) — admin dashboards rely on the grants below.';

-- Grant the underlying access required by the view body.
-- `authenticated` already has implicit USAGE on the `public` schema; we extend
-- to cron + net for the read paths the view touches.
GRANT USAGE ON SCHEMA cron TO authenticated;
GRANT SELECT ON cron.job, cron.job_run_details TO authenticated;
GRANT USAGE ON SCHEMA net TO authenticated;
GRANT SELECT ON net._http_response TO authenticated;

GRANT SELECT ON public.cron_job_run_status TO authenticated, service_role;

-- 2. public_user_profiles — recreate with security_invoker
-- Drop first to clear the implicit SECURITY DEFINER flag; CREATE OR REPLACE
-- alone cannot toggle WITH options on an existing view.
DROP VIEW IF EXISTS public.public_user_profiles;

CREATE VIEW public.public_user_profiles WITH (security_invoker = true) AS
SELECT public_slug, calendly_url, full_name, email
FROM users
WHERE public_slug IS NOT NULL;

COMMENT ON VIEW public.public_user_profiles IS
  'Booking-page public profile view (legacy). security_invoker=true means RLS '
  'on users applies to the caller — anon callers see 0 rows. Kept as 0-row '
  'view for backwards-compat; safe to DROP when external integrations confirm '
  'no usage.';

GRANT SELECT ON public.public_user_profiles TO anon, authenticated;
