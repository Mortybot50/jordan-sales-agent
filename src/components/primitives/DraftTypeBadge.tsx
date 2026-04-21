import * as React from 'react'
import { StatusPill, type PillTone } from './StatusPill'

/**
 * DraftTypeBadge — draft category → tone pill.
 *
 * Consolidates DraftCard + DraftsPage duplication. Tone mapping is
 * intentionally narrow; add entries when adding new draft types.
 */
export interface DraftTypeBadgeProps {
  type: string
  className?: string
}

const typeMeta: Record<string, { tone: PillTone; label: string }> = {
  cold_outreach:   { tone: 'accent', label: 'Cold Outreach' },
  follow_up:       { tone: 'warm',   label: 'Follow-up' },
  reply:           { tone: 'success', label: 'Reply' },
  nudge:           { tone: 'warning', label: 'Nudge' },
  introduction:    { tone: 'accent', label: 'Intro' },
  re_engagement:   { tone: 'cold',   label: 'Re-engage' },
  proposal:        { tone: 'accent', label: 'Proposal' },
}

export const DraftTypeBadge = React.forwardRef<HTMLSpanElement, DraftTypeBadgeProps>(
  ({ type, className }, ref) => {
    const meta = typeMeta[type] ?? { tone: 'neutral' as PillTone, label: type.replace(/_/g, ' ') }
    return (
      <StatusPill ref={ref} tone={meta.tone} uppercase className={className}>
        {meta.label}
      </StatusPill>
    )
  },
)
DraftTypeBadge.displayName = 'DraftTypeBadge'
