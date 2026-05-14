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

// Maps `email_drafts.draft_type` → display label + tone.
// `follow_up_soft` and `follow_up_close` correspond to the sequence engine's
// canonical 3-touch shape (PR #42): step 1 = cold_outreach, step 2 = nudge,
// step 3 = close-the-loop. Without these entries the badge falls through to
// the prettify-default ("follow up soft") which Jordan can't visually parse
// as a sequence stage.
const typeMeta: Record<string, { tone: PillTone; label: string }> = {
  cold_outreach:    { tone: 'accent',  label: 'Cold Outreach' },
  follow_up:        { tone: 'warm',    label: 'Follow-up' },
  follow_up_soft:   { tone: 'warm',    label: 'Nudge' },
  follow_up_close:  { tone: 'warning', label: 'Close-the-loop' },
  reply:            { tone: 'success', label: 'Reply' },
  nudge:            { tone: 'warning', label: 'Nudge' },
  introduction:     { tone: 'accent',  label: 'Intro' },
  re_engagement:    { tone: 'cold',    label: 'Re-engage' },
  proposal:         { tone: 'accent',  label: 'Proposal' },
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
