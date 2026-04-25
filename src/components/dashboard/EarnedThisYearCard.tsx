import { CapsLabel, MetricNumber, SkeletonBlock } from '@/components/primitives'
import { usePipelineFinancials } from '@/lib/queries/monthlyGate'
import { format } from 'date-fns'

export function EarnedThisYearCard() {
  const { data, isLoading } = usePipelineFinancials()

  if (isLoading || !data) {
    return <SkeletonBlock height={140} className="rounded-[10px]" />
  }

  const year = format(new Date(), 'yyyy')

  return (
    <div className="rounded-[10px] border border-[color:var(--jordan-accent-mint)]/30 bg-[color:var(--jordan-accent-mint-soft)] p-4 sm:p-5 h-full flex flex-col justify-between">
      <div>
        <CapsLabel className="text-[color:var(--jordan-success-text)]">
          Earned · {year}
        </CapsLabel>
        <p className="text-[12px] text-ink-muted mt-0.5">
          Commission on installs completed this year
        </p>
      </div>
      <div className="mt-3">
        <MetricNumber
          value={data.earnedThisYearCommission}
          format="currency"
          minimumFractionDigits={2}
          maximumFractionDigits={2}
          className="text-[32px] font-semibold text-ink"
        />
      </div>
    </div>
  )
}
