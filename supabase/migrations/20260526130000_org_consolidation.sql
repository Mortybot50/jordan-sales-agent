-- =============================================================================
-- Migration: org_consolidation
-- Created:   2026-05-26
-- Branch:    wave-a/address-hygiene
-- Audit:     clients/jordan/plans/org-hygiene-audit-2026-05-26.md
-- =============================================================================
--
-- Background
-- ----------
-- Prod LeadFlow DB held 4 orgs; only `5557189e-5c2d-4990-afad-6aa1861826cd`
-- ("Purezza AU", owner demo@jordan-sales-agent.test) holds real working data.
-- The other 3 are April test/demo/smoke-test artefacts with no business value:
--
--   683ea245-a8c8-4ce3-ae8a-c9065c328346  "demo"     (orphan, no user owner)
--   bb7f954d-1489-40a6-854c-50826b724845  "jordan"   (stray jordan@purezza.com.au login, no business rows)
--   cadd6ff1-8660-40a0-a6c5-6081e33e0b2a  "smoke-test-voice-rules-1777022348"  (one-off CI smoke test)
--
-- Non-canonical rows are exclusively (a) per-org seed data emitted by an old
-- bootstrap migration (pipeline_stages, signals, venues, venue_observations,
-- reopening_events) or (b) a single Reopening Radar stub-mode test contact +
-- activity from 24/04/2026 (pre-GATE-5 validation, no real business value).
-- See the audit doc for the full row inventory and salvageability assessment.
--
-- Strategy
-- --------
-- All 43 org-scoped tables FK to orgs.id with ON DELETE CASCADE (verified via
-- information_schema.referential_constraints). worker_runs uses ON DELETE
-- SET NULL but its non-canonical rows already had org_id IS NULL.
--
-- A single DELETE on `orgs` cascades every related row in one atomic step.
-- No UPDATE-to-repoint statements are needed; nothing was salvageable.
--
-- auth.users row for jordan@purezza.com.au is in a separate schema and is NOT
-- touched by this migration. If Jordan ever wants to use that login, he'll
-- need to be invited into the canonical org.
-- =============================================================================

BEGIN;

DELETE FROM public.orgs
WHERE id IN (
  '683ea245-a8c8-4ce3-ae8a-c9065c328346',  -- "demo" orphan
  'bb7f954d-1489-40a6-854c-50826b724845',  -- "jordan" / jordan@purezza.com.au
  'cadd6ff1-8660-40a0-a6c5-6081e33e0b2a'   -- smoke-test-voice-rules
);

-- Sanity probe: this assertion fires the migration BACK to a clean rollback if
-- anything other than the single canonical org survives. Catches the case
-- where a new org snuck in between audit and apply.
DO $$
DECLARE
  remaining_count integer;
BEGIN
  SELECT count(*) INTO remaining_count FROM public.orgs;
  IF remaining_count <> 1 THEN
    RAISE EXCEPTION 'org_consolidation: expected exactly 1 org after delete, got %', remaining_count;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.orgs WHERE id = '5557189e-5c2d-4990-afad-6aa1861826cd'
  ) THEN
    RAISE EXCEPTION 'org_consolidation: canonical org 5557189e missing after delete';
  END IF;
END $$;

COMMIT;
