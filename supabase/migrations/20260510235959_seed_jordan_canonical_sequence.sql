-- Canonical hospitality 3-touch cadence — Jordan's verbatim cold + nudge +
-- close-the-loop, sourced from clients/jordan/STYLE-GUIDE.md (the locked
-- voice source of truth, supplied 2026-05-10 by Jordan + Morty).
--
-- This is a template-driven sequence — sequence-tick short-circuits its
-- usual LLM path when a step has `template_variants` set and renders the
-- exact copy with `{{first_name}}` / `{{venue_name}}` / `{{suburb}}`
-- substitution. The em-dashes, line breaks and "Cheers,\nJordan" sign-offs
-- are intentional — DO NOT paraphrase if regenerating this migration.
--
-- Step 0 (= sequence_steps row with step_number=1) carries TWO variants:
--   A — Walk-by hook (used when contact's venue suburb matches a recent
--       field_visits suburb for this user, OR when venue_type is in the
--       hospitality whitelist AND a suburb is present).
--   B — LinkedIn / mixed-audience fallback.
--
-- Steps 5d and 12d (step_number=2 and 3) have a single variant each.
--
-- Locked rule (Jordan, 26/04/2026): the worker only generates DRAFTS that
-- land in the review queue with status='pending'. No auto-send path.

-- ── Schema additions ─────────────────────────────────────────────────────
-- `template_variants` carries the variant config. When set, the worker
-- skips the LLM and renders the chosen variant's templates directly. When
-- null, the worker keeps using the existing prompt_instructions path so
-- prior sequences (and any future LLM-driven sequences) keep working.
ALTER TABLE sequence_steps
  ADD COLUMN IF NOT EXISTS template_variants jsonb;

-- `is_canonical` lets the UI quickly find the org's canonical sequence
-- without name-matching. Partial unique index ensures at most one
-- canonical sequence per org.
ALTER TABLE sequences
  ADD COLUMN IF NOT EXISTS is_canonical boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS sequences_org_canonical_unique
  ON sequences (org_id) WHERE is_canonical;

-- ── Seed: Jordan's org (Purezza Australia) ───────────────────────────────
DO $$
DECLARE
  v_org_id uuid := '5557189e-5c2d-4990-afad-6aa1861826cd';
  v_user_id uuid := '027c0c4a-ea67-46ef-82ef-47fbd5d1df65';
  v_seq_id uuid;
  v_existing_id uuid;
