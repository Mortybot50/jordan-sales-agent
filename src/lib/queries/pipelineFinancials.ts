/**
 * pipelineFinancials — single source of truth for "what counts as open
 * pipeline" and "what one monetary figure represents a deal".
 *
 * Before this helper the dashboard contradicted itself: the headline
 * pipeline-value tile summed `contract_value` of every deal with
 * `closed_at IS NULL`, while the ACV/TCV bar summed `acv`/`tcv` of deals whose
 * stage was not closed. Two different "open" definitions and two different
 * monetary fields produced impossible readings like "Pipeline value $48k /
 * ACV $0", and a won deal whose stage was closed but whose `closed_at` was
 * never stamped got counted in the tile yet excluded from ACV.
 *
 * Both tiles now use `isOpenPipeline` for the set and `dealHeadlineValue` for
 * the figure, so they tell one consistent story.
 */

export interface DealFinancialRow {
  contract_value?: number | string | null
  acv?: number | string | null
  tcv?: number | string | null
  outcome?: 'won' | 'lost' | null
  closed_at?: string | null
  stage?: { is_closed?: boolean | null; name?: string | null } | null
}

const num = (v: number | string | null | undefined): number =>
  v == null ? 0 : Number(v) || 0

/**
 * Authoritative — and SOLE — "open pipeline" test. Every dashboard tile that
 * reports open-pipeline money must pass each candidate through this and nothing
 * else, so the figures can never diverge. A deal is open iff ALL hold:
 *   - it has no close timestamp (`closed_at` is null),
 *   - its stage is not a closed stage,
 *   - it is not marked lost (`outcome`), and
 *   - its stage name doesn't read "...Lost" (legacy rows where `outcome` was
 *     never set but the stage is a lost stage).
 * Callers must NOT pre-filter the candidate set on their own (e.g. a query-level
 * `closed_at IS NULL`) with a different rule — that's what produced the
 * dashboard-vs-monthly-gate divergence. Pass the full set through here.
 */
export function isOpenPipeline(d: DealFinancialRow): boolean {
  if (d.closed_at) return false
  if (d.stage?.is_closed) return false
  if (d.outcome === 'lost') return false
  if (d.stage?.name && /lost/i.test(d.stage.name)) return false
  return true
}

/**
 * Best single-figure value for a deal: the catalogue-computed ACV when present
 * (set by trigger for package-priced deals since 26/04/2026), otherwise
 * `contract_value` for legacy / manually-entered deals. Identical basis to the
 * ACV bar's per-row fallback, so the pipeline tile and the ACV figure stay
 * reconciled.
 */
export function dealHeadlineValue(d: DealFinancialRow): number {
  const acv = num(d.acv)
  return acv > 0 ? acv : num(d.contract_value)
}
