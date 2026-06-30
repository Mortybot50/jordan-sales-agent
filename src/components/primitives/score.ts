/**
 * Score → tone/label helpers. Split from ScoreBadge so the component
 * file only exports components (react-refresh friendly).
 *
 * Thresholds match the canonical tier bands (see src/lib/leadTier.ts):
 *   >= 80 → hot
 *   >= 50 → warm
 *   else   → cold
 *   null   → neutral
 */
import type { PillTone } from './StatusPill'

export function scoreToTone(score: number | null | undefined): PillTone {
  if (score == null) return 'neutral'
  if (score >= 80) return 'hot'
  if (score >= 50) return 'warm'
  return 'cold'
}

export function scoreToLabel(score: number | null | undefined): string {
  if (score == null) return '—'
  if (score >= 80) return 'HOT'
  if (score >= 50) return 'WARM'
  return 'COLD'
}
