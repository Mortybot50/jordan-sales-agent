-- =============================================================================
-- LeadFlow Jordan Sales Agent — Initial Seed Data
-- =============================================================================
-- ⚠️  LOCAL DEVELOPMENT ONLY. Never run against the production project
--     (bsevgxhnxlkzkcalevbb). Demo rows were purged from prod on 11/06/2026
--     (backup: ~/workspace/leadflow-audit/demo-data-backup-2026-06-11.sql).
-- HOW TO RUN (local sandbox only):
--   psql postgres://postgres:postgres@127.0.0.1:54322/postgres -f supabase/seed/001_initial_org_and_user.sql
--
-- IMPORTANT: Run AFTER Jordan's Supabase Auth account has been created.
--   Create the auth user in: Supabase Dashboard → Authentication → Users → "Add user"
--   Set email + password, then note the UUID and replace JORDAN_AUTH_USER_ID below.
-- =============================================================================

-- Idempotent: skip if already seeded
DO $$
DECLARE
  v_org_id uuid;
  v_venue_id uuid;
  v_stage_ids uuid[] := ARRAY[]::uuid[];
  v_jordan_auth_id uuid;

  -- ============================================================
  -- CONFIGURE THESE BEFORE RUNNING:
  v_jordan_email text := 'jordan@purezza.com.au';  -- Jordan's actual email
  -- After creating Jordan's auth user in Supabase Dashboard,
  -- replace the value below with his actual auth.users UUID:
  -- v_jordan_auth_id := 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx';
  -- ============================================================
BEGIN

  -- Look up Jordan's auth user by email
  SELECT id INTO v_jordan_auth_id
  FROM auth.users
  WHERE email = v_jordan_email
  LIMIT 1;

  IF v_jordan_auth_id IS NULL THEN
    RAISE NOTICE 'Auth user % not found. Create the user in Supabase Dashboard → Authentication → Users first, then re-run.', v_jordan_email;
    RETURN;
  END IF;

  -- Create org (skip if exists)
  INSERT INTO public.orgs (name, slug)
  VALUES ('Purezza AU', 'purezza-au')
  ON CONFLICT (slug) DO NOTHING
  RETURNING id INTO v_org_id;

  -- If org already existed, look it up
  IF v_org_id IS NULL THEN
    SELECT id INTO v_org_id FROM public.orgs WHERE slug = 'purezza-au';
  END IF;

  RAISE NOTICE 'Org ID: %', v_org_id;

  -- Create Jordan's user profile (skip if exists)
  INSERT INTO public.users (id, org_id, full_name, email, role)
  VALUES (v_jordan_auth_id, v_org_id, 'Jordan', v_jordan_email, 'owner')
  ON CONFLICT (id) DO UPDATE SET org_id = EXCLUDED.org_id;

  RAISE NOTICE 'User created/updated: %', v_jordan_auth_id;

  -- Create default venue (Jordan's Melbourne territory)
  INSERT INTO public.venues (org_id, name, suburb, state, venue_type, source)
  VALUES (v_org_id, 'Jordan''s Territory — Melbourne', 'Melbourne', 'VIC', 'restaurant', 'manual')
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_venue_id;

  -- Create default pipeline stages (10 stages)
  INSERT INTO public.pipeline_stages (org_id, name, position, is_closed, color)
  VALUES
    (v_org_id, 'New',            1,   false, '#94a3b8'),
    (v_org_id, 'Contacted',      2,   false, '#60a5fa'),
    (v_org_id, 'Replied',        2.5, false, '#34d399'),
    (v_org_id, 'Meeting Booked', 3,   false, '#a78bfa'),
    (v_org_id, 'Site Visit',     3.5, false, '#f472b6'),
    (v_org_id, 'Proposal Sent',  4,   false, '#f59e0b'),
    (v_org_id, 'Demo Completed', 4.5, false, '#fb923c'),
    (v_org_id, 'Negotiation',    5,   false, '#fbbf24'),
    (v_org_id, 'Closed Won',     6,   true,  '#22c55e'),
    (v_org_id, 'Closed Lost',    7,   true,  '#ef4444')
  ON CONFLICT DO NOTHING;

  RAISE NOTICE 'Pipeline stages created for org %', v_org_id;
  RAISE NOTICE 'Seed complete. Jordan can now log in at the app URL.';

END $$;
