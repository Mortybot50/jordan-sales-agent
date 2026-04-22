import { MetricNumber, SkeletonBlock } from '@/components/primitives'
import { cn } from '@/lib/utils'
import type { DashboardKPIs } from '@/lib/queries/dashboard'

interface KPIBarProps {
  kpis: DashboardKPIs
  loading: boolean
}

interface KPITileProps {
  label: string
  sublabel: string
  loading: boolean
  children: React.ReactNode
  className?: string
}

function KPITile({ label, sublabel, loading, children, className }: KPITileProps) {
  return (
    <div
      className={cn(
        'rounded-[6px] border border-hairline bg-surface-1 px-4 py-3 transition-colors hover:border-ink-disabled/50',
        className,
      )}
    >
      <div className="text-[11px] uppercase tracking-[var(--jordan-tracking-label)] text-ink-faint">
        {label}
      </div>
      <div className="mt-1.5 h-7 flex items-center">
        {loading ? (
          <SkeletonBlock className="h-6 w-20" />
        ) : (
          <span className="text-[22px] leading-none font-semibold text-ink">{children}</span>
        )}
      </div>
      <div className="mt-1 text-[11px] text-ink-faint">{sublabel}</div>
    </div>
  )
}

export function KPIBar({ kpis, loading }: KPIBarProps) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
      <KPITile label="Reply Rate" sublabel="this week" loading={loading}>
        {kpis.replyRate === null ? (
          <span className="text-ink-disabled">—</span>
        ) : (
          <>
            <MetricNumber value={kpis.replyRate} className="text-[22px]" />
            <span className="ml-0.5 text-ink-muted text-[18px]">%</span>
          </>
        )}
      </KPITile>
      <KPITile label="Meeting Rate" sublabel="this month" loading={loading}>
        {kpis.meetingRate === null ? (
          <span className="text-ink-disabled">—</span>
        ) : (
          <>
            <MetricNumber value={kpis.meetingRate} className="text-[22px]" />
            <span className="ml-0.5 text-ink-muted text-[18px]">%</span>
          </>
        )}
      </KPITile>
      <KPITile label="Pipeline Value" sublabel="active deals" loading={loading}>
        <MetricNumber value={kpis.pipelineValue} format="currency" className="text-[22px]" />
      </KPITile>
      <KPITile label="Follow-ups Due" sublabel="today" loading={loading}>
        <MetricNumber value={kpis.followupsDueToday} className="text-[22px]" />
      </KPITile>
      <KPITile label="Closes" sublabel="this month" loading={loading}>
        <MetricNumber value={kpis.closesThisMonth} className="text-[22px]" />
      </KPITile>
    </div>
  )
}
