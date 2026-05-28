-- =============================================================================
-- Extend `suppression_list_source_check` to allow source='unsubscribe'.
-- Migration: 20260528100500_suppression_source_allow_unsubscribe
-- =============================================================================
-- Audit AUDIT-2026-05-28 P1-DB-03 flagged the risk that any future code path
-- inserting suppression rows with source='unsubscribe' would silently fail the
-- CHECK constraint. Current code paths use 'manual', 'leadflow_unsubscribe_post',
-- 'leadflow_bounce_scan' (all already allowed), but the audit recommended
-- extending the allowlist for defensive clarity.
--
-- Pattern: ALTER ... DROP CONSTRAINT then ADD with the new value list.
-- Idempotent via existence check on the constraint name.
-- =============================================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'suppression_list_source_check'
      AND conrelid = 'public.suppression_list'::regclass
  ) THEN
    ALTER TABLE public.suppression_list DROP CONSTRAINT suppression_list_source_check;
  END IF;
END $$;

ALTER TABLE public.suppression_list
  ADD CONSTRAINT suppression_list_source_check
  CHECK (source = ANY (ARRAY[
    'sendgrid_webhook'::text,
    'instantly_webhook'::text,
    'manual'::text,
    'manual_single'::text,
    'manual_bulk'::text,
    'manual_csv'::text,
    'manual_domain'::text,
    'unsubscribe'::text,
    'leadflow_unsubscribe_post'::text,
    'leadflow_bounce_scan'::text
  ]));
