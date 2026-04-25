import { CapsLabel, MetricNumber, SkeletonBlock } from '@/components/primitives'
import { usePipelineFinancials } from '@/lib/queries/monthlyGate'
import { format } from 'date-fns'
import { formatCurrency } from '@/lib/utils'

export function EarnedThisYearCard() {
  const { data, isLoading } = usePipelineFinancials()

  if (isLoading || !data) {
    return <SkeletonBlock height={140} className="rounded-[10px]" />
  }

  const year = format(new Date(), 'yyyy')
  const forecasted = data.forecastedCommission
  const forecastedCount = data.forecastedCommissionCount

  return (
    <div className="rounded-[10px] border border-[color:var(--jordan-accent-mint)]/30 bg-[color:var(--jordan-accent-mint-soft)] p-4 sm:p-5 h-full flex flex-col justify-between">
      <div>
        <CapsLabel className="text-[color:var(--jordan-success-text)]">
          Earned · {year}
        </CapsLabel>
        <p className="text-[12px] text-ink-muted mt-0.5">
          Counted on install · won deals awaiting install show in Forecasted
        </p>
      </div>
      <div className="mt-3 space-y-2">
        <MetricNumber
          value={data.earnedThisYearCommission}
          format="currency"
          minimumFractionDigits={2}
          maximumFractionDigits={2}
          className="text-[32px] font-semibold text-ink"
        />
        {forecasted > 0 && (
          <div className="flex items-baseline justify-between gap-2 pt-1.5 border-t border-[color:var(--jordan-accent-mint)]/20">
            <span className="text-[10px] uppercase tracking-[var(--jordan-tracking-label)] text-[color:var(--jordan-warm-text)]">
              Forecasted (awaiting install)
            </span>
            <span
              className="jordan-tnum text-[14px] font-semibold text-[color:var(--jordan-warm-text)]"
              title={`${forecastedCount} won deal${forecastedCount === 1 ? '' : 's'} awaiting install`}
            >
              {formatCurrency(forecasted)}
              <span className="ml-1 text-[10px] font-normal text-ink-faint">
                · {forecastedCount} deal{forecastedCount === 1 ? '' : 's'}
              </span>
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
