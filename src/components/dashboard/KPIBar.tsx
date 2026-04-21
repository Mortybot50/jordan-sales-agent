import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatCurrency } from '@/lib/utils'
import type { DashboardKPIs } from '@/lib/queries/dashboard'

interface KPIBarProps {
  kpis: DashboardKPIs
  loading: boolean
}

interface KPICardProps {
  label: string
  value: string
  sublabel: string
  loading: boolean
}

function KPICard({ label, value, sublabel, loading }: KPICardProps) {
  return (
    <Card>
      <CardHeader className="pb-1 pt-3 px-4">
        <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-3">
        {loading ? (
          <div className="h-8 w-16 rounded bg-muted animate-pulse" />
        ) : (
          <p className="text-2xl font-bold">{value}</p>
        )}
        <p className="text-xs text-muted-foreground mt-0.5">{sublabel}</p>
      </CardContent>
    </Card>
  )
}

export function KPIBar({ kpis, loading }: KPIBarProps) {
  const replyRateDisplay =
    kpis.replyRate === null ? '—' : `${kpis.replyRate}%`
  const meetingRateDisplay =
    kpis.meetingRate === null ? '—' : `${kpis.meetingRate}%`

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
      <KPICard
        label="Reply Rate"
        value={replyRateDisplay}
        sublabel="this week"
        loading={loading}
      />
      <KPICard
        label="Meeting Rate"
        value={meetingRateDisplay}
        sublabel="this month"
        loading={loading}
      />
      <KPICard
        label="Pipeline Value"
        value={formatCurrency(kpis.pipelineValue)}
        sublabel="active deals"
        loading={loading}
      />
      <KPICard
        label="Follow-ups Due"
        value={String(kpis.followupsDueToday)}
        sublabel="today"
        loading={loading}
      />
      <KPICard
        label="Closes"
        value={String(kpis.closesThisMonth)}
        sublabel="this month"
        loading={loading}
      />
    </div>
  )
}
