import * as React from 'react'
import { StatusPill, type PillTone } from './StatusPill'

/**
 * Reply-intent values produced by the classify-reply-intent edge function.
 */
export type ReplyIntent =
  | 'positive'
  | 'objection'
  | 'unsubscribe'
  | 'ooo'
  | 'spam'
  | 'referral'
  | 'other'

const intentMeta: Record<ReplyIntent, { tone: PillTone; label: string }> = {
  positive:    { tone: 'success',  label: 'Positive' },
  objection:   { tone: 'warning',  label: 'Objection' },
  unsubscribe: { tone: 'danger',   label: 'Unsubscribe' },
  ooo:         { tone: 'neutral',  label: 'OOO' },
  spam:        { tone: 'neutral',  label: 'Spam' },
  referral:    { tone: 'accent',   label: 'Referral' },
  other:       { tone: 'neutral',  label: 'Other' },
}

export interface IntentBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  intent: string | null | undefined
}

/**
 * IntentBadge — coloured pill for AI-classified reply intent.
 *
 * Renders nothing when intent is null/undefined/unrecognised.
 */
export const IntentBadge = React.forwardRef<HTMLSpanElement, IntentBadgeProps>(
  ({ intent, className, ...rest }, ref) => {
    if (!intent) return null
    const meta = intentMeta[intent as ReplyIntent]
    if (!meta) return null

    return (
      <StatusPill
        ref={ref}
        tone={meta.tone}
        uppercase
        className={className}
        data-intent={intent}
        {...rest}
      >
        {meta.label}
      </StatusPill>
    )
  },
)
IntentBadge.displayName = 'IntentBadge'
