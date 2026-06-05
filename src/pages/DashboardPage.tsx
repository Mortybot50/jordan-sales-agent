import { useQueryClient } from '@tanstack/react-query'
import { RefreshCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { LivePill, PageHeader } from '@/components/primitives'
import { DarkAnchorBar } from '@/components/dashboard/DarkAnchorBar'
import { HeroGateCard } from '@/components/dashboard/HeroGateCard'
import { PipelineFinancialBar } from '@/components/dashboard/PipelineFinancialBar'
import { SetupChecklist } from '@/components/dashboard/SetupChecklist'
import { PendingInstallsCard } from '@/components/dashboard/PendingInstallsCard'
import { EarnedThisYearCard } from '@/components/dashboard/EarnedThisYearCard'
import { ReopeningRadarCard } from '@/components/dashboard/ReopeningRadarCard'
import { LostReasonCard } from '@/components/dashboard/LostReasonCard'
import { WarmLeads } from '@/components/dashboard/WarmLeads'
import { PipelineHealth } from '@/components/dashboard/PipelineHealth'
import { RecentActivity } from '@/components/dashboard/RecentActivity'
import { useJordanAnchorMetrics } from '@/lib/queries/dashboard'
import { format, formatDistanceToNowStrict } from 'date-fns'

export function DashboardPage() {
  const qc = useQueryClient()
  const { data: anchor, isLoading: anchorLoading, dataUpdatedAt } = useJordanAnchorMetrics()

  const lastUpdated = dataUpdatedAt
    ? format(new Date(dataUpdatedAt), "d MMM · HH:mm")
    : null
  const syncAgo = dataUpdatedAt
    ? formatDistanceToNowStrict(new Date(dataUpdatedAt), { addSuffix: false })
    : null

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-[1280px]">
      <PageHeader
        eyebrow="Workspace"
        title="Dashboard"
        description={lastUpdated ? `Last updated ${lastUpdated}` : 'Your sales overview at a glance.'}
        actions={
          <div className="flex items-center gap-3">
            {syncAgo && <LivePill label={`Synced ${syncAgo} ago`} />}
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              onClick={() =>
                qc.invalidateQueries({
                  predicate: (q) =>
                    Array.isArray(q.queryKey) &&
                    (q.queryKey[0] === 'dashboard' || q.queryKey[0] === 'pipeline'),
                })
              }
            >
              <RefreshCcw className="w-4 h-4 mr-1.5" />
              Refresh
            </Button>
          </div>
        }
      />

      <SetupChecklist />

      <HeroGateCard />

      <DarkAnchorBar data={anchor} loading={anchorLoading} />

      <PipelineFinancialBar />

      <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-4">
        <PendingInstallsCard />
        <EarnedThisYearCard />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <ReopeningRadarCard />
        <LostReasonCard />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <WarmLeads />
        <PipelineHealth />
      </div>

      <RecentActivity />
    </div>
  )
}
