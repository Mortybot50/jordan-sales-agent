-- BE-P1-02 — widen the uniqueness predicate on sequence_enrollments so that
-- a contact cannot be concurrently enrolled in the same sequence in either
-- 'active' OR 'paused' status.
--
-- The existing partial unique index only constrained status='active', which
-- leaves a hole: a paused enrolment + a fresh active enrolment for the same
-- (contact, sequence) would collide once the paused one resumes (or two
-- concurrent Apollo imports could each insert one of the two and both pass
-- the narrow predicate). Audit ref:
--   docs/audits/CONSOLIDATED-AUDIT-2026-05-11.md BE-P1-02
--
-- Audit-recommended DDL:
--   create unique index concurrently sequence_enrollments_contact_seq_unique
--     on sequence_enrollments (contact_id, sequence_id)
--     where status in ('active','paused');
--
-- CONCURRENTLY is omitted because Supabase wraps migrations in a transaction.
-- The table is small enough and Apollo import not yet wired, so the brief
-- AccessExclusiveLock during ordinary CREATE INDEX is acceptable. Pre-check
-- on remote DB confirmed zero (contact_id, sequence_id) duplicates across
-- ('active','paused') prior to apply.
--
-- Replacement strategy: keep the legacy active-only index in place during
-- the create so enforcement isn't briefly absent, then drop the legacy index
-- in the same migration. Same logical guarantee, wider predicate.

CREATE UNIQUE INDEX IF NOT EXISTS sequence_enrollments_contact_seq_unique
  ON public.sequence_enrollments (contact_id, sequence_id)
  WHERE status IN ('active','paused');

DROP INDEX IF EXISTS public.sequence_enrollments_seq_contact_active_idx;
