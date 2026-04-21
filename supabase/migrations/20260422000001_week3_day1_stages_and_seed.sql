-- =============================================================================
-- Jordan Sales Agent — Week 3 Day 1: Pipeline Stages + Demo Seed Fixes
-- Migration: 20260422000001_week3_day1_stages_and_seed
-- =============================================================================

-- 1. Change pipeline_stages.position from int to numeric to support .5 positions
ALTER TABLE pipeline_stages
  ALTER COLUMN position TYPE numeric USING position::numeric;

-- 2. Add 3 missing stages for the demo org (idempotent)
DO $$
DECLARE
  v_org_id uuid := '5557189e-5c2d-4990-afad-6aa1861826cd';
BEGIN

  INSERT INTO public.pipeline_stages (org_id, name, position, is_closed, color)
  SELECT v_org_id, 'Replied', 2.5, false, '#34d399'
  WHERE NOT EXISTS (
    SELECT 1 FROM public.pipeline_stages
    WHERE org_id = v_org_id AND name = 'Replied'
  );

  INSERT INTO public.pipeline_stages (org_id, name, position, is_closed, color)
  SELECT v_org_id, 'Site Visit', 3.5, false, '#f472b6'
  WHERE NOT EXISTS (
    SELECT 1 FROM public.pipeline_stages
    WHERE org_id = v_org_id AND name = 'Site Visit'
  );

  INSERT INTO public.pipeline_stages (org_id, name, position, is_closed, color)
  SELECT v_org_id, 'Demo Completed', 4.5, false, '#fb923c'
  WHERE NOT EXISTS (
    SELECT 1 FROM public.pipeline_stages
    WHERE org_id = v_org_id AND name = 'Demo Completed'
  );

  -- 3. Seed demo user profile so Settings > Profile loads populated
  UPDATE public.users
  SET
    full_name        = 'Jordan Smith',
    calendly_url     = 'https://calendly.com/jordan-purezza',
    email_signature  = 'Jordan Smith' || E'\n' ||
                       'Sales Manager · Purezza' || E'\n' ||
                       'jordan@purezza.com.au'
  WHERE org_id = v_org_id
    AND (full_name IS NULL OR full_name = 'Jordan' OR full_name = '');

  -- 4. Fix last_touch_at for warm-scored open deals (score 50-79) so Warm
  --    Leads widget shows data (requires last_touch_at > 7 days ago).
  UPDATE public.deals d
  SET last_touch_at = NOW() - INTERVAL '10 days'
  WHERE d.org_id = v_org_id
    AND d.closed_at IS NULL
    AND d.id IN (
      SELECT DISTINCT deal_id
      FROM public.lead_scores
      WHERE score BETWEEN 50 AND 79
    )
    AND (d.last_touch_at IS NULL OR d.last_touch_at > NOW() - INTERVAL '7 days');

  RAISE NOTICE 'Week 3 Day 1: pipeline stages + demo seed applied for org %', v_org_id;
END $$;

-- 5. Also update handle_new_user trigger to include the 3 new stages for
--    future new users (keeps the trigger consistent with the migration).
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
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
    (v_org_id, 'New',           1,   false, '#94a3b8'),
    (v_org_id, 'Contacted',     2,   false, '#60a5fa'),
    (v_org_id, 'Replied',       2.5, false, '#34d399'),
    (v_org_id, 'Meeting Booked',3,   false, '#a78bfa'),
    (v_org_id, 'Site Visit',    3.5, false, '#f472b6'),
    (v_org_id, 'Proposal Sent', 4,   false, '#f59e0b'),
    (v_org_id, 'Demo Completed',4.5, false, '#fb923c'),
    (v_org_id, 'Negotiation',   5,   false, '#fbbf24'),
    (v_org_id, 'Closed Won',    6,   true,  '#22c55e'),
    (v_org_id, 'Closed Lost',   7,   true,  '#ef4444');

  RETURN new;
END;
$$;
