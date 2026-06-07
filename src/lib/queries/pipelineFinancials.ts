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
  stage?: { is_closed?: boolean | null } | null
}

const num = (v: number | string | null | undefined): number =>
  v == null ? 0 : Number(v) || 0

/**
 * Authoritative "open pipeline" test: a deal is open iff its stage is not a
 * closed stage AND it has not been marked lost. This is the same definition
 * the monthly-gate financial bar uses (`!stage.is_closed && outcome !== 'lost'`).
 */
export function isOpenPipeline(d: DealFinancialRow): boolean {
  return !d.stage?.is_closed && d.outcome !== 'lost'
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
