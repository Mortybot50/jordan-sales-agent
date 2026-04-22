import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * Skeleton family — structured pulse placeholders that match the final
 * rendered shape. Replaces "Loading…" text and ad-hoc pulsing divs.
 *
 * `SkeletonBase` is the pulse primitive; specialised variants compose
 * it into realistic row/card/block shells.
 */

const SkeletonBase = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...rest }, ref) => (
    <div
      ref={ref}
      data-slot="skeleton"
      aria-hidden
      className={cn(
        'animate-pulse rounded-[var(--jordan-radius-sm)] bg-[var(--jordan-surface-4)]',
        className,
      )}
      {...rest}
    />
  ),
)
SkeletonBase.displayName = 'SkeletonBase'

/** A single table-like row. Default 32px height (locked by Morty for Phase A). */
export interface SkeletonRowProps extends React.HTMLAttributes<HTMLDivElement> {
  columns?: number
  height?: number
}

export const SkeletonRow = React.forwardRef<HTMLDivElement, SkeletonRowProps>(
  ({ columns = 4, height = 32, className, style, ...rest }, ref) => {
    return (
      <div
        ref={ref}
        data-slot="skeleton-row"
        className={cn(
          'flex items-center gap-3 border-b border-hairline px-3',
          className,
        )}
        style={{ height, ...style }}
        {...rest}
      >
        {Array.from({ length: columns }).map((_, i) => (
          <SkeletonBase
            key={i}
            className={cn('h-3', i === 0 ? 'w-[22%]' : i === 1 ? 'w-[18%]' : 'w-[14%]')}
          />
        ))}
      </div>
    )
  },
)
SkeletonRow.displayName = 'SkeletonRow'

/** A rectangular block — for KPI tile, chart, etc. */
export interface SkeletonBlockProps extends React.HTMLAttributes<HTMLDivElement> {
  height?: number | string
  width?: number | string
}

export const SkeletonBlock = React.forwardRef<HTMLDivElement, SkeletonBlockProps>(
  ({ height = 80, width = '100%', className, style, ...rest }, ref) => {
    return (
      <SkeletonBase
        ref={ref}
        className={cn('rounded-[var(--jordan-radius-md)]', className)}
        style={{ height, width, ...style }}
        {...rest}
      />
    )
  },
)
SkeletonBlock.displayName = 'SkeletonBlock'

/** A card — hairline border, padded body with lines. */
export interface SkeletonCardProps extends React.HTMLAttributes<HTMLDivElement> {
  lines?: number
  withAvatar?: boolean
}

export const SkeletonCard = React.forwardRef<HTMLDivElement, SkeletonCardProps>(
  ({ lines = 3, withAvatar = false, className, ...rest }, ref) => {
    return (
      <div
        ref={ref}
        data-slot="skeleton-card"
        className={cn(
          'rounded-[var(--jordan-radius-md)] border border-hairline bg-surface-1 p-3',
          className,
        )}
        {...rest}
      >
        <div className="flex items-start gap-3">
          {withAvatar && <SkeletonBase className="size-8 rounded-full" />}
          <div className="flex-1 space-y-2">
            <SkeletonBase className="h-3 w-2/3" />
            {Array.from({ length: lines }).map((_, i) => (
              <SkeletonBase
                key={i}
                className={cn('h-2', i === lines - 1 ? 'w-1/3' : 'w-full')}
              />
            ))}
          </div>
        </div>
      </div>
    )
  },
)
SkeletonCard.displayName = 'SkeletonCard'
