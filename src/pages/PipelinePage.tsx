import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { KanbanBoard } from '@/components/pipeline/KanbanBoard'
import { DealListView } from '@/components/pipeline/DealListView'
import { DarkMetricCard, PageHeader, SkeletonBlock } from '@/components/primitives'
import { usePipelineHeroMetrics } from '@/lib/queries/dashboard'
import { LayoutGrid, List } from 'lucide-react'
import { cn } from '@/lib/utils'

function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(() => window.innerWidth >= 1024)

  useEffect(() => {
    function handle() {
      setIsDesktop(window.innerWidth >= 1024)
    }
    window.addEventListener('resize', handle)
    return () => window.removeEventListener('resize', handle)
  }, [])

  return isDesktop
}

function compactCurrency(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`
  if (n >= 1_000) return `$${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`
  return `$${n.toLocaleString()}`
}

type ViewMode = 'kanban' | 'list'

function PipelineHeroBar() {
  const { data, isLoading } = usePipelineHeroMetrics()

  if (isLoading || !data) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 px-4 sm:px-6 pb-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <SkeletonBlock key={i} height={148} className="rounded-[10px]" />
        ))}
      </div>
    )
  }

  const pipelineMeter = {
    segments: 8,
    filled: Math.min(8, Math.max(1, Math.round(data.dealsOpen / 2))),
  }
  const closeMeter = {
    segments: 10,
    filled: Math.max(0, Math.min(10, Math.round((data.closeRatePct ?? 0) / 10))),
  }
  // Size benchmark: $50k full bar.
  const sizeMeter = {
    segments: 6,
    filled: Math.max(0, Math.min(6, Math.round((data.avgDealSize / 50_000) * 6))),
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 px-4 sm:px-6 pb-4">
      <DarkMetricCard
        eyebrow="PIPELINE"
        title="Total open value"
        value={compactCurrency(data.pipelineValue)}
        meter={{ ...pipelineMeter, label: `${data.dealsOpen} open deals` }}
      />
      <DarkMetricCard
        eyebrow="CLOSE RATE"
        title="Won vs won+lost"
        value={data.closeRatePct === null ? '—' : data.closeRatePct}
        valueSuffix={data.closeRatePct === null ? undefined : '%'}
        meter={{
          ...closeMeter,
          label: `${data.dealsWon} won · ${data.dealsLost} lost`,
        }}
      />
      <DarkMetricCard
        eyebrow="AVG DEAL"
        title="Average deal size"
        value={compactCurrency(data.avgDealSize)}
        meter={{ ...sizeMeter, label: 'vs $50k benchmark' }}
      />
    </div>
  )
}

export function PipelinePage() {
  const isDesktop = useIsDesktop()
  const [view, setView] = useState<ViewMode | null>(null)

  const effectiveView = view ?? (isDesktop ? 'kanban' : 'list')

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 sm:px-6 pt-4 sm:pt-6 shrink-0">
        <PageHeader
          eyebrow="Workspace"
          title="Pipeline"
          description="Drag deals between stages · click to expand"
          actions={
            <div className="flex items-center gap-1 rounded-[6px] border border-hairline bg-surface-1 p-0.5">
              <Button
                variant="ghost"
                size="sm"
                className={cn(
                  'h-7 px-2.5',
                  effectiveView === 'kanban' && 'bg-surface-4 text-ink',
                )}
                onClick={() => setView('kanban')}
                title="Kanban view"
              >
                <LayoutGrid className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className={cn(
                  'h-7 px-2.5',
                  effectiveView === 'list' && 'bg-surface-4 text-ink',
                )}
                onClick={() => setView('list')}
                title="List view"
              >
                <List className="w-4 h-4" />
              </Button>
            </div>
          }
        />
      </div>

      <div className="pt-4 shrink-0">
        <PipelineHeroBar />
      </div>

      <div className="flex-1 overflow-auto pt-3">
        {effectiveView === 'kanban' ? <KanbanBoard /> : <DealListView />}
      </div>
    </div>
  )
}
