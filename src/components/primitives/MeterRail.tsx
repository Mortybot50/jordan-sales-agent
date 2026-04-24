import { cn } from '@/lib/utils'

/**
 * MeterRail — Phase F
 * ---------------------------------------------
 * Segmented horizontal scale, 5–8 chunks with 2px gaps. Reads as a
 * ruler, not a progress bar. Filled segments = position; empty =
 * runway. Tone selects the filled colour; empty stays a muted token.
 *
 * Use in metric cards (bottom) and goal widgets. Keep segment counts
 * stable per card so rails line up across the grid.
 */
export interface MeterRailProps {
  /** Total segments to render. Default 8. Clamp 3–16. */
  segments?: number
  /** How many filled from the left. Clamped to [0, segments]. */
  filled: number
  /** Tone of the filled segments. */
  tone?: 'mint' | 'blue' | 'warning' | 'danger' | 'onDark'
  className?: string
  ariaLabel?: string
}

const toneFill: Record<NonNullable<MeterRailProps['tone']>, string> = {
  mint: 'bg-[color:var(--jordan-accent-mint)]',
  blue: 'bg-[color:var(--jordan-accent)]',
  warning: 'bg-[color:var(--jordan-warning)]',
  danger: 'bg-[color:var(--jordan-danger)]',
  onDark: 'bg-white',
}

const toneEmpty: Record<NonNullable<MeterRailProps['tone']>, string> = {
  mint: 'bg-[color:var(--jordan-surface-4)]',
  blue: 'bg-[color:var(--jordan-surface-4)]',
  warning: 'bg-[color:var(--jordan-surface-4)]',
  danger: 'bg-[color:var(--jordan-surface-4)]',
  onDark: 'bg-[color:var(--jordan-dark-border)]',
}

export function MeterRail({
  segments = 8,
  filled,
  tone = 'mint',
  className,
  ariaLabel,
}: MeterRailProps) {
  const total = Math.max(3, Math.min(16, Math.round(segments)))
  const filledSafe = Math.max(0, Math.min(total, Math.round(filled)))
  return (
    <div
      role="meter"
      aria-label={ariaLabel}
      aria-valuenow={filledSafe}
      aria-valuemin={0}
      aria-valuemax={total}
      className={cn('flex items-center gap-[2px] w-full h-1.5', className)}
    >
      {Array.from({ length: total }).map((_, i) => (
        <span
          key={i}
          className={cn(
            'flex-1 h-full rounded-[1px] transition-[background-color] duration-150',
            i < filledSafe ? toneFill[tone] : toneEmpty[tone],
          )}
        />
      ))}
    </div>
  )
}
