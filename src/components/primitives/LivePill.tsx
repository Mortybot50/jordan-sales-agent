import { cn } from '@/lib/utils'

/**
 * LivePill — Phase F
 * ---------------------------------------------
 * Micro "Live" indicator: coloured dot + tracked caps label. No pill
 * background — it sits inline with copy. Mint tone for the default
 * data-positive feel; warning for degraded states.
 */
export interface LivePillProps {
  label?: string
  tone?: 'mint' | 'warning' | 'onDark'
  className?: string
  /** Pulse the dot. Default true. Disabled by prefers-reduced-motion. */
  pulse?: boolean
}

const toneDot: Record<NonNullable<LivePillProps['tone']>, string> = {
  mint: 'bg-[color:var(--jordan-accent-mint)] shadow-[0_0_0_3px_rgba(45,212,124,0.15)]',
  warning: 'bg-[color:var(--jordan-warning)] shadow-[0_0_0_3px_rgba(245,158,11,0.15)]',
  onDark: 'bg-[color:var(--jordan-accent-mint)] shadow-[0_0_0_3px_rgba(45,212,124,0.22)]',
}

const toneText: Record<NonNullable<LivePillProps['tone']>, string> = {
  mint: 'text-[color:var(--jordan-success-text)]',
  warning: 'text-[color:var(--jordan-warning-text)]',
  onDark: 'text-[color:var(--jordan-accent-mint)]',
}

export function LivePill({
  label = 'Live',
  tone = 'mint',
  pulse = true,
  className,
}: LivePillProps) {
  return (
    <span
      data-slot="live-pill"
      className={cn('inline-flex items-center gap-1.5 select-none', className)}
    >
      <span
        aria-hidden
        className={cn(
          'inline-block size-1.5 rounded-full',
          toneDot[tone],
          pulse && 'motion-safe:animate-pulse',
        )}
      />
      <span
        className={cn(
          'text-[10px] leading-[14px] font-semibold uppercase tracking-[var(--jordan-tracking-label)]',
          toneText[tone],
        )}
      >
        {label}
      </span>
    </span>
  )
}
