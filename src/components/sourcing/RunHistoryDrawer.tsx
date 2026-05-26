import { formatDistanceToNow } from 'date-fns'
import { Loader2 } from 'lucide-react'

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { StatusPill, EmptyState } from '@/components/primitives'
import {
  useLeadSearchRuns,
  type LeadSearchRun,
  type LeadSearch,
} from '@/lib/queries/sourcing'

interface RunHistoryDrawerProps {
  search: LeadSearch | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

function statusPill(status: LeadSearchRun['status']) {
  switch (status) {
    case 'success':
      return (
        <StatusPill tone="success" uppercase>
          Success
        </StatusPill>
      )
    case 'running':
    case 'pending':
      return (
        <StatusPill tone="accent" uppercase>
          {status === 'pending' ? 'Pending' : 'Running'}
        </StatusPill>
      )
    case 'failed':
      return (
        <StatusPill tone="danger" uppercase>
          Failed
        </StatusPill>
      )
    case 'partial':
      return (
        <StatusPill tone="warning" uppercase>
          Partial
        </StatusPill>
      )
    default:
      return (
        <StatusPill tone="neutral" uppercase>
          {String(status)}
        </StatusPill>
      )
  }
}

function durationLabel(run: LeadSearchRun): string {
  if (!run.finished_at) return '—'
  const ms =
    new Date(run.finished_at).getTime() - new Date(run.started_at).getTime()
  if (ms < 1000) return '<1s'
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`
  return `${Math.round(ms / 60_000)}m`
}

export function RunHistoryDrawer({
  search,
  open,
  onOpenChange,
}: RunHistoryDrawerProps) {
  const { data: runs, isLoading } = useLeadSearchRuns(search?.id ?? null)

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto p-0">
        <SheetHeader className="px-5 pt-5 pb-3 border-b border-hairline">
          <SheetTitle>{search?.name ?? 'Run history'}</SheetTitle>
          <SheetDescription>
            Last 20 runs · Source:{' '}
            {search?.source_engine === 'google_places'
              ? 'Google Places'
              : 'Outscraper'}
          </SheetDescription>
        </SheetHeader>

        <div className="px-5 py-4">
          {isLoading ? (
            <div className="flex items-center gap-2 text-ink-faint text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading runs…
            </div>
          ) : !runs || runs.length === 0 ? (
            <EmptyState
              title="No runs yet"
              body="Hit Run now on the search row to kick off the first run."
            />
          ) : (
            <ul className="space-y-2.5">
              {runs.map((r) => (
                <li
                  key={r.id}
                  className="rounded-md border border-hairline p-3 space-y-1.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[12px] text-ink-muted jordan-tnum">
                      {formatDistanceToNow(new Date(r.started_at), {
                        addSuffix: true,
                      })}
                    </span>
                    {statusPill(r.status)}
                  </div>
                  <div className="grid grid-cols-2 gap-y-1 text-[12px]">
                    <span className="text-ink-faint">Results found</span>
                    <span className="text-right jordan-tnum font-mono">
                      {r.result_count ?? '—'}
                    </span>
                    <span className="text-ink-faint">New venues</span>
                    <span className="text-right jordan-tnum font-mono">
                      {r.new_venue_count ?? '—'}
                    </span>
                    <span className="text-ink-faint">Cost (USD)</span>
                    <span className="text-right jordan-tnum font-mono">
                      {r.cost_usd != null
                        ? `$${Number(r.cost_usd).toFixed(3)}`
                        : '—'}
                    </span>
                    <span className="text-ink-faint">Duration</span>
                    <span className="text-right jordan-tnum font-mono">
                      {durationLabel(r)}
                    </span>
                  </div>
                  {r.error_message && (
                    <p className="mt-1 text-[12px] text-[color:var(--jordan-danger-text)] break-words">
                      {r.error_message}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
