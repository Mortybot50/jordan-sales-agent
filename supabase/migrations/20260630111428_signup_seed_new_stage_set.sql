-- Align the signup seed with the curated production pipeline stages.
--
-- handle_new_user() still seeded the legacy stage set ('Closed Won',
-- 'Closed Lost', plus 'Demo Completed'/'Negotiation') that predates the
-- pipeline consolidation. The app (and the temperature-axis kanban) now
-- depends on the outcome stages being named exactly 'Closed', 'Installed'
-- and 'Lost' — a fresh org signed up under the old seed would render no
-- Closed/Installed/Lost drop targets.
--
-- Re-seed new orgs with the same 9 stages the live org carries (verified
-- against pipeline_stages on 2026-06-30). Only the INSERT changes; the
-- SECURITY DEFINER + empty search_path and the org/user creation are
-- preserved exactly.

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_org_id uuid;
  v_slug   text;
BEGIN
  v_slug := coalesce(
    lower(split_part(new.email, '@', 2)),
    'org-' || substr(new.id::text, 1, 8)
  );
  WHILE EXISTS (SELECT 1 FROM public.orgs WHERE slug = v_slug) LOOP
    v_slug := v_slug || '-' || substr(gen_random_uuid()::text, 1, 4);
  END LOOP;

  INSERT INTO public.orgs (name, slug)
  VALUES (coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)), v_slug)
  RETURNING id INTO v_org_id;

  INSERT INTO public.users (id, org_id, full_name, email, role)
  VALUES (
    new.id,
    v_org_id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    new.email,
    'owner'
  );

  INSERT INTO public.pipeline_stages (org_id, name, position, is_closed, color) VALUES
    (v_org_id, 'New',           1, false, '#94a3b8'),
    (v_org_id, 'Contacted',     2, false, '#60a5fa'),
    (v_org_id, 'Replied',       3, false, '#34d399'),
    (v_org_id, 'Meeting Booked',4, false, '#a78bfa'),
    (v_org_id, 'Site Visit',    5, false, '#f472b6'),
    (v_org_id, 'Proposal Sent', 6, false, '#f59e0b'),
    (v_org_id, 'Closed',        7, true,  '#22c55e'),
    (v_org_id, 'Installed',     8, true,  '#0ea5e9'),
    (v_org_id, 'Lost',          9, true,  '#ef4444');

  RETURN new;
END;
$function$;
