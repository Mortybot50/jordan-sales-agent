import { useState } from 'react'
import { Skull } from 'lucide-react'
import { CapsLabel, MetricNumber, SkeletonBlock } from '@/components/primitives'
import { useLostReasonStats, type LostReasonStat } from '@/lib/queries/dashboard'
import { cn } from '@/lib/utils'

type WindowDays = 30 | 90 | 180

const WINDOW_OPTIONS: Array<{ value: WindowDays; label: string }> = [
  { value: 30, label: '30d' },
  { value: 90, label: '90d' },
  { value: 180, label: '6mo' },
]

/**
 * "WHY DEALS DIE" — top 5 lost-reasons over a recent window.
 * Lets Jordan see "12 deals lost to price" at a glance and adjust pitch.
 *
 * Empty state is mint (positive — no recent losses) per Dark Anchor design DNA.
 */
export function LostReasonCard() {
  const [windowDays, setWindowDays] = useState<WindowDays>(90)
  const { data: stats, isLoading } = useLostReasonStats(windowDays)

  const totalCount = (stats ?? []).reduce((sum, s) => sum + s.count, 0)
  const maxCount = Math.max(1, ...(stats ?? []).map((s) => s.count))
  const isEmpty = !isLoading && totalCount === 0

  return (
    <div
      className={cn(
        'rounded-[var(--jordan-radius-md)] border p-4 sm:p-5 h-full flex flex-col',
        isEmpty
          ? 'border-[color:var(--jordan-accent-mint)]/30 bg-[color:var(--jordan-accent-mint-soft)]'
          : 'border-hairline bg-surface-1',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <Skull
            className={cn(
              'size-3.5',
              isEmpty
                ? 'text-[color:var(--jordan-success-text)]'
                : 'text-ink-muted',
            )}
          />
          <CapsLabel
            className={cn(
              isEmpty && 'text-[color:var(--jordan-success-text)]',
            )}
          >
            Why deals die · last {windowDays}d
          </CapsLabel>
        </div>

        <div
          className="flex items-center gap-0.5 rounded-[6px] border border-hairline bg-surface-2 p-0.5 shrink-0"
          role="tablist"
          aria-label="Time window"
        >
          {WINDOW_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              role="tab"
              aria-selected={windowDays === opt.value}
              onClick={() => setWindowDays(opt.value)}
              className={cn(
                'px-2 py-0.5 text-[10px] font-medium rounded-[4px] transition-colors',
                'uppercase tracking-[var(--jordan-tracking-label)]',
                windowDays === opt.value
                  ? 'bg-surface-4 text-ink'
                  : 'text-ink-faint hover:text-ink-muted',
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3 flex-1">
        {isLoading && (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <SkeletonBlock key={i} height={22} className="rounded-[4px]" />
            ))}
          </div>
        )}

        {isEmpty && (
          <p className="text-[14px] text-[color:var(--jordan-success-text)] font-medium">
            No deals lost recently. Keep shipping.
          </p>
        )}

        {!isLoading && !isEmpty && (
          <ul className="space-y-2">
            {(stats ?? []).map((s) => (
              <ReasonRow key={s.reason} stat={s} maxCount={maxCount} />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function ReasonRow({ stat, maxCount }: { stat: LostReasonStat; maxCount: number }) {
  const widthPct = Math.max(8, (stat.count / maxCount) * 100)
  return (
    <li className="space-y-1">
      <div className="flex items-baseline justify-between gap-2 text-[12px]">
        <span className="text-ink truncate" title={stat.reason}>
          {stat.reason}
        </span>
        <span className="flex items-baseline gap-1.5 shrink-0">
          <span className="jordan-tnum text-ink font-semibold">{stat.count}</span>
          {stat.totalValue > 0 && (
            <MetricNumber
              value={stat.totalValue}
              format="currency"
              minimumFractionDigits={0}
              maximumFractionDigits={0}
              className="text-[10px] text-ink-faint jordan-tnum"
            />
          )}
        </span>
      </div>
      <div className="h-1.5 rounded-[2px] bg-surface-3 overflow-hidden">
        <div
          className="h-full bg-[color:var(--jordan-warm)]/60 transition-all"
          style={{ width: `${widthPct}%` }}
        />
      </div>
    </li>
  )
}
