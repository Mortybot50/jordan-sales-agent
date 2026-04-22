import { useQueryClient } from '@tanstack/react-query'
import { RefreshCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/primitives'
import { KPIBar } from '@/components/dashboard/KPIBar'
import { WarmLeads } from '@/components/dashboard/WarmLeads'
import { PipelineHealth } from '@/components/dashboard/PipelineHealth'
import { RecentActivity } from '@/components/dashboard/RecentActivity'
import { useDashboardKPIs } from '@/lib/queries/dashboard'
import { format } from 'date-fns'

const emptyKPIs = {
  replyRate: null,
  meetingRate: null,
  pipelineValue: 0,
  followupsDueToday: 0,
  closesThisMonth: 0,
}

export function DashboardPage() {
  const qc = useQueryClient()
  const { data: kpis, isLoading: kpisLoading, dataUpdatedAt } = useDashboardKPIs()

  const lastUpdated = dataUpdatedAt ? format(new Date(dataUpdatedAt), "d MMM · HH:mm") : null

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-[1200px]">
      <PageHeader
        eyebrow="Workspace"
        title="Dashboard"
        description={lastUpdated ? `Last updated ${lastUpdated}` : 'Your sales overview at a glance.'}
        actions={
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            onClick={() => qc.invalidateQueries({ queryKey: ['dashboard'] })}
          >
            <RefreshCcw className="w-4 h-4 mr-1.5" />
            Refresh
          </Button>
        }
      />

      <KPIBar kpis={kpis ?? emptyKPIs} loading={kpisLoading} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <WarmLeads />
        <PipelineHealth />
      </div>

      <RecentActivity />
    </div>
  )
}
