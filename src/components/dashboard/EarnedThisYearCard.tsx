import { CapsLabel, MetricNumber, SkeletonBlock } from '@/components/primitives'
import { usePipelineFinancials } from '@/lib/queries/monthlyGate'
import { useStages } from '@/lib/queries/stages'
import { format } from 'date-fns'
import { formatCurrency } from '@/lib/utils'
import { Link } from 'react-router-dom'

export function EarnedThisYearCard() {
  const { data, isLoading } = usePipelineFinancials()
  const { data: stages } = useStages()

  if (isLoading || !data) {
    return <SkeletonBlock height={140} className="rounded-[10px]" />
  }

  const year = format(new Date(), 'yyyy')
  const forecasted = data.forecastedCommission
  const forecastedCount = data.forecastedCommissionCount
  const closedWonStage = stages?.find((s) => s.is_closed && /won/i.test(s.name))
  const to = closedWonStage ? `/pipeline?stage=${closedWonStage.id}` : '/pipeline'

  return (
    <Link
      to={to}
      aria-label="View won deals in pipeline"
      title="View won deals in pipeline"
      className="flex flex-col justify-between rounded-[10px] border border-[color:var(--jordan-accent-mint)]/30 bg-[color:var(--jordan-accent-mint-soft)] p-4 sm:p-5 h-full cursor-pointer transition-colors hover:border-[color:var(--jordan-accent-mint)]/60 hover:bg-[color:var(--jordan-accent-mint-soft)]/80"
    >
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
    </Link>
  )
}
