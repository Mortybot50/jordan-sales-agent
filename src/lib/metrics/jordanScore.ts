/**
 * Jordan Score — Phase F composite metric.
 * ---------------------------------------------
 * A single 0–100 number that collapses three dimensions:
 *   - Response rate       (30% weight)
 *   - Qualified meetings  (50% weight) — anchored to 15/month benchmark
 *   - Pipeline velocity   (20% weight) — WoW pipeline-$ delta %
 *
 * Called from the Dashboard and the morning briefing email. Keep the
 * formula in sync across both surfaces.
 *
 * TODO(Phase G): drive the peer-benchmark weights + meetings target
 *   from the `orgs` table instead of hard-coding (Spectra 15-meeting).
 */

export interface JordanScoreInputs {
  /** Reply rate percent (0–100). */
  responseRatePct: number | null
  /** Qualified meetings booked this month (count). */
  qualifiedMeetingsCount: number
  /** Week-over-week pipeline value delta, as percent. Clamped [-100, 100]. */
  pipelineVelocityPct: number
  /** Previous-week composite score (for trend). Optional. */
  previousScore?: number | null
}

export interface JordanScoreResult {
  /** Final score 0–100 (rounded). */
  score: number
  /** Tier bucket 1–10 — maps to a 10-segment meter rail. */
  tier: number
  /** Human-readable tier name. */
  tierLabel:
    | 'Dormant'
    | 'Building'
    | 'Fair'
    | 'Solid'
    | 'Strong'
    | 'Elite'
  /** WoW trend if `previousScore` provided, else null. */
  trend: number | null
}

/** Monthly qualified-meetings target (Spectra benchmark). */
export const JORDAN_MEETINGS_TARGET = 15

/**
 * Weekly qualified-meetings target band (hospitality benchmark).
 * 100 touches/week × 3–5% cold-to-meeting conversion = ~4, plus warm/referral
 * pipeline lifts the ceiling to ~12. Dashboard colours:
 *   ≥ MIN  → mint    (on-track)
 *    >= 4  → amber   (below target)
 *    < 4   → red     (off-target)
 */
export const JORDAN_MEETINGS_WEEKLY_TARGET_MIN = 8
export const JORDAN_MEETINGS_WEEKLY_TARGET_MAX = 12

export function qualifiedMeetingsTone(count: number): 'mint' | 'warning' | 'danger' {
  if (count >= JORDAN_MEETINGS_WEEKLY_TARGET_MIN) return 'mint'
  if (count >= 4) return 'warning'
  return 'danger'
}

export function computeJordanScore({
  responseRatePct,
  qualifiedMeetingsCount,
  pipelineVelocityPct,
  previousScore,
}: JordanScoreInputs): JordanScoreResult {
  const responseComponent = Math.max(0, Math.min(100, responseRatePct ?? 0))
  const meetingsComponent = Math.max(
    0,
    Math.min(100, (qualifiedMeetingsCount / JORDAN_MEETINGS_TARGET) * 100),
  )
  const velocityComponent = Math.max(
    0,
    Math.min(100, 50 + pipelineVelocityPct / 2),
  )

  const raw =
    responseComponent * 0.3 + meetingsComponent * 0.5 + velocityComponent * 0.2
  const score = Math.max(0, Math.min(100, Math.round(raw)))

  // Meter rail maps to 10 segments (0–9 filled)
  const tier = Math.max(1, Math.min(10, Math.ceil(score / 10) || 1))

  const tierLabel =
    score >= 85
      ? 'Elite'
      : score >= 70
        ? 'Strong'
        : score >= 55
          ? 'Solid'
          : score >= 40
            ? 'Fair'
            : score >= 20
              ? 'Building'
              : 'Dormant'

  const trend =
    typeof previousScore === 'number' ? score - previousScore : null

  return { score, tier, tierLabel, trend }
}
