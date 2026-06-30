import * as React from 'react'
import { StatusPill } from './StatusPill'
import { MetricNumber } from './MetricNumber'
import { scoreToLabel, scoreToTone, tierToLabel, tierToTone } from './score'
import type { Tier } from '@/lib/leadTier'

/**
 * ScoreBadge — lead score → hot/warm/cold pill.
 *
 * Consolidates the duplicated `scoreBadge` helper in 3+ files. Score
 * → tone mapping lives in `./score.ts` so consumers can import the
 * helpers without pulling in React.
 */
export interface ScoreBadgeProps {
  score: number | null | undefined
  /**
   * Canonical tier (deal temperature). When provided, the pill tone + label
   * come from the tier rather than the score number, so the badge can never
   * contradict the tier shown elsewhere. The number is still the score.
   */
  tier?: Tier | null
  /** Show "HOT 82" instead of just "82". */
  withLabel?: boolean
  className?: string
  /** Override the default hospitality-scoring tooltip. */
  title?: string
}

const DEFAULT_SCORE_TOOLTIP =
  '0–100 lead score based on ICP fit + engagement + timing signals. ' +
  'Use ≥60 as daily focus threshold.'

export const ScoreBadge = React.forwardRef<HTMLSpanElement, ScoreBadgeProps>(
  ({ score, tier, withLabel = false, className, title }, ref) => {
    const tone = tier ? tierToTone(tier) : scoreToTone(score)
    const label = tier ? tierToLabel(tier) : scoreToLabel(score)

    return (
      <StatusPill
        ref={ref}
        tone={tone}
        uppercase
        className={className}
        title={title ?? DEFAULT_SCORE_TOOLTIP}
      >
        {withLabel && <span>{label}</span>}
        {score != null ? (
          <MetricNumber value={score} className="text-[11px]" />
        ) : (
          <span>—</span>
        )}
      </StatusPill>
    )
  },
)
ScoreBadge.displayName = 'ScoreBadge'
