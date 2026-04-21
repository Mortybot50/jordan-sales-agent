-- =============================================================================
-- Jordan Sales Agent — Week 3 Day 2: Drafts table enhancements + demo seed
-- Migration: 20260422000003_drafts
-- =============================================================================

-- 1. Rename prompt_context → context_json for API consistency
ALTER TABLE email_drafts
  RENAME COLUMN prompt_context TO context_json;

-- 2. Add missing columns to email_drafts
ALTER TABLE email_drafts
  ADD COLUMN IF NOT EXISTS model text,
  ADD COLUMN IF NOT EXISTS generated_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- 3. Expand draft_type to include 'follow_up' (alongside legacy types)
ALTER TABLE email_drafts
  DROP CONSTRAINT IF EXISTS email_drafts_draft_type_check;
ALTER TABLE email_drafts
  ADD CONSTRAINT email_drafts_draft_type_check
    CHECK (draft_type IN (
      'cold_outreach',
      'follow_up',
      'follow_up_soft',
      'follow_up_close',
      'reply'
    ));

-- 4. Seed 3 demo drafts for the demo org
DO $$
DECLARE
  v_org_id  uuid := '5557189e-5c2d-4990-afad-6aa1861826cd';
  c1_id     uuid;
  c5_id     uuid;
  c7_id     uuid;
  d4_id     uuid;
  d7_id     uuid;
  d5_id     uuid;
BEGIN
  -- Resolve contact IDs by name
  SELECT id INTO c1_id FROM public.contacts WHERE org_id = v_org_id AND full_name = 'Marco Bellini' LIMIT 1;
  SELECT id INTO c5_id FROM public.contacts WHERE org_id = v_org_id AND full_name = 'Kenji Tanaka' LIMIT 1;
  SELECT id INTO c7_id FROM public.contacts WHERE org_id = v_org_id AND full_name = 'Thomas Bauer' LIMIT 1;

  -- Resolve deal IDs
  SELECT id INTO d4_id FROM public.deals WHERE org_id = v_org_id AND contact_id = c1_id LIMIT 1;
  SELECT id INTO d7_id FROM public.deals WHERE org_id = v_org_id AND contact_id = c5_id AND closed_at IS NULL LIMIT 1;
  SELECT id INTO d5_id FROM public.deals WHERE org_id = v_org_id AND contact_id = c7_id LIMIT 1;

  -- Draft 1: pending cold outreach for Marco
  INSERT INTO public.email_drafts
    (org_id, contact_id, deal_id, draft_type, subject, body, context_json, model, status, generated_at)
  VALUES (
    v_org_id, c1_id, d4_id,
    'cold_outreach',
    'Checking in — Purezza for Nero''s Kitchen',
    'Hi Marco,' || E'\n\n' ||
    'I know timing wasn''t great last month — wanted to circle back now that things have presumably settled down a little.' || E'\n\n' ||
    'We''ve just finished an install at a comparable restaurant on Brunswick St and the owner is seeing around $340/month saving on bottled water costs. Given Nero''s does around 80 covers, the numbers would be very similar for you.' || E'\n\n' ||
    'Would a quick 10-minute call this week work? I can come to the venue if that''s easier.' || E'\n\n' ||
    'Cheers,' || E'\n' ||
    'Jordan',
    '{"contact": {"name": "Marco Bellini", "venue": "Nero''s Kitchen", "venue_type": "restaurant", "cover_count": 80}, "draft_type": "cold_outreach", "last_touch": "20 hours ago"}',
    'claude-sonnet-4-6',
    'pending',
    NOW() - INTERVAL '2 hours'
  );

  -- Draft 2: edited follow-up for Kenji (site visit approaching)
  INSERT INTO public.email_drafts
    (org_id, contact_id, deal_id, draft_type, subject, body, context_json, model, status, generated_at)
  VALUES (
    v_org_id, c5_id, d7_id,
    'follow_up',
    'See you Thursday — a couple of things to prep',
    'Hi Kenji,' || E'\n\n' ||
    'Just confirming I''ll be at Sakura Fusion Thursday at 10am with the demo unit.' || E'\n\n' ||
    'I''ll bring:' || E'\n' ||
    '• The compact under-bench unit (suits your kitchen footprint perfectly)' || E'\n' ||
    '• Side-by-side taste comparison kit' || E'\n' ||
    '• ROI calculator pre-loaded with your cover count' || E'\n\n' ||
    'If the kitchen team has questions on plumbing requirements in advance, happy to answer via email. Otherwise, see you Thursday.' || E'\n\n' ||
    'Cheers,' || E'\n' ||
    'Jordan',
    '{"contact": {"name": "Kenji Tanaka", "venue": "Sakura Fusion", "venue_type": "restaurant", "cover_count": 70}, "draft_type": "follow_up", "meeting": "Site visit Thu 24 Apr 10am"}',
    'claude-sonnet-4-6',
    'edited',
    NOW() - INTERVAL '5 hours'
  );

  -- Draft 3: approved reply for Thomas (pricing question)
  INSERT INTO public.email_drafts
    (org_id, contact_id, deal_id, draft_type, subject, body, context_json, model, status, generated_at, approved_at)
  VALUES (
    v_org_id, c7_id, d5_id,
    'reply',
    'Re: Quick follow-up: Purezza for Sunrise Brasserie',
    'Hi Thomas,' || E'\n\n' ||
    'Great question — here''s a quick breakdown:' || E'\n\n' ||
    '• Monthly fee: $490/mo (36-month) or $410/mo (48-month)' || E'\n' ||
    '• No lock-in penalty after month 12 with 60 days notice' || E'\n' ||
    '• Installation included, ongoing filter maintenance included' || E'\n\n' ||
    'For a brasserie doing 90 covers, most venues see full payback vs bottled water within 11-14 months. I can put a specific ROI model together for Sunrise if that would help the decision.' || E'\n\n' ||
    'Worth a quick call this week to talk through it?' || E'\n\n' ||
    'Cheers,' || E'\n' ||
    'Jordan',
    '{"contact": {"name": "Thomas Bauer", "venue": "Sunrise Brasserie", "venue_type": "restaurant", "cover_count": 90}, "draft_type": "reply", "inbound_subject": "Re: Quick follow-up: Purezza for Sunrise Brasserie"}',
    'claude-sonnet-4-6',
    'approved',
    NOW() - INTERVAL '8 hours',
    NOW() - INTERVAL '1 hour'
  );

  RAISE NOTICE 'Demo drafts seeded for org %', v_org_id;
END $$;
