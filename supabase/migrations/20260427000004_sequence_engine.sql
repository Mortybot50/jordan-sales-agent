-- Sequence Engine v1 — 3-step follow-up automation with Jordan-review.
--
-- The initial schema (20260421000001) reserved tables `sequences`,
-- `sequence_steps`, and `sequence_enrollments` as scaffolding but never
-- wired them into the app. This migration extends those tables with the
-- columns the worker + UI need, locks down RLS, and adds the link from
-- email_drafts back to the producing enrollment.
--
-- Locked rule (Jordan, 26/04/2026): the worker generates DRAFTS only.
-- Sending stays manual via the existing review queue. No auto-send path.

-- ── sequences ─────────────────────────────────────────────────────
ALTER TABLE sequences
  ADD COLUMN IF NOT EXISTS created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL;

DROP POLICY IF EXISTS sequences_org_isolation ON sequences;
CREATE POLICY sequences_org_isolation ON sequences
  FOR ALL
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()))
  WITH CHECK (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

-- ── sequence_steps ────────────────────────────────────────────────
-- Existing schema is template-based (subject_template/body_template);
-- v1 is prompt-based — Claude generates each step from the rep's voice
-- + a per-step instruction string. Templates stay nullable so the legacy
-- columns don't break inserts.
ALTER TABLE sequence_steps
  ADD COLUMN IF NOT EXISTS prompt_instructions text;

-- Default delay for legacy rows; tighten constraints for new rows.
ALTER TABLE sequence_steps
  ALTER COLUMN delay_days SET DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sequence_steps_step_number_check'
  ) THEN
    ALTER TABLE sequence_steps ADD CONSTRAINT sequence_steps_step_number_check CHECK (step_number >= 1);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sequence_steps_delay_days_check'
  ) THEN
    ALTER TABLE sequence_steps ADD CONSTRAINT sequence_steps_delay_days_check CHECK (delay_days >= 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sequence_steps_seq_step_unique'
  ) THEN
    ALTER TABLE sequence_steps ADD CONSTRAINT sequence_steps_seq_step_unique UNIQUE (sequence_id, step_number);
  END IF;
END $$;

DROP POLICY IF EXISTS sequence_steps_org_isolation ON sequence_steps;
CREATE POLICY sequence_steps_org_isolation ON sequence_steps
  FOR ALL
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()))
  WITH CHECK (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

-- ── sequence_enrollments ──────────────────────────────────────────
-- Existing schema enrolled deals; v1 enrols contacts directly so cold
-- outbound (which has no deal yet) works. deal_id stays nullable for any
-- future deal-level use.
ALTER TABLE sequence_enrollments
  ADD COLUMN IF NOT EXISTS contact_id uuid REFERENCES contacts(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS enrolled_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS next_step_due_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS last_step_fired_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_status_message text,
  ADD COLUMN IF NOT EXISTS failure_count int NOT NULL DEFAULT 0;

-- New enrolments start at step 0 (= "step 1 not yet fired"). The worker
-- increments to 1 after generating the first draft.
ALTER TABLE sequence_enrollments
  ALTER COLUMN current_step SET DEFAULT 0;

-- Tighten status CHECK to v1 vocabulary.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sequence_enrollments_status_check'
  ) THEN
    ALTER TABLE sequence_enrollments DROP CONSTRAINT sequence_enrollments_status_check;
  END IF;
END $$;

ALTER TABLE sequence_enrollments
  ADD CONSTRAINT sequence_enrollments_status_check
  CHECK (status IN ('active','completed','paused','cancelled','reply_received','failed'));

-- Drop the legacy deal-keyed unique index (the v1 enforcement is contact-keyed).
DROP INDEX IF EXISTS sequence_enrollments_deal_id_sequence_id_idx;

-- One active enrolment per (sequence, contact). Allows re-enrolling after
-- a cancel/complete by virtue of the partial predicate.
CREATE UNIQUE INDEX IF NOT EXISTS sequence_enrollments_seq_contact_active_idx
  ON sequence_enrollments (sequence_id, contact_id)
  WHERE status = 'active';

-- Hot path for the worker: pick up due enrolments quickly.
CREATE INDEX IF NOT EXISTS sequence_enrollments_due_idx
  ON sequence_enrollments (next_step_due_at)
  WHERE status = 'active';

DROP POLICY IF EXISTS sequence_enrollments_org_isolation ON sequence_enrollments;
CREATE POLICY sequence_enrollments_org_isolation ON sequence_enrollments
  FOR ALL
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()))
  WITH CHECK (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

-- ── email_drafts: link back to enrolment ──────────────────────────
ALTER TABLE email_drafts
  ADD COLUMN IF NOT EXISTS sequence_enrollment_id uuid REFERENCES sequence_enrollments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sequence_step_number int;

CREATE INDEX IF NOT EXISTS email_drafts_sequence_enrollment_idx
  ON email_drafts (sequence_enrollment_id)
  WHERE sequence_enrollment_id IS NOT NULL;
