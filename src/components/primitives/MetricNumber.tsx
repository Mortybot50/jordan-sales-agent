import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * MetricNumber — tabular-numeral wrapper for any number.
 *
 * Replaces ad-hoc `toLocaleString()` + inline mono font usage.
 * Defaults to JetBrains Mono + tnum so columns of numbers align.
 */

export type MetricFormat = 'number' | 'currency' | 'percent' | 'compact' | 'signed'

export interface MetricNumberProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, 'children'> {
  value: number | null | undefined
  /** Formatting mode. 'number' = Intl.NumberFormat default. */
  format?: MetricFormat
  currency?: string
  locale?: string
  /** Min/max fraction digits. */
  minimumFractionDigits?: number
  maximumFractionDigits?: number
  /** Render as sans-serif instead of mono. tnum still applied. */
  sans?: boolean
  /** Placeholder when value is nullish. */
  placeholder?: string
}

function formatValue(
  value: number,
  format: MetricFormat,
  opts: {
    currency: string
    locale: string
    minimumFractionDigits?: number
    maximumFractionDigits?: number
  },
): string {
  const { locale, currency, minimumFractionDigits, maximumFractionDigits } = opts

  switch (format) {
    case 'currency':
      return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency,
        minimumFractionDigits: minimumFractionDigits ?? 0,
        maximumFractionDigits: maximumFractionDigits ?? 0,
      }).format(value)

    case 'percent':
      return new Intl.NumberFormat(locale, {
        style: 'percent',
        minimumFractionDigits: minimumFractionDigits ?? 0,
        maximumFractionDigits: maximumFractionDigits ?? 1,
      }).format(value)

    case 'compact':
      return new Intl.NumberFormat(locale, {
        notation: 'compact',
        maximumFractionDigits: maximumFractionDigits ?? 1,
      }).format(value)

    case 'signed': {
      const sign = value > 0 ? '+' : ''
      return `${sign}${new Intl.NumberFormat(locale, {
        minimumFractionDigits: minimumFractionDigits ?? 0,
        maximumFractionDigits: maximumFractionDigits ?? 0,
      }).format(value)}`
    }

    case 'number':
    default:
      return new Intl.NumberFormat(locale, {
        minimumFractionDigits,
        maximumFractionDigits,
      }).format(value)
  }
}

export const MetricNumber = React.forwardRef<HTMLSpanElement, MetricNumberProps>(
  (
    {
      value,
      format = 'number',
      currency = 'AUD',
      locale = 'en-AU',
      minimumFractionDigits,
      maximumFractionDigits,
      sans = false,
      placeholder = '—',
      className,
      ...rest
    },
    ref,
  ) => {
    const display =
      value == null || !Number.isFinite(value)
        ? placeholder
        : formatValue(value, format, {
            currency,
            locale,
            minimumFractionDigits,
            maximumFractionDigits,
          })

    return (
      <span
        ref={ref}
        data-slot="metric-number"
        className={cn(
          'jordan-tnum',
          sans ? 'font-sans' : 'font-mono',
          className,
        )}
        {...rest}
      >
        {display}
      </span>
    )
  },
)
MetricNumber.displayName = 'MetricNumber'
