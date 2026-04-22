import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * DeltaBadge — Phase F
 * ---------------------------------------------
 * Delta pill with a leading arrow glyph. Goes in the top-right of
 * hero cards. Colour by direction (up = green, down = red, flat = muted).
 * Always ships an arrow prefix (↗ / ↘ / →) — part of the design DNA.
 */
export interface DeltaBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  value: number
  direction?: 'up' | 'down' | 'auto' | 'flat'
  suffix?: string
  /** Render on a dark surface — swaps the background for ink-contrast. */
  onDark?: boolean
  /** Prefix with a `+`/`-` sign on the number. Default true. */
  signed?: boolean
}

export const DeltaBadge = React.forwardRef<HTMLSpanElement, DeltaBadgeProps>(
  ({ value, direction = 'auto', suffix, onDark = false, signed = true, className, ...rest }, ref) => {
    const resolved: 'up' | 'down' | 'flat' =
      direction === 'auto'
        ? value > 0
          ? 'up'
          : value < 0
            ? 'down'
            : 'flat'
        : direction

    const arrow = resolved === 'up' ? '↗' : resolved === 'down' ? '↘' : '→'
    const magnitude = Math.abs(value)
    const sign = signed ? (resolved === 'up' ? '+' : resolved === 'down' ? '-' : '') : ''

    const tone =
      resolved === 'up'
        ? onDark
          ? 'text-[color:var(--jordan-accent-mint)] bg-[color:rgba(45,212,124,0.14)]'
          : 'text-[color:var(--jordan-success-text)] bg-[color:var(--jordan-accent-mint-soft)]'
        : resolved === 'down'
          ? onDark
            ? 'text-[#ff7a7a] bg-[color:rgba(239,68,68,0.14)]'
            : 'text-[color:var(--jordan-danger-text)] bg-[color:var(--jordan-danger-soft)]'
          : onDark
            ? 'text-[color:var(--jordan-dark-muted)] bg-[color:var(--jordan-dark-border)]'
            : 'text-ink-faint bg-surface-4'

    return (
      <span
        ref={ref}
        data-slot="delta-badge"
        data-direction={resolved}
        className={cn(
          'inline-flex items-center gap-1 rounded-[var(--jordan-radius-sm)] px-1.5 h-[20px] text-[11px] leading-none font-semibold jordan-tnum select-none',
          tone,
          className,
        )}
        {...rest}
      >
        <span aria-hidden className="text-[12px] leading-none">{arrow}</span>
        <span>
          {sign}
          {magnitude}
          {suffix}
        </span>
      </span>
    )
  },
)
DeltaBadge.displayName = 'DeltaBadge'
