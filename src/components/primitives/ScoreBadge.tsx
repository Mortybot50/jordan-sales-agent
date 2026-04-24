import * as React from 'react'
import { StatusPill } from './StatusPill'
import { MetricNumber } from './MetricNumber'
import { scoreToLabel, scoreToTone } from './score'

/**
 * ScoreBadge — lead score → hot/warm/cold pill.
 *
 * Consolidates the duplicated `scoreBadge` helper in 3+ files. Score
 * → tone mapping lives in `./score.ts` so consumers can import the
 * helpers without pulling in React.
 */
export interface ScoreBadgeProps {
  score: number | null | undefined
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
  ({ score, withLabel = false, className, title }, ref) => {
    const tone = scoreToTone(score)

    return (
      <StatusPill
        ref={ref}
        tone={tone}
        uppercase
        className={className}
        title={title ?? DEFAULT_SCORE_TOOLTIP}
      >
        {withLabel && <span>{scoreToLabel(score)}</span>}
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
