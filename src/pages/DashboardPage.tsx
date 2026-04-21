import { KPIBar } from '@/components/dashboard/KPIBar'
import { WarmLeads } from '@/components/dashboard/WarmLeads'
import { PipelineHealth } from '@/components/dashboard/PipelineHealth'
import { RecentActivity } from '@/components/dashboard/RecentActivity'
import { useDashboardKPIs } from '@/lib/queries/dashboard'

export function DashboardPage() {
  const { data: kpis, isLoading: kpisLoading, error: kpisError } = useDashboardKPIs()

  const emptyKPIs = {
    replyRate: null,
    meetingRate: null,
    pipelineValue: 0,
    followupsDueToday: 0,
    closesThisMonth: 0,
  }

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-6xl">
      <div>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-muted-foreground text-sm mt-0.5">
          Your sales overview at a glance.
        </p>
      </div>

      {kpisError && (
        <div className="text-destructive text-sm p-4 bg-destructive/10 rounded-md">
          Failed to load KPIs: {kpisError.message}
        </div>
      )}

      <KPIBar kpis={kpis ?? emptyKPIs} loading={kpisLoading} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <WarmLeads />
        <PipelineHealth />
      </div>

      <RecentActivity />
    </div>
  )
}
