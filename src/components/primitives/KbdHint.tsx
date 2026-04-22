import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * KbdHint — keyboard-shortcut badge.
 *
 * 10px monospace, hairline border with slightly heavier bottom edge
 * to suggest a physical key. Used on draft-queue cards, command
 * palette hints, and power-user rows.
 */
export interface KbdHintProps extends React.HTMLAttributes<HTMLElement> {
  /** Optional label to the right of the key (e.g. "Approve"). */
  label?: string
}

export const KbdHint = React.forwardRef<HTMLElement, KbdHintProps>(
  ({ label, className, children, ...rest }, ref) => {
    return (
      <span
        ref={ref as React.Ref<HTMLSpanElement>}
        data-slot="kbd-hint"
        className={cn('inline-flex items-center gap-1.5 text-[11px] text-ink-faint', className)}
        {...rest}
      >
        <kbd
          className={cn(
            'inline-flex h-[18px] min-w-[18px] items-center justify-center px-1',
            'rounded-[var(--jordan-radius-sm)] border border-b-2 border-hairline',
            'bg-surface-2 font-mono text-[10px] font-medium text-ink-muted',
          )}
        >
          {children}
        </kbd>
        {label && <span>{label}</span>}
      </span>
    )
  },
)
KbdHint.displayName = 'KbdHint'
