/**
 * Canonical per-contact tier/score derivation.
 *
 * Single source of truth: a deal's `temperature` (hot|warm|cold) is the tier,
 * and `deals.score` (0–100, banded within tier) is the score. Every aggregate
 * surface (contacts list filter + SCORE column, dashboard widgets, contact
 * detail header) derives its tier/score from these via the helpers below, so
 * they can never disagree with the Kanban — which reads `temperature` directly.
 *
 * A contact can have several deals; we collapse to one "primary" deal using the
 * same rule the detail-page header uses: the newest OPEN deal (stage not closed
 * and no closed_at), else the newest deal of any kind. Picking identically
 * everywhere is what guarantees a contact shown HOT on the detail page can
 * never read Cold in the list.
 */

export type Tier = 'hot' | 'warm' | 'cold'

export interface PrimaryDealCandidate {
  closed_at?: string | null
  created_at?: string | null
  stage?: { is_closed: boolean | null } | null
  temperature?: Tier | null
  score?: number | null
}

/** Newest by created_at; rows without a timestamp sort last. */
function newestFirst<T extends PrimaryDealCandidate>(a: T, b: T): number {
  const ta = a.created_at ? new Date(a.created_at).getTime() : 0
  const tb = b.created_at ? new Date(b.created_at).getTime() : 0
  return tb - ta
}

/**
 * The contact's primary deal: newest open deal, else newest deal overall.
 * Returns null for a contact with no deals.
 */
export function pickPrimaryDeal<T extends PrimaryDealCandidate>(deals: T[] | null | undefined): T | null {
  if (!deals || deals.length === 0) return null
  const open = deals.filter((d) => !d.stage?.is_closed && !d.closed_at)
  const pool = open.length > 0 ? open : deals
  return [...pool].sort(newestFirst)[0] ?? null
}

/**
 * Derive a contact's displayed tier + score from its deals. Returns null when
 * the primary deal has no temperature (e.g. only closed deals, where heat is
 * meaningless) — surfaces render that as no tier / "—", never a Cold default.
 */
export function deriveContactLeadScore(
  deals: PrimaryDealCandidate[] | null | undefined,
): { score: number | null; tier: Tier } | null {
  const primary = pickPrimaryDeal(deals)
  if (!primary || primary.temperature == null) return null
  return { tier: primary.temperature, score: primary.score ?? null }
}
