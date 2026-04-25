import { Link } from 'react-router-dom'
import { ArrowUpRight } from 'lucide-react'
import { CapsLabel, MetricNumber, SkeletonBlock } from '@/components/primitives'
import { usePipelineFinancials } from '@/lib/queries/monthlyGate'
import { cn } from '@/lib/utils'

interface CardProps {
  eyebrow: string
  value: number
  hint?: string
  to?: string
  tone?: 'neutral' | 'mint' | 'amber'
}

function FinancialCard({ eyebrow, value, hint, to, tone = 'neutral' }: CardProps) {
  const toneCls =
    tone === 'mint'
      ? 'border-[color:var(--jordan-accent-mint)]/30 bg-[color:var(--jordan-accent-mint-soft)]'
      : tone === 'amber'
        ? 'border-[color:var(--jordan-warm)]/30 bg-[color:var(--jordan-warm-soft,transparent)]'
        : 'border-hairline bg-surface-1'

  const eyebrowCls =
    tone === 'mint'
      ? 'text-[color:var(--jordan-success-text)]'
      : tone === 'amber'
        ? 'text-[color:var(--jordan-warm-text)]'
        : 'text-ink-faint'

  const inner = (
    <div
      className={cn(
        'group relative rounded-[10px] border p-4 sm:p-5 h-full transition-colors',
        toneCls,
        to && 'hover:border-[color:var(--jordan-accent-mint)]/50',
      )}
    >
      <CapsLabel className={eyebrowCls}>{eyebrow}</CapsLabel>
      <div className="mt-2">
        <MetricNumber
          value={value}
          format="currency"
          minimumFractionDigits={0}
          maximumFractionDigits={0}
          className="text-[28px] font-semibold text-ink"
        />
      </div>
      {hint && <p className="text-[12px] text-ink-faint mt-1">{hint}</p>}
      {to && (
        <ArrowUpRight
          aria-hidden
          className="pointer-events-none absolute bottom-4 right-4 size-3.5 text-ink-faint opacity-50 group-hover:opacity-100 transition-opacity"
        />
      )}
    </div>
  )

  if (to) {
    return (
      <Link to={to} className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 rounded-[10px]">
        {inner}
      </Link>
    )
  }
  return inner
}

export function PipelineFinancialBar() {
  const { data, isLoading } = usePipelineFinancials()

  if (isLoading || !data) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <SkeletonBlock key={i} height={110} className="rounded-[10px]" />
        ))}
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      <FinancialCard
        eyebrow="Pipeline ACV"
        value={data.pipelineAcvOpen}
        hint="Open deals · annual contract value"
        to="/pipeline"
      />
      <FinancialCard
        eyebrow="Pipeline TCV"
        value={data.pipelineTcvOpen}
        hint="Open deals · total contract value"
        to="/pipeline"
      />
      <FinancialCard
        eyebrow="Held for Next Month"
        value={data.heldForNextMonthAcv}
        hint={`${data.heldForNextMonthCount} deal${data.heldForNextMonthCount === 1 ? '' : 's'} parked`}
        to="/pipeline"
        tone={data.heldForNextMonthCount > 0 ? 'mint' : 'neutral'}
      />
    </div>
  )
}
