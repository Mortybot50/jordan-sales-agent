/**
 * Win probability scoring — UI helpers + types.
 *
 * The `win_probability` column on `deals` is computed by
 * `scripts/backfill-deal-thread-excerpt.py`. The breakdown stored in
 * `win_probability_breakdown` carries only `{rule, weight, applied, detail?}`
 * — verbose labels live here in the UI so they can be edited without
 * rewriting historical rows.
 *
 * Distinct from the legacy `lead_score` hot/warm/cold field on Contact/Deal
 * which is computed by the `compute_lead_score()` PG function (see
 * src/lib/queries/dashboard.ts and ScoreBadge consumers).
 */

export type WinProbabilityRule =
  | 'base'
  | 'engaged_inbound_majority'
  | 'recent_contact'
  | 'interest_keyword_in_subject'
  | 'hospitality_decision_maker_mailbox'
  | 'stale_contact'
  | 'generic_personal_domain'

export interface ScoreBreakdownRule {
  rule: WinProbabilityRule | string
  weight: number
  applied: boolean
  detail?: {
    in?: number
    out?: number
    days?: number | null
    kw?: string
    local?: string
    domain?: string
  }
}

export interface ThreadExcerpt {
  subject?: string | null
  last_from?: string | null
  last_body?: string | null
  /**
   * Most recent activity on this thread, ANY direction. Drives the
   * "Last touch X ago" relative-time label in the drawer. Differs from
   * `last_inbound_date` for follow-up threads where Jordan has replied
   * after the contact's last inbound.
   */
  last_date?: string | null
  /**
   * Date of the most recent INBOUND message — the subject + last_body
   * above describe that message. Older than `last_date` when an outbound
   * has happened since.
   */
  last_inbound_date?: string | null
  msg_count_inbound?: number
  msg_count_outbound?: number
  full_recent?: Array<{
    direction: 'inbound' | 'outbound'
    subject: string
    date: string | null
  }>
}

export type WinProbabilityTier = 'high' | 'medium' | 'low'

export function tierFor(score: number | null | undefined): WinProbabilityTier | null {
  if (score == null) return null
  if (score >= 61) return 'high'
  if (score >= 31) return 'medium'
  return 'low'
}

/**
 * Static labels for each rule key. UI maps the breakdown entry's `rule` field
 * through this. New rules added in the backfill script should land here too.
 */
export const RULE_LABELS: Record<string, string> = {
  base: 'Starting score',
  engaged_inbound_majority: "They're driving the conversation",
  recent_contact: 'Recent contact',
  interest_keyword_in_subject: 'Buying-intent keyword in subject',
  hospitality_decision_maker_mailbox: 'Hospitality decision-maker mailbox',
  stale_contact: 'Stale contact',
  generic_personal_domain: 'Generic personal mailbox',
}

/**
 * Render the detail snippet for a breakdown row — short and human. Mirrors
 * the score-rule logic in the backfill script so explanations stay accurate.
 */
export function renderRuleDetail(entry: ScoreBreakdownRule): string {
  const d = entry.detail ?? {}
  switch (entry.rule) {
    case 'base':
      return ''
    case 'engaged_inbound_majority':
      return `${d.in ?? 0} from them vs ${d.out ?? 0} from you`
    case 'recent_contact':
      return d.days == null ? 'Never contacted' : `${d.days} day(s) ago`
    case 'interest_keyword_in_subject':
      return d.kw ? `"${d.kw}" in last subject` : 'No matching keyword'
    case 'hospitality_decision_maker_mailbox':
      return d.local && d.domain
        ? `${d.local}@${d.domain}`
        : 'Not a recognised decision-maker mailbox'
    case 'stale_contact':
      return d.days == null ? '' : `${d.days} days since last contact`
    case 'generic_personal_domain':
      return d.domain ? d.domain : 'Not a generic domain'
    default:
      return ''
  }
}

/**
 * Returns Tailwind colour classes for the progress bar fill based on the tier.
 * Bands chosen to match the chip polish design language (PR #100):
 *   low  → danger red
 *   med  → warm amber
 *   high → accent mint (Jordan's success colour)
 */
export function tierColourClasses(tier: WinProbabilityTier | null): {
  fill: string
  text: string
} {
  switch (tier) {
    case 'high':
      return {
        fill: 'bg-[color:var(--jordan-accent-mint)]',
        text: 'text-[color:var(--jordan-success-text)]',
      }
    case 'medium':
      return {
        fill: 'bg-[color:var(--jordan-warm)]',
        text: 'text-[color:var(--jordan-warm-text)]',
      }
    case 'low':
      return {
        fill: 'bg-[color:var(--jordan-danger)]',
        text: 'text-[color:var(--jordan-danger-text)]',
      }
    default:
      return {
        fill: 'bg-ink/30',
        text: 'text-ink-faint',
      }
  }
}

export function tierLabel(tier: WinProbabilityTier | null): string {
  switch (tier) {
    case 'high':
      return 'HIGH'
    case 'medium':
      return 'MEDIUM'
    case 'low':
      return 'LOW'
    default:
      return '—'
  }
}
