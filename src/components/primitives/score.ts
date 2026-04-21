/**
 * Score → tone/label helpers. Split from ScoreBadge so the component
 * file only exports components (react-refresh friendly).
 *
 * Thresholds match existing app logic:
 *   >= 70 → hot
 *   >= 40 → warm
 *   else   → cold
 *   null   → neutral
 */
import type { PillTone } from './StatusPill'

export function scoreToTone(score: number | null | undefined): PillTone {
  if (score == null) return 'neutral'
  if (score >= 70) return 'hot'
  if (score >= 40) return 'warm'
  return 'cold'
}

export function scoreToLabel(score: number | null | undefined): string {
  if (score == null) return '—'
  if (score >= 70) return 'HOT'
  if (score >= 40) return 'WARM'
  return 'COLD'
}
