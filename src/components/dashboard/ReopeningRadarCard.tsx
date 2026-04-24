import { Link } from 'react-router-dom'
import { Radar, ArrowRight } from 'lucide-react'
import { CapsLabel, MetricNumber, SkeletonBlock } from '@/components/primitives'
import { useReopeningRadarKPI } from '@/lib/queries/reopeningRadar'

/**
 * Dashboard KPI: "Reopened this week" count + 30-day daily sparkline.
 * Light card — dark hero cards are capped at 4 by DarkAnchorBar.
 */
export function ReopeningRadarCard() {
  const { data, isLoading } = useReopeningRadarKPI()

  const count = data?.thisWeekCount ?? 0
  const sparkline = data?.last30d ?? []

  return (
    <Link
      to="/reopening-radar"
      className="group block rounded-[var(--jordan-radius-md)] border border-hairline bg-surface-1 px-4 py-3 transition-colors hover:border-ink-disabled/50"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <Radar className="size-3.5 text-[color:var(--jordan-accent-mint)]" />
            <CapsLabel>Reopened · this week</CapsLabel>
          </div>
          <div className="mt-1.5 h-7 flex items-baseline gap-1">
            {isLoading ? (
              <SkeletonBlock className="h-6 w-12" />
            ) : (
              <>
                <MetricNumber value={count} className="text-[22px] font-semibold text-ink" />
                <span className="text-[12px] text-ink-faint">venues</span>
              </>
            )}
          </div>
          <div className="mt-0.5 text-[11px] text-ink-faint">VIC closed → active in last 7 days</div>
        </div>
        <ArrowRight className="size-4 text-ink-faint group-hover:text-ink-muted transition-colors" />
      </div>

      <Sparkline values={sparkline} loading={isLoading} />
    </Link>
  )
}

function Sparkline({ values, loading }: { values: number[]; loading: boolean }) {
  if (loading) return <SkeletonBlock className="mt-3 h-[28px] w-full" />

  const max = Math.max(1, ...values)
  const width = 100 // viewBox units — scales via CSS
  const height = 28
  const pad = 1
  const n = values.length || 1
  const step = (width - pad * 2) / Math.max(1, n - 1)

  const points = values.map((v, i) => {
    const x = pad + i * step
    const y = height - pad - (v / max) * (height - pad * 2)
    return `${x.toFixed(2)},${y.toFixed(2)}`
  })
  const path = `M ${points.join(' L ')}`

  return (
    <div className="mt-3" aria-label={`30-day reopening trend, peak ${max}`}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        width="100%"
        height={height}
        style={{ display: 'block' }}
      >
        <path
          d={path}
          fill="none"
          stroke="var(--jordan-accent-mint)"
          strokeWidth="1.25"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        {/* baseline hairline */}
        <line
          x1="0"
          y1={height - 0.5}
          x2={width}
          y2={height - 0.5}
          stroke="var(--jordan-hairline)"
          strokeWidth="0.5"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  )
}
