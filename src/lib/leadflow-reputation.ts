/**
 * leadflow-reputation — TypeScript port of the Postgres
 * `compute_inbox_reputation(p_account_id uuid)` function from migration
 * `20260519000008_week3_analytics_and_seeds.sql`.
 *
 * Kept here as the single source of truth for the formula so the client side,
 * tests, and any future Edge Function compute the same number off the same
 * inputs. The Postgres function is the runtime authority (it updates
 * `email_accounts.reputation_score` hourly); this module mirrors it for
 * testing + display-time recomputation.
 *
 * Formula (deterministic, 14-day window):
 *   if sent < 10           → return 50.0  (insufficient signal)
 *   bounce_rate_pct        = bounced / sent * 100
 *   complaint_rate_pct     = complained / sent * 100
 *   reply_rate_pct         = capped at 25 (no reward beyond a healthy floor)
 *   score = 100
 *         - bounce_rate_pct    * 5    (1% bounces costs 5 points)
 *         - complaint_rate_pct * 20   (1% complaints costs 20 points)
 *         + min(reply_rate_pct, 25)   (capped upside, max +25)
 *   clamp [0, 100], round to 1 decimal place
 */

export interface ReputationInputs {
  sent: number
  bounced: number
  complained: number
  replied: number
}

export const INSUFFICIENT_SIGNAL_SCORE = 50.0
export const MIN_SENDS_FOR_REPUTATION = 10
export const BOUNCE_WEIGHT = 5
export const COMPLAINT_WEIGHT = 20
export const REPLY_CAP_PCT = 25

export function computeInboxReputation(inputs: ReputationInputs): number {
  const { sent, bounced, complained, replied } = inputs

  // Insufficient-signal floor: identical to the SQL function's `if v_sent < 10`.
  if (sent < MIN_SENDS_FOR_REPUTATION) return INSUFFICIENT_SIGNAL_SCORE

  const bounceRatePct = (bounced / sent) * 100
  const complaintRatePct = (complained / sent) * 100
  const replyRatePct = (replied / sent) * 100
  const cappedReplyBoost = Math.min(replyRatePct, REPLY_CAP_PCT)

  let score =
    100 -
    bounceRatePct * BOUNCE_WEIGHT -
    complaintRatePct * COMPLAINT_WEIGHT +
    cappedReplyBoost

  // Clamp to [0, 100].
  if (score < 0) score = 0
  if (score > 100) score = 100

  // Round to 1 decimal place — matches numeric(5,1) in the SQL function.
  return Math.round(score * 10) / 10
}
