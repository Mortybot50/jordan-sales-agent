import * as React from 'react'
import { cn } from '@/lib/utils'
import { CapsLabel } from './CapsLabel'
import { DeltaBadge } from './DeltaBadge'
import { MeterRail } from './MeterRail'

/**
 * DarkMetricCard — Phase F signature primitive.
 * -----------------------------------------------
 * Near-black surface, white text, massive tabular hero number, delta
 * pill top-right, optional meter rail bottom, optional footer meta.
 *
 * Rule: dark cards are a FOCAL mechanism. Max 4 on the Dashboard,
 * max 3 on Pipeline. Anything non-hero stays on light cards.
 */
export interface DarkMetricCardMeter {
  segments: number
  filled: number
  label?: string
  tone?: 'mint' | 'blue' | 'warning' | 'danger' | 'onDark'
}

export interface DarkMetricCardProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  eyebrow?: string
  title: string
  /**
   * Native HTML `title` tooltip — hovers as the browser's built-in tooltip.
   * Separated from the `title` prop so subtitle text and tooltip don't collide.
   */
  titleAttr?: string
  /** The hero number (or any ReactNode — wrap your own composition). */
  value: React.ReactNode
  valueSuffix?: React.ReactNode
  delta?: number
  deltaDirection?: 'up' | 'down' | 'auto' | 'flat'
  deltaSuffix?: string
  meter?: DarkMetricCardMeter
  footer?: React.ReactNode
  /** Visual tone of the card — default near-black. `soft` uses ink-soft. */
  variant?: 'ink' | 'ink-soft'
}

export const DarkMetricCard = React.forwardRef<HTMLDivElement, DarkMetricCardProps>(
  (
    {
      eyebrow,
      title,
      titleAttr,
      value,
      valueSuffix,
      delta,
      deltaDirection = 'auto',
      deltaSuffix,
      meter,
      footer,
      variant = 'ink',
      className,
      ...rest
    },
    ref,
  ) => {
    return (
      <div
        ref={ref}
        data-slot="dark-metric-card"
        title={titleAttr}
        className={cn(
          'relative flex flex-col gap-4 rounded-[10px] p-5 text-white',
          'border border-[color:var(--jordan-dark-border)]',
          variant === 'ink'
            ? 'bg-[color:var(--jordan-ink)]'
            : 'bg-[color:var(--jordan-ink-soft)]',
          className,
        )}
        {...rest}
      >
        {/* Top row: eyebrow (left) · delta (right) */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex flex-col gap-1">
            {eyebrow && (
              <CapsLabel tone="onDark" className="text-[color:var(--jordan-dark-faint)]">
                {eyebrow}
              </CapsLabel>
            )}
            <div className="text-[14px] leading-5 font-medium text-[color:var(--jordan-dark-muted)]">
              {title}
            </div>
          </div>
          {typeof delta === 'number' && (
            <DeltaBadge
              value={delta}
              direction={deltaDirection}
              suffix={deltaSuffix}
              onDark
            />
          )}
        </div>

        {/* Hero value */}
        <div className="flex items-baseline gap-1">
          <span className="text-[44px] leading-[1] font-semibold tracking-tight jordan-tnum">
            {value}
          </span>
          {valueSuffix && (
            <span className="text-[20px] leading-none font-medium text-[color:var(--jordan-dark-muted)] jordan-tnum">
              {valueSuffix}
            </span>
          )}
        </div>

        {/* Meter rail */}
        {meter && (
          <div className="flex flex-col gap-1.5">
            <MeterRail
              segments={meter.segments}
              filled={meter.filled}
              tone={meter.tone ?? 'mint'}
              ariaLabel={meter.label}
            />
            {meter.label && (
              <div className="text-[11px] leading-4 text-[color:var(--jordan-dark-faint)] jordan-tnum">
                {meter.label}
              </div>
            )}
          </div>
        )}

        {/* Footer meta */}
        {footer && (
          <div className="pt-1 text-[11px] leading-4 text-[color:var(--jordan-dark-muted)]">
            {footer}
          </div>
        )}
      </div>
    )
  },
)
DarkMetricCard.displayName = 'DarkMetricCard'
