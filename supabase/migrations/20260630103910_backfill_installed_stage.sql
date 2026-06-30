-- Backfill: move already-installed deals into the new Installed stage.
--
-- The kanban now renders the Installed column from stage_id (added in
-- 20260630101357_kanban_temperature_axis.sql). Deals that were marked
-- installed BEFORE that change carry install_completed_at but still sit in
-- their old stage (typically Closed), so they would never surface in the
-- Installed column. Reassign them.
--
-- Idempotent: only touches won deals that have an install date and are not
-- already in the Installed stage. Safe to re-run.

UPDATE deals d
SET stage_id = s.id,
    updated_at = now()
FROM pipeline_stages s
WHERE s.name = 'Installed'
  AND d.install_completed_at IS NOT NULL
  AND d.outcome = 'won'
  AND d.stage_id IS DISTINCT FROM s.id;
