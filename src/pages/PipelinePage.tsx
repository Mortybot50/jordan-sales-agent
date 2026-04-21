import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { KanbanBoard } from '@/components/pipeline/KanbanBoard'
import { DealListView } from '@/components/pipeline/DealListView'
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

type ViewMode = 'kanban' | 'list'

export function PipelinePage() {
  const isDesktop = useIsDesktop()
  const [view, setView] = useState<ViewMode | null>(null)

  // Default: kanban on desktop, list on mobile
  const effectiveView = view ?? (isDesktop ? 'kanban' : 'list')

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b shrink-0">
        <h1 className="text-xl font-semibold">Pipeline</h1>
        <div className="flex items-center gap-1 border rounded-lg p-0.5">
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              'h-7 px-2.5',
              effectiveView === 'kanban' && 'bg-muted'
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
              effectiveView === 'list' && 'bg-muted'
            )}
            onClick={() => setView('list')}
            title="List view"
          >
            <List className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {effectiveView === 'kanban' ? <KanbanBoard /> : <DealListView />}
      </div>
    </div>
  )
}
