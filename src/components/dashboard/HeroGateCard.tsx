import { CapsLabel, MeterRail, MetricNumber, SkeletonBlock } from '@/components/primitives'
import { useMonthlyGate } from '@/lib/queries/monthlyGate'
import { cn } from '@/lib/utils'
import { format } from 'date-fns'
import { Link } from 'react-router-dom'

type AccentTone = 'mint' | 'amber' | 'red'

function toneClasses(tone: AccentTone) {
  switch (tone) {
    case 'mint':
      return {
        wrap: 'border-[color:var(--jordan-accent-mint)]/40',
        eyebrow: 'text-[color:var(--jordan-success-text)]',
        meter: 'mint' as const,
      }
    case 'amber':
      return {
        wrap: 'border-[color:var(--jordan-warm)]/40',
        eyebrow: 'text-[color:var(--jordan-warm-text)]',
        meter: 'warning' as const,
      }
    case 'red':
      return {
        wrap: 'border-[color:var(--jordan-danger)]/50',
        eyebrow: 'text-[color:var(--jordan-danger-text)]',
        meter: 'danger' as const,
      }
  }
}

export function HeroGateCard() {
  const { data, isLoading } = useMonthlyGate()

  if (isLoading || !data) {
    return <SkeletonBlock height={210} className="rounded-[10px]" />
  }

  const { current, prior, daysLeftInMonth, pacePerDayRequired } = data
  const pct = current.target_acv > 0
    ? Math.min(150, (current.achieved_acv / current.target_acv) * 100)
    : 0
  const segments = 20
  const filled = Math.max(0, Math.min(segments, Math.round((pct / 100) * segments)))
  const hit = current.hit_gate || pct >= 100
  const halfway = pct >= 50 && pct < 100
  const atRisk = pct < 50 && daysLeftInMonth <= 7

  let tone: AccentTone = 'amber'
  if (hit) tone = 'mint'
  else if (atRisk) tone = 'red'
  else if (halfway) tone = 'amber'

  const cls = toneClasses(tone)

  let paceLine: string
  if (hit) {
    paceLine = 'Already cleared. Pad the buffer or hold deals for next month.'
  } else if (daysLeftInMonth === 0) {
    paceLine = 'Last day — every dollar counts.'
  } else {
    paceLine = `Close ${pacePerDayRequired.toLocaleString('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 })}/day for the next ${daysLeftInMonth} day${daysLeftInMonth === 1 ? '' : 's'}.`
  }

  return (
    <Link
      to="/pipeline"
      aria-label="Open pipeline · this month progress"
      title="Open pipeline · this month progress"
      className={cn(
        'block rounded-[10px] border bg-[color:var(--jordan-ink)] text-white p-5 sm:p-6 space-y-4 cursor-pointer transition-colors hover:border-[color:var(--jordan-accent-mint)]/70',
        cls.wrap,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <CapsLabel tone="onDark" className={cls.eyebrow}>
          This month — {format(new Date(), 'MMMM yyyy')}
        </CapsLabel>
        <CapsLabel tone="onDark" className="text-[color:var(--jordan-dark-faint)]">
          Days left: <span className="jordan-tnum">{daysLeftInMonth}</span>
        </CapsLabel>
      </div>

      <div className="flex items-baseline gap-3 flex-wrap">
        <MetricNumber
          value={current.achieved_acv}
          format="currency"
          minimumFractionDigits={0}
          maximumFractionDigits={0}
          className="text-[44px] leading-none font-semibold"
        />
        <span className="text-[18px] text-[color:var(--jordan-dark-muted)] jordan-tnum">
          / {current.target_acv.toLocaleString('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 })}
        </span>
        <span className={cn('text-[14px] font-semibold jordan-tnum', cls.eyebrow)}>
          {pct.toFixed(0)}%
        </span>
        {hit && (
          <span className="inline-flex items-center gap-1 rounded-[6px] bg-[color:var(--jordan-accent-mint-soft)] text-[color:var(--jordan-success-text)] px-2 py-0.5 text-[12px] font-semibold">
            ✅ GATE HIT
          </span>
        )}
        {atRisk && !hit && (
          <span className="inline-flex items-center gap-1 rounded-[6px] bg-[color:var(--jordan-danger-soft)] text-[color:var(--jordan-danger-text)] px-2 py-0.5 text-[12px] font-semibold">
            ⚠️ AT RISK
          </span>
        )}
      </div>

      <MeterRail segments={segments} filled={filled} tone={cls.meter} ariaLabel="Monthly gate progress" />

      <p className="text-[13px] text-[color:var(--jordan-dark-muted)]">{paceLine}</p>

      {prior && (
        <div className="pt-3 border-t border-[color:var(--jordan-dark-border)]">
          <PriorMonthPill
            label={format(new Date(prior.month), 'MMM yyyy')}
            status={prior.prior_month_commission_status}
            amount={prior.prior_month_commission_amount}
            currentMonthHit={hit}
          />
        </div>
      )}
    </Link>
  )
}

function PriorMonthPill({
  label,
  status,
  amount,
  currentMonthHit,
}: {
  label: string
  status: 'pending' | 'unlocked' | 'forfeited' | null
  amount: number | null
  currentMonthHit: boolean
}) {
  if (status === 'unlocked' || (status === 'pending' && currentMonthHit)) {
    return (
      <p className="text-[12px] text-[color:var(--jordan-dark-muted)]">
        {label}:{' '}
        <span className="inline-flex items-center gap-1 rounded-[4px] bg-[color:var(--jordan-accent-mint-soft)] text-[color:var(--jordan-success-text)] px-1.5 py-0.5 font-medium">
          🔒 LOCKED
        </span>{' '}
        {amount != null
          ? amount.toLocaleString('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 2 })
          : ''}{' '}
        to be paid
      </p>
    )
  }
  if (status === 'forfeited') {
    return (
      <p className="text-[12px] text-[color:var(--jordan-dark-muted)]">
        {label}:{' '}
        <span className="inline-flex items-center gap-1 rounded-[4px] bg-[color:var(--jordan-danger-soft)] text-[color:var(--jordan-danger-text)] px-1.5 py-0.5 font-medium">
          ❌ FORFEITED
        </span>{' '}
        {amount != null
          ? `${amount.toLocaleString('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 2 })} lost`
          : ''}
      </p>
    )
  }
  return (
    <p className="text-[12px] text-[color:var(--jordan-dark-muted)]">
      {label}: pending — gate outcome will be settled at month-end.
    </p>
  )
}
