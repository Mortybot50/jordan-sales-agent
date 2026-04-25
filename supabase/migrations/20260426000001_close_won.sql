-- Close Won — explicit won/lost outcome + captured final value
-- Adds: deals.outcome (won|lost|null), deals.final_value (numeric).
-- Existing closed_at + close_won_at columns are preserved untouched.
-- Backfill: any deal in a stage matching /won/ or /lost/ gets outcome stamped
-- so the dashboard immediately reflects historical state.

BEGIN;

ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS outcome text
    CHECK (outcome IN ('won', 'lost')),
  ADD COLUMN IF NOT EXISTS final_value numeric(10, 2);

CREATE INDEX IF NOT EXISTS idx_deals_outcome
  ON deals(org_id, outcome) WHERE outcome IS NOT NULL;

-- Backfill existing closed deals so the dashboard reflects state on first load.
-- Won: deal in a "won" stage (case-insensitive, but excludes "lost").
-- Lost: deal in a "lost" stage.
-- Final value defaults to acv when present, falling back to contract_value.
UPDATE deals d
   SET outcome = 'won',
       final_value = COALESCE(d.final_value, d.acv, d.contract_value),
       closed_at  = COALESCE(d.closed_at, d.close_won_at, now())
  FROM pipeline_stages ps
 WHERE d.stage_id = ps.id
   AND d.outcome IS NULL
   AND ps.name ILIKE '%won%'
   AND ps.name NOT ILIKE '%lost%';

UPDATE deals d
   SET outcome = 'lost',
       final_value = COALESCE(d.final_value, d.acv, d.contract_value),
       closed_at  = COALESCE(d.closed_at, now())
  FROM pipeline_stages ps
 WHERE d.stage_id = ps.id
   AND d.outcome IS NULL
   AND ps.name ILIKE '%lost%';

COMMIT;
