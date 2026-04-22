import {
  DataTable,
  type ColumnDef,
  ErrorAlert,
  ScoreBadge,
} from '@/components/primitives'
import { Flame } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatRelative } from '@/lib/utils'
import { useWarmLeads, type WarmLead } from '@/lib/queries/dashboard'
import { useCreateTask } from '@/lib/queries/tasks'
import { useAuth } from '@/hooks/useAuth'
import { endOfDay } from 'date-fns'

export function WarmLeads() {
  const { data: leads, isLoading, error, refetch } = useWarmLeads()
  const createTask = useCreateTask()
  const { user } = useAuth()

  function handleFollowUp(lead: WarmLead) {
    if (!user) return
    createTask.mutate({
      org_id: user.org_id,
      title: `Follow up with ${lead.full_name}`,
      contact_id: lead.id,
      due_at: endOfDay(new Date()).toISOString(),
      task_type: 'follow_up',
    })
  }

  const columns: ColumnDef<WarmLead>[] = [
    {
      id: 'name',
      header: 'Name',
      width: 'minmax(140px, 1.4fr)',
      cell: (row) => (
        <span className="truncate">
          <span className="font-medium text-ink">{row.full_name}</span>
          {row.venue_name && (
            <span className="ml-2 text-ink-faint">· {row.venue_name}</span>
          )}
        </span>
      ),
    },
    {
      id: 'score',
      header: 'Score',
      align: 'right',
      width: '72px',
      cell: (row) => <ScoreBadge score={row.score} />,
    },
    {
      id: 'last',
      header: 'Last touch',
      align: 'right',
      width: 'minmax(90px, 1fr)',
      cell: (row) => (
        <span className="jordan-tnum truncate text-[12px] text-ink-muted">
          {row.last_touch_at ? formatRelative(row.last_touch_at) : 'Never'}
        </span>
      ),
    },
    {
      id: 'action',
      header: '',
      align: 'right',
      width: '96px',
      cell: (row) => (
        <Button
          size="sm"
          variant="outline"
          className="h-7 px-2 text-[12px]"
          onClick={(e) => {
            e.stopPropagation()
            handleFollowUp(row)
          }}
          disabled={createTask.isPending}
        >
          Follow up
        </Button>
      ),
    },
  ]

  return (
    <section className="rounded-[6px] border border-hairline bg-surface-1 overflow-hidden">
      <header className="px-4 py-3 border-b border-hairline">
        <h2 className="text-[13px] font-semibold text-ink">Warm Leads</h2>
        <p className="text-[11px] text-ink-faint mt-0.5">Score 50–79, not touched in 7+ days</p>
      </header>
      {error ? (
        <div className="p-3">
          <ErrorAlert
            compact
            title="Failed to load warm leads"
            error={error}
            onRetry={() => refetch()}
          />
        </div>
      ) : (
        <DataTable
          ariaLabel="Warm leads"
          columns={columns}
          rows={leads ?? []}
          rowKey={(row) => row.id}
          loading={isLoading}
          empty={{
            icon: Flame,
            title: 'No warm leads right now',
            body: 'Leads with a score of 50–79 that haven’t been touched in 7 days will appear here.',
          }}
        />
      )}
    </section>
  )
}
