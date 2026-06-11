-- =============================================================================
-- Jordan Sales Agent — Demo Data Seed
-- ⚠️  LOCAL DEVELOPMENT ONLY. Never run against the production project
--     (bsevgxhnxlkzkcalevbb). These demo rows were purged from prod on
--     11/06/2026 (backup: ~/workspace/leadflow-audit/demo-data-backup-2026-06-11.sql).
-- Run AFTER 001_initial_org_and_user.sql (local sandbox only)
-- Creates realistic Melbourne hospitality data for demo@jordan-sales-agent.test
-- =============================================================================

DO $$
DECLARE
  v_org_id uuid := '5557189e-5c2d-4990-afad-6aa1861826cd';

  -- Stage IDs (purezza-au org)
  s_new         uuid := 'b0292065-980f-45f9-a5f6-585f865df1d4';
  s_contacted   uuid := '2474a553-f9e2-46d5-99d5-7a4de1132972';
  s_meeting     uuid := 'f17f9001-0f0f-42fe-8bde-56b49556c1eb';
  s_proposal    uuid := 'f6a7eb40-4ff7-4368-82b6-4d298ddde6e7';
  s_negotiation uuid := '7e57f920-e459-4a0d-9400-cf68b63d2195';
  s_won         uuid := 'ab010cf1-8028-4801-8ae9-361ce1b5d3ce';
  s_lost        uuid := 'b7bfec73-d9a9-43d9-96af-bf8f5ca8fa08';

  -- Venue IDs
  v1 uuid; v2 uuid; v3 uuid; v4 uuid; v5 uuid;
  v6 uuid; v7 uuid; v8 uuid; v9 uuid; v10 uuid;

  -- Contact IDs
  c1 uuid; c2 uuid; c3 uuid; c4 uuid; c5 uuid;
  c6 uuid; c7 uuid; c8 uuid; c9 uuid; c10 uuid;

  -- Deal IDs
  d1 uuid; d2 uuid; d3 uuid; d4 uuid; d5 uuid;
  d6 uuid; d7 uuid; d8 uuid; d9 uuid; d10 uuid;
  d11 uuid; d12 uuid;

