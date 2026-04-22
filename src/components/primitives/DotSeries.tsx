import { cn } from '@/lib/utils'

/**
 * DotSeries — Phase F
 * ---------------------------------------------
 * A compact row of binary dots. Use for streak / completion / last-N
 * visualisations (e.g. last 7 days' Jordan Score trend). Not a chart —
 * just presence. Small enough to live inside a card footer.
 */
export interface DotSeriesProps {
  /** Total dots to render. */
  total: number
  /** How many dots are "filled" from the left. */
  filled: number
  /** Per-dot boolean array — if provided, overrides `filled`. */
  pattern?: boolean[]
  tone?: 'mint' | 'blue' | 'onDark'
  size?: 'sm' | 'md'
  className?: string
  ariaLabel?: string
}

const toneFill: Record<NonNullable<DotSeriesProps['tone']>, string> = {
  mint: 'bg-[color:var(--jordan-accent-mint)]',
  blue: 'bg-[color:var(--jordan-accent)]',
  onDark: 'bg-white',
}

const toneEmpty: Record<NonNullable<DotSeriesProps['tone']>, string> = {
  mint: 'bg-[color:var(--jordan-hairline)]',
  blue: 'bg-[color:var(--jordan-hairline)]',
  onDark: 'bg-[color:var(--jordan-dark-border)]',
}

export function DotSeries({
  total,
  filled,
  pattern,
  tone = 'mint',
  size = 'sm',
  className,
  ariaLabel,
}: DotSeriesProps) {
  const count = Math.max(1, Math.round(total))
  const sizeClass = size === 'md' ? 'size-[8px]' : 'size-[6px]'
  const gapClass = size === 'md' ? 'gap-1.5' : 'gap-1'
  const states = pattern ?? Array.from({ length: count }).map((_, i) => i < filled)

  return (
    <div
      role="img"
      aria-label={ariaLabel}
      className={cn('inline-flex items-center', gapClass, className)}
    >
      {states.slice(0, count).map((on, i) => (
        <span
          key={i}
          aria-hidden
          className={cn(
            'rounded-full',
            sizeClass,
            on ? toneFill[tone] : toneEmpty[tone],
          )}
        />
      ))}
    </div>
  )
}
