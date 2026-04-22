import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * CapsLabel — Phase F
 * ---------------------------------------------
 * Tiny tracked all-caps metadata label. 10px · tracked 0.08em · muted.
 * Use for eyebrows, meta rows, section kickers. Always tracked — never
 * a generic CSS text-transform uppercase (loses tracking + feels cheap).
 */
export interface CapsLabelProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Optional tone override. Defaults to the muted ink-faint. */
  tone?: 'muted' | 'onDark' | 'ink'
}

const toneClass: Record<NonNullable<CapsLabelProps['tone']>, string> = {
  muted: 'text-ink-faint',
  onDark: 'text-[color:var(--jordan-dark-muted)]',
  ink: 'text-ink-muted',
}

export const CapsLabel = React.forwardRef<HTMLSpanElement, CapsLabelProps>(
  ({ tone = 'muted', className, children, ...rest }, ref) => (
    <span
      ref={ref}
      data-slot="caps-label"
      className={cn(
        'inline-block text-[10px] leading-[14px] font-semibold uppercase tracking-[var(--jordan-tracking-label)]',
        toneClass[tone],
        className,
      )}
      {...rest}
    >
      {children}
    </span>
  ),
)
CapsLabel.displayName = 'CapsLabel'