BEGIN
  -- Idempotency — if an `is_canonical=true` row already exists for this
  -- org, do nothing. Re-running this migration must not duplicate the
  -- canonical sequence or the steps.
  SELECT id INTO v_existing_id
    FROM sequences
   WHERE org_id = v_org_id AND is_canonical = true
   LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    RAISE NOTICE 'Canonical hospitality sequence already exists (%); skipping seed', v_existing_id;
    RETURN;
  END IF;

  INSERT INTO sequences (org_id, name, description, is_active, is_canonical, created_by_user_id)
  VALUES (
    v_org_id,
    'Hospitality 3-Touch (Canonical)',
    'Jordan''s canonical 3-touch hospitality cadence — cold (Variant A walk-by / B LinkedIn) → 5d soft nudge → 12d close-the-loop. Verbatim from STYLE-GUIDE.md.',
    true,
    true,
    v_user_id
  )
  RETURNING id INTO v_seq_id;

  -- Step 1 — Day 0 cold open (two variants, rule-selected at send time).
  INSERT INTO sequence_steps (
    org_id, sequence_id, step_number, delay_days, step_type,
    subject_template, body_template, prompt_instructions, template_variants
  ) VALUES (
    v_org_id, v_seq_id, 1, 0, 'email',
    -- Plain `subject_template` / `body_template` left null — variant
    -- selection drives the actual text. Kept null so renderers know to
    -- consult template_variants instead.
    NULL, NULL, NULL,
    jsonb_build_object(
      'selection', 'rule_based',
      'variants', jsonb_build_array(
        jsonb_build_object(
          'id', 'walk_by',
          'subject_template', 'Walked past your venue',
          'body_template',
'Hi team,

I was down in {{suburb}} recently and walked past your venue {{venue_name}} — looks like a cracking venue, so thought I''d reach out.

I''m with Purezza. We put premium filtered still and sparkling water systems into hospitality venues, so your team can pour chilled water on demand into reusable glass bottles straight from the bar. No ordering, no storing, no running out mid-service.

We''re now in 6,000+ Aussie venues — Lune, Stokehouse, Hochi Mama, Tipo00 — and we''re covering install for new sign-ups this month.

Worth a quick 15-minute chat to see if it''d suit your venue? Happy to pop in next time I''m down that way.

Cheers,
Jordan',
          'when', jsonb_build_object(
            'any_of', jsonb_build_array(
              jsonb_build_object(
                'kind', 'field_visit_suburb_match',
                'lookback_days', 30
              ),
              jsonb_build_object(
                'kind', 'venue_type_in',
                'values', jsonb_build_array(
                  'restaurant','cafe','bar','hotel','function','fine_dining'
                ),
                'and_suburb_present', true
              )
            )
          )
        ),
        jsonb_build_object(
          'id', 'linkedin',
          'subject_template', 'A quick idea for your business',
          'body_template',
'Hi {{first_name}},

Came across your profile on LinkedIn.

Thought I''d reach out — I work with Purezza, Culligan and Zip. We help businesses set up filtered still, sparkling and boiling water systems. Whether that''s front of house for venues or just improving day-to-day water in the workplace.

I deal with a mix of hospitality groups, suppliers, and offices, so I''m always curious — what are you currently doing for drinking water where you are?

If it''s something you''re looking to improve or review, happy to share a few options that might suit.

Cheers,
Jordan',
          'when', NULL
        )
      )
    )
  );

  -- Step 2 — Day 5 soft nudge (single variant).
  INSERT INTO sequence_steps (
    org_id, sequence_id, step_number, delay_days, step_type,
    subject_template, body_template, prompt_instructions, template_variants
  ) VALUES (
    v_org_id, v_seq_id, 2, 5, 'email',
    NULL, NULL, NULL,
    jsonb_build_object(
      'selection', 'single',
      'variants', jsonb_build_array(
        jsonb_build_object(
          'id', 'soft_nudge',
          'subject_template', 'Following up',
          'body_template',
'Hi {{first_name}},

Just floating my note from last week back to the top of your inbox in case it got buried.

Happy to send through some quick info on how Purezza''s filtered and sparkling water system works for venues like yours — rental model, servicing included, and our branded glass bottles in place of single-use plastic.

Worth a quick chat?

Cheers,
Jordan',
          'when', NULL
        )
      )
    )
  );

  -- Step 3 — Day 12 close-the-loop (single variant). The "should I close
  -- the loop?" line is intentional and must be preserved verbatim.
  INSERT INTO sequence_steps (
    org_id, sequence_id, step_number, delay_days, step_type,
    subject_template, body_template, prompt_instructions, template_variants
  ) VALUES (
    v_org_id, v_seq_id, 3, 7, 'email',
    NULL, NULL, NULL,
    jsonb_build_object(
      'selection', 'single',
      'variants', jsonb_build_array(
        jsonb_build_object(
          'id', 'close_the_loop',
          'subject_template', 'Closing the loop',
          'body_template',
'Hi {{first_name}},

Just closing the loop on Purezza and whether it''s relevant for {{venue_name}}.

We help spaces cut bottled water costs and serve premium still and sparkling on demand. Installation is currently covered.

Worth a 10–15 min chat, or should I close the loop?

Cheers,
Jordan',
          'when', NULL
        )
      )
    )
  );
END $$;