BEGIN

  -- =========================================================================
  -- VENUES (10) — realistic Melbourne hospitality venues (fake data)
  -- =========================================================================

  INSERT INTO public.venues (org_id, name, suburb, state, address, website, cover_count, kitchen_type, venue_type, service_style, source, icp_score)
  VALUES (v_org_id, 'Nero''s Kitchen', 'Fitzroy', 'VIC', '122 Brunswick St, Fitzroy VIC 3065', 'neroskitchen.com.au', 80, 'full_kitchen', 'restaurant', 'casual', 'manual', 72)
  RETURNING id INTO v1;

  INSERT INTO public.venues (org_id, name, suburb, state, address, website, cover_count, kitchen_type, venue_type, service_style, source, icp_score)
  VALUES (v_org_id, 'Lune de Lait Cafe', 'Carlton', 'VIC', '45 Lygon St, Carlton VIC 3053', 'lunedelait.com.au', 45, 'prep_only', 'cafe', 'fast_casual', 'manual', 58)
  RETURNING id INTO v2;

  INSERT INTO public.venues (org_id, name, suburb, state, address, website, cover_count, kitchen_type, venue_type, service_style, source, icp_score)
  VALUES (v_org_id, 'The Harbourside Bar & Grill', 'South Yarra', 'VIC', '12 Toorak Rd, South Yarra VIC 3141', 'harboursidebar.com.au', 120, 'full_kitchen', 'bar', 'pub_bistro', 'manual', 65)
  RETURNING id INTO v3;

  INSERT INTO public.venues (org_id, name, suburb, state, address, website, cover_count, kitchen_type, venue_type, service_style, source, icp_score)
  VALUES (v_org_id, 'Blackwood Function Centre', 'Docklands', 'VIC', '88 Collins St, Docklands VIC 3008', 'blackwoodfunctions.com.au', 200, 'full_kitchen', 'function_centre', 'events', 'manual', 85)
  RETURNING id INTO v4;

  INSERT INTO public.venues (org_id, name, suburb, state, address, website, cover_count, kitchen_type, venue_type, service_style, source, icp_score)
  VALUES (v_org_id, 'Sakura Fusion', 'Richmond', 'VIC', '210 Swan St, Richmond VIC 3121', 'sakurafusion.com.au', 70, 'full_kitchen', 'restaurant', 'fine_dining', 'manual', 78)
  RETURNING id INTO v5;

  INSERT INTO public.venues (org_id, name, suburb, state, address, website, cover_count, kitchen_type, venue_type, service_style, source, icp_score)
  VALUES (v_org_id, 'The Colonial Hotel', 'St Kilda', 'VIC', '3 Fitzroy St, St Kilda VIC 3182', 'colonialhotel.com.au', 150, 'full_kitchen', 'hotel', 'pub_bistro', 'manual', 90)
  RETURNING id INTO v6;

  INSERT INTO public.venues (org_id, name, suburb, state, address, website, cover_count, kitchen_type, venue_type, service_style, source, icp_score)
  VALUES (v_org_id, 'Sunrise Brasserie', 'Hawthorn', 'VIC', '67 Glenferrie Rd, Hawthorn VIC 3122', 'sunrisebrasserie.com.au', 90, 'full_kitchen', 'restaurant', 'casual', 'manual', 69)
  RETURNING id INTO v7;

  INSERT INTO public.venues (org_id, name, suburb, state, address, website, cover_count, kitchen_type, venue_type, service_style, source, icp_score)
  VALUES (v_org_id, 'Peri''s Kitchen QSR', 'Collingwood', 'VIC', '182 Smith St, Collingwood VIC 3066', 'periskitchen.com.au', 40, 'prep_only', 'qsr', 'fast_casual', 'manual', 52)
  RETURNING id INTO v8;

  INSERT INTO public.venues (org_id, name, suburb, state, address, website, cover_count, kitchen_type, venue_type, service_style, source, icp_score)
  VALUES (v_org_id, 'Ember & Oak Bar', 'Northcote', 'VIC', '55 High St, Northcote VIC 3070', 'emberandoak.com.au', 60, 'cold_only', 'bar', 'casual', 'manual', 61)
  RETURNING id INTO v9;

  INSERT INTO public.venues (org_id, name, suburb, state, address, website, cover_count, kitchen_type, venue_type, service_style, source, icp_score)
  VALUES (v_org_id, 'The Grand Pavilion', 'Albert Park', 'VIC', '1 Queens Rd, Albert Park VIC 3004', 'grandpavilion.com.au', 250, 'full_kitchen', 'function_centre', 'events', 'manual', 92)
  RETURNING id INTO v10;

  -- =========================================================================
  -- CONTACTS (10) — one per venue, mix of roles
  -- =========================================================================

  INSERT INTO public.contacts (org_id, venue_id, full_name, role, email, phone, linkedin_url, is_primary)
  VALUES (v_org_id, v1, 'Marco Bellini', 'owner', 'marco@neroskitchen.com.au', '+61412345678', 'linkedin.com/in/marco-bellini-mel', true)
  RETURNING id INTO c1;

  INSERT INTO public.contacts (org_id, venue_id, full_name, role, email, phone, linkedin_url, is_primary)
  VALUES (v_org_id, v2, 'Sophie Nguyen', 'venue_manager', 'sophie@lunedelait.com.au', '+61423456789', 'linkedin.com/in/sophie-nguyen-cafe', true)
  RETURNING id INTO c2;

  INSERT INTO public.contacts (org_id, venue_id, full_name, role, email, phone, linkedin_url, is_primary)
  VALUES (v_org_id, v3, 'Daniel Crawford', 'f_b_director', 'dcrawford@harboursidebar.com.au', '+61434567890', 'linkedin.com/in/daniel-crawford-fnb', true)
  RETURNING id INTO c3;

  INSERT INTO public.contacts (org_id, venue_id, full_name, role, email, phone, linkedin_url, is_primary)
  VALUES (v_org_id, v4, 'Amanda Wu', 'venue_manager', 'amanda@blackwoodfunctions.com.au', '+61445678901', 'linkedin.com/in/amanda-wu-events', true)
  RETURNING id INTO c4;

  INSERT INTO public.contacts (org_id, venue_id, full_name, role, email, phone, linkedin_url, is_primary)
  VALUES (v_org_id, v5, 'Kenji Tanaka', 'head_chef', 'kenji@sakurafusion.com.au', '+61456789012', 'linkedin.com/in/kenji-tanaka-chef', true)
  RETURNING id INTO c5;

  INSERT INTO public.contacts (org_id, venue_id, full_name, role, email, phone, linkedin_url, is_primary)
  VALUES (v_org_id, v6, 'Rebecca Lawson', 'f_b_director', 'rlawson@colonialhotel.com.au', '+61467890123', 'linkedin.com/in/rebecca-lawson-hotel', true)
  RETURNING id INTO c6;

  INSERT INTO public.contacts (org_id, venue_id, full_name, role, email, phone, linkedin_url, is_primary)
  VALUES (v_org_id, v7, 'Thomas Bauer', 'owner', 'tom@sunrisebrasserie.com.au', '+61478901234', 'linkedin.com/in/thomas-bauer-brasserie', true)
  RETURNING id INTO c7;

  INSERT INTO public.contacts (org_id, venue_id, full_name, role, email, phone, linkedin_url, is_primary)
  VALUES (v_org_id, v8, 'Priya Sharma', 'owner', 'priya@periskitchen.com.au', '+61489012345', 'linkedin.com/in/priya-sharma-qsr', true)
  RETURNING id INTO c8;

  INSERT INTO public.contacts (org_id, venue_id, full_name, role, email, phone, linkedin_url, is_primary)
  VALUES (v_org_id, v9, 'Liam O''Brien', 'venue_manager', 'liam@emberandoak.com.au', '+61490123456', 'linkedin.com/in/liam-obrien-bar', true)
  RETURNING id INTO c9;

  INSERT INTO public.contacts (org_id, venue_id, full_name, role, email, phone, linkedin_url, is_primary)
  VALUES (v_org_id, v10, 'Catherine DuPont', 'f_b_director', 'cat@grandpavilion.com.au', '+61401234567', 'linkedin.com/in/catherine-dupont-events', true)
  RETURNING id INTO c10;

  -- =========================================================================
  -- DEALS (12) — distributed across 7 stages
  -- New (3), Contacted (3), Meeting Booked (2), Proposal Sent (2),
  -- Negotiation (1), Closed Won (1)
  -- =========================================================================

  -- Stage: New (3)
  INSERT INTO public.deals (org_id, venue_id, contact_id, stage_id, title, contract_value, follow_up_due, created_at)
  VALUES (v_org_id, v8, c8, s_new, 'Purezza filtration for Peri''s Kitchen QSR', 1200, NOW() + INTERVAL '7 days', NOW() - INTERVAL '3 days')
  RETURNING id INTO d1;

  INSERT INTO public.deals (org_id, venue_id, contact_id, stage_id, title, contract_value, follow_up_due, created_at)
  VALUES (v_org_id, v9, c9, s_new, 'Purezza filtration for Ember & Oak Bar', 1600, NOW() + INTERVAL '5 days', NOW() - INTERVAL '5 days')
  RETURNING id INTO d2;

  INSERT INTO public.deals (org_id, venue_id, contact_id, stage_id, title, contract_value, follow_up_due, created_at)
  VALUES (v_org_id, v2, c2, s_new, 'Purezza filtration for Lune de Lait Cafe', 800, NOW() + INTERVAL '10 days', NOW() - INTERVAL '2 days')
  RETURNING id INTO d3;

  -- Stage: Contacted (3)
  INSERT INTO public.deals (org_id, venue_id, contact_id, stage_id, title, contract_value, follow_up_due, last_touch_at, created_at)
  VALUES (v_org_id, v1, c1, s_contacted, 'Purezza filtration for Nero''s Kitchen', 2400, NOW() + INTERVAL '3 days', NOW() - INTERVAL '1 day', NOW() - INTERVAL '12 days')
  RETURNING id INTO d4;

  INSERT INTO public.deals (org_id, venue_id, contact_id, stage_id, title, contract_value, follow_up_due, last_touch_at, created_at)
  VALUES (v_org_id, v7, c7, s_contacted, 'Purezza filtration for Sunrise Brasserie', 2000, NOW() + INTERVAL '2 days', NOW() - INTERVAL '2 hours', NOW() - INTERVAL '15 days')
  RETURNING id INTO d5;

  INSERT INTO public.deals (org_id, venue_id, contact_id, stage_id, title, contract_value, follow_up_due, last_touch_at, created_at)
  VALUES (v_org_id, v3, c3, s_contacted, 'Purezza filtration for The Harbourside Bar', 3200, NOW() + INTERVAL '1 day', NOW() - INTERVAL '18 hours', NOW() - INTERVAL '18 days')
  RETURNING id INTO d6;

  -- Stage: Meeting Booked (2)
  INSERT INTO public.deals (org_id, venue_id, contact_id, stage_id, title, contract_value, follow_up_due, last_touch_at, created_at)
  VALUES (v_org_id, v5, c5, s_meeting, 'Purezza filtration for Sakura Fusion', 2800, NOW() + INTERVAL '4 days', NOW() - INTERVAL '3 days', NOW() - INTERVAL '20 days')
  RETURNING id INTO d7;

  INSERT INTO public.deals (org_id, venue_id, contact_id, stage_id, title, contract_value, follow_up_due, last_touch_at, created_at)
  VALUES (v_org_id, v6, c6, s_meeting, 'Purezza filtration for The Colonial Hotel', 4800, NOW() + INTERVAL '6 days', NOW() - INTERVAL '1 day', NOW() - INTERVAL '22 days')
  RETURNING id INTO d8;

  -- Stage: Proposal Sent (2)
  INSERT INTO public.deals (org_id, venue_id, contact_id, stage_id, title, contract_value, follow_up_due, last_touch_at, created_at)
  VALUES (v_org_id, v4, c4, s_proposal, 'Purezza filtration for Blackwood Function Centre', 4400, NOW() + INTERVAL '14 days', NOW() - INTERVAL '4 days', NOW() - INTERVAL '25 days')
  RETURNING id INTO d9;

  INSERT INTO public.deals (org_id, venue_id, contact_id, stage_id, title, contract_value, follow_up_due, last_touch_at, created_at)
  VALUES (v_org_id, v10, c10, s_proposal, 'Purezza filtration for The Grand Pavilion', 4800, NOW() + INTERVAL '21 days', NOW() - INTERVAL '6 days', NOW() - INTERVAL '28 days')
  RETURNING id INTO d10;

  -- Stage: Negotiation (1)
  INSERT INTO public.deals (org_id, venue_id, contact_id, stage_id, title, contract_value, follow_up_due, last_touch_at, created_at)
  VALUES (v_org_id, v6, c6, s_negotiation, 'Purezza multi-site for Colonial Hotel Group', 4800, NOW() + INTERVAL '7 days', NOW() - INTERVAL '3 hours', NOW() - INTERVAL '30 days')
  RETURNING id INTO d11;

  -- Stage: Closed Won (1)
  INSERT INTO public.deals (org_id, venue_id, contact_id, stage_id, title, contract_value, last_touch_at, closed_at, created_at)
  VALUES (v_org_id, v5, c5, s_won, 'Purezza filtration for Sakura Fusion (pilot)', 1600, NOW() - INTERVAL '5 days', NOW() - INTERVAL '5 days', NOW() - INTERVAL '45 days')
  RETURNING id INTO d12;

  -- =========================================================================
  -- ACTIVITIES (33) — spread across 30 days, several in last 24h for Briefing
  -- =========================================================================

  -- d1: Peri's QSR — New (cold outreach)
  INSERT INTO public.activities (org_id, deal_id, contact_id, activity_type, subject, body, occurred_at)
  VALUES (v_org_id, d1, c8, 'email_outbound', 'Purezza filtered water for Peri''s Kitchen', 'Hi Priya, I''d love to show you how Purezza can reduce your plastic waste and running costs. Would a quick 10-minute call work this week?', NOW() - INTERVAL '3 days');

  -- d2: Ember & Oak — New (cold outreach)
  INSERT INTO public.activities (org_id, deal_id, contact_id, activity_type, subject, body, occurred_at)
  VALUES (v_org_id, d2, c9, 'email_outbound', 'Cut plastic, elevate guest experience at Ember & Oak', 'Hi Liam, bars like yours are seeing great results switching to filtered water on tap. Happy to share some numbers — worth a chat?', NOW() - INTERVAL '5 days');

  -- d3: Lune de Lait — New (cold outreach)
  INSERT INTO public.activities (org_id, deal_id, contact_id, activity_type, subject, body, occurred_at)
  VALUES (v_org_id, d3, c2, 'email_outbound', 'Filtered water solution for Lune de Lait Cafe', 'Hi Sophie, thought you might be interested in how Purezza could help reduce single-use plastic at your cafe. A lot of Carlton venues are making the switch this year.', NOW() - INTERVAL '2 days');

  -- d4: Nero's Kitchen — Contacted (cold + follow-up + overnight reply)
  INSERT INTO public.activities (org_id, deal_id, contact_id, activity_type, subject, body, occurred_at)
  VALUES (v_org_id, d4, c1, 'email_outbound', 'Purezza filtered water for Nero''s Kitchen', 'Hi Marco, reaching out about Purezza''s hospitality filtration solution. We work with restaurants across Melbourne and the results speak for themselves.', NOW() - INTERVAL '12 days');

  INSERT INTO public.activities (org_id, deal_id, contact_id, activity_type, subject, body, occurred_at)
  VALUES (v_org_id, d4, c1, 'email_outbound', 'Following up — Purezza for Nero''s', 'Hi Marco, just following up on my previous email. Would love to grab 15 mins this week to walk you through the ROI. Flexible on timing.', NOW() - INTERVAL '8 days');

  INSERT INTO public.activities (org_id, deal_id, contact_id, activity_type, subject, body, occurred_at)
  VALUES (v_org_id, d4, c1, 'email_inbound', 'Re: Following up — Purezza for Nero''s', 'Hi Jordan, appreciate the follow up. Can you call me next month? Bit flat out right now. — Marco', NOW() - INTERVAL '20 hours');

  INSERT INTO public.activities (org_id, deal_id, contact_id, activity_type, subject, body, occurred_at)
  VALUES (v_org_id, d4, c1, 'note', NULL, 'Marco asked to be called back next month. Set reminder for 21 May. He seemed open but timing is bad. Worth a brief reply today acknowledging.', NOW() - INTERVAL '19 hours');

  -- d5: Sunrise Brasserie — Contacted (overnight reply with pricing question)
  INSERT INTO public.activities (org_id, deal_id, contact_id, activity_type, subject, body, occurred_at)
  VALUES (v_org_id, d5, c7, 'email_outbound', 'Purezza filtration for Sunrise Brasserie', 'Hi Tom, wanted to introduce you to Purezza''s hospitality water solution. For a brasserie your size, we typically see cost payback inside 14 months.', NOW() - INTERVAL '15 days');

  INSERT INTO public.activities (org_id, deal_id, contact_id, activity_type, subject, body, occurred_at)
  VALUES (v_org_id, d5, c7, 'email_outbound', 'Quick follow-up: Purezza for Sunrise Brasserie', 'Hi Tom, just a quick nudge — would a 10-min chat work this week? Happy to send across some case studies from similar venues in Hawthorn if that helps.', NOW() - INTERVAL '10 days');

  INSERT INTO public.activities (org_id, deal_id, contact_id, activity_type, subject, body, occurred_at)
  VALUES (v_org_id, d5, c7, 'email_inbound', 'Re: Quick follow-up: Purezza for Sunrise Brasserie', 'Jordan, sounds interesting actually. What''s the monthly cost roughly? And is there a lock-in period? — Thomas', NOW() - INTERVAL '2 hours');

  -- d6: Harbourside — Contacted (overnight reply requesting call)
  INSERT INTO public.activities (org_id, deal_id, contact_id, activity_type, subject, body, occurred_at)
  VALUES (v_org_id, d6, c3, 'email_outbound', 'Reduce plastic spend at The Harbourside', 'Hi Daniel, I''m Jordan from Purezza — we help bars and restaurants eliminate single-use plastic water bottles and cut costs at the same time.', NOW() - INTERVAL '18 days');

  INSERT INTO public.activities (org_id, deal_id, contact_id, activity_type, subject, body, occurred_at)
  VALUES (v_org_id, d6, c3, 'email_outbound', 'Follow up #2 — Purezza for The Harbourside', 'Hi Daniel, following up again. We''ve just signed a venue nearby — happy to share the case study. Even a 10-min call could be worth it.', NOW() - INTERVAL '12 days');

  INSERT INTO public.activities (org_id, deal_id, contact_id, activity_type, subject, body, occurred_at)
  VALUES (v_org_id, d6, c3, 'email_inbound', 'Re: Follow up #2 — Purezza for The Harbourside', 'Hi Jordan, no worries. Can we do a quick call Thursday? I''m in the venue from 10am. — Daniel', NOW() - INTERVAL '18 hours');

  -- d7: Sakura Fusion — Meeting Booked
  INSERT INTO public.activities (org_id, deal_id, contact_id, activity_type, subject, body, occurred_at)
  VALUES (v_org_id, d7, c5, 'email_outbound', 'Purezza for Sakura Fusion', 'Hi Kenji, reaching out about our filtration solution — perfect for high-volume kitchens where water quality matters.', NOW() - INTERVAL '20 days');

  INSERT INTO public.activities (org_id, deal_id, contact_id, activity_type, subject, body, occurred_at)
  VALUES (v_org_id, d7, c5, 'email_inbound', 'Re: Purezza for Sakura Fusion', 'Jordan, interested. Can we meet at the venue next week? I''d like to see the unit. — Kenji', NOW() - INTERVAL '16 days');

  INSERT INTO public.activities (org_id, deal_id, contact_id, activity_type, subject, body, occurred_at)
  VALUES (v_org_id, d7, c5, 'call_note', NULL, 'Good call with Kenji — he wants to see the unit in person and have the kitchen team there. Very engaged. Booked site visit for 24 April at 10am.', NOW() - INTERVAL '14 days');

  INSERT INTO public.activities (org_id, deal_id, contact_id, activity_type, subject, body, occurred_at)
  VALUES (v_org_id, d7, c5, 'meeting_booked', 'Site visit confirmed — Sakura Fusion 24 Apr', 'Site visit confirmed for 24 April at 10am. Kenji will have the kitchen team present. Bring demo unit.', NOW() - INTERVAL '13 days');

  INSERT INTO public.activities (org_id, deal_id, contact_id, activity_type, subject, body, occurred_at)
  VALUES (v_org_id, d7, c5, 'stage_change', NULL, 'Stage changed: Contacted → Meeting Booked', NOW() - INTERVAL '13 days');

  -- d8: Colonial Hotel — Meeting Booked
  INSERT INTO public.activities (org_id, deal_id, contact_id, activity_type, subject, body, occurred_at)
  VALUES (v_org_id, d8, c6, 'email_outbound', 'Purezza for The Colonial Hotel', 'Hi Rebecca, hotels are one of our strongest use cases — multiple bars, restaurant, and function rooms on one system with one monthly invoice.', NOW() - INTERVAL '22 days');

  INSERT INTO public.activities (org_id, deal_id, contact_id, activity_type, subject, body, occurred_at)
  VALUES (v_org_id, d8, c6, 'email_inbound', 'Re: Purezza for The Colonial Hotel', 'Jordan, we''ve actually been looking at this. Can you come in for a meeting with our ops manager next week? — Rebecca', NOW() - INTERVAL '18 days');

  INSERT INTO public.activities (org_id, deal_id, contact_id, activity_type, subject, body, occurred_at)
  VALUES (v_org_id, d8, c6, 'meeting_booked', 'Meeting confirmed — Colonial Hotel 28 Apr', 'Meeting confirmed for 28 April at 2pm. Rebecca + their Operations Manager. Prepare multi-room proposal.', NOW() - INTERVAL '17 days');

  INSERT INTO public.activities (org_id, deal_id, contact_id, activity_type, subject, body, occurred_at)
  VALUES (v_org_id, d8, c6, 'stage_change', NULL, 'Stage changed: Contacted → Meeting Booked', NOW() - INTERVAL '17 days');

  -- d9: Blackwood FC — Proposal Sent
  INSERT INTO public.activities (org_id, deal_id, contact_id, activity_type, subject, body, occurred_at)
  VALUES (v_org_id, d9, c4, 'email_outbound', 'Purezza proposal for Blackwood Function Centre', 'Hi Amanda, please find attached our proposal for a full Purezza installation across your function rooms. Happy to walk you through it on a call.', NOW() - INTERVAL '8 days');

  INSERT INTO public.activities (org_id, deal_id, contact_id, activity_type, subject, body, occurred_at)
  VALUES (v_org_id, d9, c4, 'stage_change', NULL, 'Stage changed: Meeting Booked → Proposal Sent', NOW() - INTERVAL '8 days');

  INSERT INTO public.activities (org_id, deal_id, contact_id, activity_type, subject, body, occurred_at)
  VALUES (v_org_id, d9, c4, 'note', NULL, 'Amanda mentioned they''re comparing with a competitor. Need to send ROI breakdown and emphasise the no lock-in flexibility. Follow up in 5 days.', NOW() - INTERVAL '6 days');

  -- d10: Grand Pavilion — Proposal Sent
  INSERT INTO public.activities (org_id, deal_id, contact_id, activity_type, subject, body, occurred_at)
  VALUES (v_org_id, d10, c10, 'call_note', NULL, 'Good call with Catherine. She wants 48-month contract option for better monthly rate. Sent proposal with both 36 and 48 month pricing.', NOW() - INTERVAL '10 days');

  INSERT INTO public.activities (org_id, deal_id, contact_id, activity_type, subject, body, occurred_at)
  VALUES (v_org_id, d10, c10, 'email_outbound', 'Purezza proposal — The Grand Pavilion (36 & 48 month options)', 'Hi Catherine, as discussed, please find our proposal with both 36 and 48 month options. At 48 months you save an additional $180/month. Let me know if you have any questions.', NOW() - INTERVAL '6 days');

  INSERT INTO public.activities (org_id, deal_id, contact_id, activity_type, subject, body, occurred_at)
  VALUES (v_org_id, d10, c10, 'stage_change', NULL, 'Stage changed: Meeting Booked → Proposal Sent', NOW() - INTERVAL '6 days');

  -- d11: Colonial Hotel Group — Negotiation (overnight reply)
  INSERT INTO public.activities (org_id, deal_id, contact_id, activity_type, subject, body, occurred_at)
  VALUES (v_org_id, d11, c6, 'call_note', NULL, 'Rebecca came back with a counter: they want to bundle 3 sites at a discounted rate. Flagged to Purezza HQ. Should have answer by EOW.', NOW() - INTERVAL '5 days');

  INSERT INTO public.activities (org_id, deal_id, contact_id, activity_type, subject, body, occurred_at)
  VALUES (v_org_id, d11, c6, 'stage_change', NULL, 'Stage changed: Proposal Sent → Negotiation', NOW() - INTERVAL '4 days');

  INSERT INTO public.activities (org_id, deal_id, contact_id, activity_type, subject, body, occurred_at)
  VALUES (v_org_id, d11, c6, 'email_inbound', 'Re: Multi-site proposal — Colonial Hotel Group', 'Jordan, we''ve reviewed internally. Can you match a 15% bundle discount across 3 sites? Board meeting Thursday so timing would work well if we can agree. — Rebecca', NOW() - INTERVAL '3 hours');

  -- d12: Sakura Fusion pilot — Closed Won
  INSERT INTO public.activities (org_id, deal_id, contact_id, activity_type, subject, body, occurred_at)
  VALUES (v_org_id, d12, c5, 'stage_change', NULL, 'Stage changed: Negotiation → Closed Won — contract signed', NOW() - INTERVAL '5 days');

  INSERT INTO public.activities (org_id, deal_id, contact_id, activity_type, subject, body, occurred_at)
  VALUES (v_org_id, d12, c5, 'note', NULL, 'Contract signed! Kenji was super positive. Installation scheduled 5 May. Great reference account — ask for a Google review post-install.', NOW() - INTERVAL '5 days');

  -- =========================================================================
  -- TASKS (6) — overdue (2), due today (2), due in 1–3 days (2)
  -- =========================================================================

  INSERT INTO public.tasks (org_id, deal_id, contact_id, title, due_at, task_type)
  VALUES (v_org_id, d4, c1, 'Follow up with Marco at Nero''s — he asked to be called next month', NOW() - INTERVAL '2 days', 'follow_up');

  INSERT INTO public.tasks (org_id, deal_id, contact_id, title, due_at, task_type)
  VALUES (v_org_id, d9, c4, 'Send ROI breakdown to Amanda at Blackwood FC (comparing with competitor)', NOW() - INTERVAL '1 day', 'follow_up');

  INSERT INTO public.tasks (org_id, deal_id, contact_id, title, due_at, task_type)
  VALUES (v_org_id, d6, c3, 'Call Daniel at The Harbourside — confirmed Thursday from 10am', NOW() + INTERVAL '4 hours', 'call');

  INSERT INTO public.tasks (org_id, deal_id, contact_id, title, due_at, task_type)
  VALUES (v_org_id, d5, c7, 'Reply to Thomas at Sunrise Brasserie with monthly pricing + T&Cs', NOW() + INTERVAL '6 hours', 'follow_up');

  INSERT INTO public.tasks (org_id, deal_id, contact_id, title, due_at, task_type)
  VALUES (v_org_id, d11, c6, 'Confirm 15% bundle discount approval with Purezza HQ for Rebecca (board meeting Thu)', NOW() + INTERVAL '1 day', 'review_reply');

  INSERT INTO public.tasks (org_id, deal_id, contact_id, title, due_at, task_type)
  VALUES (v_org_id, d8, c6, 'Prep for Colonial Hotel meeting 28 Apr — bring demo unit + multi-room proposal', NOW() + INTERVAL '3 days', 'general');

  -- =========================================================================
  -- LEAD SCORES (5)
  -- =========================================================================

  INSERT INTO public.lead_scores (org_id, deal_id, score, tier, factors, scored_at)
  VALUES
    (v_org_id, d11, 92, 'hot',  '{"opens": 8, "clicks": 4, "reply_days_ago": 0, "stage": "Negotiation", "cover_count": 150, "signal": "Multi-site bundle request, board meeting Thursday — critical timing window"}', NOW() - INTERVAL '3 hours'),
    (v_org_id, d8,  87, 'hot',  '{"opens": 5, "clicks": 3, "reply_days_ago": 18, "stage": "Meeting Booked", "cover_count": 150, "signal": "Ops manager involved, hotel property — high ACV potential"}', NOW() - INTERVAL '1 day'),
    (v_org_id, d9,  75, 'warm', '{"opens": 3, "clicks": 2, "reply_days_ago": null, "stage": "Proposal Sent", "cover_count": 200, "signal": "Comparing with competitor — ROI follow-up needed urgently"}', NOW() - INTERVAL '2 days'),
    (v_org_id, d7,  70, 'warm', '{"opens": 4, "clicks": 2, "reply_days_ago": 16, "stage": "Meeting Booked", "cover_count": 70, "signal": "Site visit confirmed, kitchen team engaged"}', NOW() - INTERVAL '2 days'),
    (v_org_id, d6,  65, 'warm', '{"opens": 2, "clicks": 1, "reply_days_ago": 0, "stage": "Contacted", "cover_count": 120, "signal": "Overnight reply requesting a call — warm and responsive"}', NOW() - INTERVAL '18 hours');

  -- =========================================================================
  -- AUTO-SOURCED CANDIDATES (5) — pending review in Briefing section
  -- =========================================================================

  INSERT INTO public.auto_sourced_candidates (org_id, google_place_id, raw_data, name, address, suburb, venue_type_guess, icp_score_guess, status)
  VALUES
    (v_org_id, 'ChIJ_demo_001', '{"source": "google_places", "types": ["restaurant"], "rating": 4.5, "user_ratings_total": 312}',
     'The Brunswick Social', '187 Brunswick St, Fitzroy VIC 3065', 'Fitzroy', 'restaurant', 74, 'pending'),
    (v_org_id, 'ChIJ_demo_002', '{"source": "google_places", "types": ["bar"], "rating": 4.2, "user_ratings_total": 198}',
     'Collingwood Arms Hotel', '44 Johnston St, Collingwood VIC 3066', 'Collingwood', 'bar', 68, 'pending'),
    (v_org_id, 'ChIJ_demo_003', '{"source": "google_places", "types": ["cafe"], "rating": 4.7, "user_ratings_total": 541}',
     'Morning Ritual Espresso', '22 Gertrude St, Fitzroy VIC 3065', 'Fitzroy', 'cafe', 55, 'pending'),
    (v_org_id, 'ChIJ_demo_004', '{"source": "vcglr", "licence_type": "On-Premises", "licence_number": "37001C"}',
     'Southside Events Gallery', '99 Southbank Blvd, Southbank VIC 3006', 'Southbank', 'function_centre', 82, 'pending'),
    (v_org_id, 'ChIJ_demo_005', '{"source": "google_places", "types": ["restaurant"], "rating": 4.3, "user_ratings_total": 267}',
     'The Fitzroy Public House', '340 Brunswick St, Fitzroy VIC 3065', 'Fitzroy', 'restaurant', 71, 'pending');

  -- =========================================================================
  -- SIGNALS (3)
  -- =========================================================================

  INSERT INTO public.signals (org_id, venue_id, signal_type, signal_source, headline, detail, detected_at, is_actioned)
  VALUES
    (v_org_id, v9, 'new_venue_opening', 'vcglr',
     'New liquor licence granted — Ember & Oak Bar expansion',
     '{"licence_number": "36789A", "licence_type": "General", "suburb": "Northcote", "granted_date": "2026-04-18"}',
     NOW() - INTERVAL '3 days', false),
    (v_org_id, v4, 'new_venue_opening', 'vcglr',
     'New licence application — Blackwood Function Centre (Southbank site)',
     '{"licence_number": "36912B", "licence_type": "On-Premises", "suburb": "Southbank", "application_date": "2026-04-14"}',
     NOW() - INTERVAL '7 days', false);

  -- Leadership change (requires contact_id)
  INSERT INTO public.signals (org_id, venue_id, contact_id, signal_type, signal_source, headline, detail, detected_at, is_actioned)
  VALUES
    (v_org_id, v3, c3, 'leadership_change', 'proxycurl',
     'New F&B Director at The Harbourside Bar & Grill — Daniel Crawford',
     '{"old_title": "Bar Manager", "new_title": "F&B Director", "change_date": "2026-04-10", "linkedin_url": "linkedin.com/in/daniel-crawford-fnb"}',
     NOW() - INTERVAL '5 days', false);

  RAISE NOTICE 'Demo data seeded successfully for org %', v_org_id;
  RAISE NOTICE 'Venues: 10, Contacts: 10, Deals: 12, Activities: 33, Tasks: 6, Lead Scores: 5, Candidates: 5, Signals: 3';

END $$;
