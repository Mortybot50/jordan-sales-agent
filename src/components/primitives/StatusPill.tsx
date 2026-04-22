import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * StatusPill — the single, tone-driven pill primitive.
 *
 * Replaces scattered `bg-red-100 text-red-700` hardcoded badges
 * (see plan §4.2). 18px tall, 11px text, 3px radius. Tinted bg +
 * saturated text + hairline-matching tinted border. Tones map 1:1
 * to Jordan tokens in `tokens.css`.
 */
export type PillTone =
  | 'hot'
  | 'warm'
  | 'cold'
  | 'success'
  | 'warning'
  | 'danger'
  | 'accent'
  | 'neutral'

const toneClass: Record<PillTone, string> = {
  hot:     'bg-[var(--jordan-hot-soft)] text-[var(--jordan-hot-text)] border-[color:color-mix(in_oklab,var(--jordan-hot)_24%,transparent)]',
  warm:    'bg-[var(--jordan-warm-soft)] text-[var(--jordan-warm-text)] border-[color:color-mix(in_oklab,var(--jordan-warm)_24%,transparent)]',
  cold:    'bg-[var(--jordan-cold-soft)] text-[var(--jordan-cold-text)] border-[color:color-mix(in_oklab,var(--jordan-cold)_24%,transparent)]',
  success: 'bg-[var(--jordan-success-soft)] text-[var(--jordan-success-text)] border-[color:color-mix(in_oklab,var(--jordan-success)_24%,transparent)]',
  warning: 'bg-[var(--jordan-warning-soft)] text-[var(--jordan-warning-text)] border-[color:color-mix(in_oklab,var(--jordan-warning)_24%,transparent)]',
  danger:  'bg-[var(--jordan-danger-soft)] text-[var(--jordan-danger-text)] border-[color:color-mix(in_oklab,var(--jordan-danger)_24%,transparent)]',
  accent:  'bg-[var(--jordan-accent-soft)] text-[var(--jordan-accent-hover)] border-[color:color-mix(in_oklab,var(--jordan-accent)_24%,transparent)]',
  neutral: 'bg-[var(--jordan-surface-4)] text-[var(--jordan-ink-muted)] border-[color:var(--jordan-hairline)]',
}

export interface StatusPillProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: PillTone
  /** Render as uppercase tracking-label. Default true for codes/statuses. */
  uppercase?: boolean
  /** Optional leading dot. */
  dot?: boolean
}

export const StatusPill = React.forwardRef<HTMLSpanElement, StatusPillProps>(
  ({ tone = 'neutral', uppercase = false, dot = false, className, children, ...rest }, ref) => {
    return (
      <span
        ref={ref}
        data-slot="status-pill"
        data-tone={tone}
        className={cn(
          'inline-flex items-center gap-1 rounded-[var(--jordan-radius-sm)] border px-1.5 h-[18px] text-[11px] leading-none font-medium select-none',
          uppercase && 'uppercase tracking-[var(--jordan-tracking-label)]',
          toneClass[tone],
          className,
        )}
        {...rest}
      >
        {dot && (
          <span
            aria-hidden
            className="inline-block size-1.5 rounded-full bg-current opacity-75"
          />
        )}
        {children}
      </span>
    )
  },
)
StatusPill.displayName = 'StatusPill'
