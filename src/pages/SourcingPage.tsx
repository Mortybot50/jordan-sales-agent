import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { formatDistanceToNow } from 'date-fns'
import { Pencil, Plus, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DataTable,
  EmptyState,
  ErrorAlert,
  PageHeader,
  StatusPill,
  type ColumnDef,
} from '@/components/primitives'
import { useAuth } from '@/hooks/useAuth'
import {
  useLeadSearches,
  useDeleteLeadSearch,
  type LeadSearch,
} from '@/lib/queries/sourcing'
import { SourcingForm } from '@/components/sourcing/SourcingForm'
import { RunHistoryDrawer } from '@/components/sourcing/RunHistoryDrawer'
import { RunNowButton } from '@/components/sourcing/RunNowButton'
import { SCHEDULE_PRESETS } from '@/lib/schemas/sourcing'
import { isValidCron, nextRunAt, parseCron } from '@/lib/cron/match'

function formatCost(cents: number | null): string {
  if (cents == null) return '—'
  const n = Number(cents)
  if (!Number.isFinite(n)) return '—'
  return `$${n.toFixed(3)}`
}

function scheduleLabel(cron: string | null): string {
  if (!cron) return 'Off'
  const preset = SCHEDULE_PRESETS.find((p) => p.cron === cron)
  if (preset) return preset.label
  return 'Custom'
}

function scheduleNextRun(cron: string | null): Date | null {
  if (!cron || !isValidCron(cron)) return null
  try {
    return nextRunAt(parseCron(cron), new Date())
  } catch {
    return null
  }
}

function suburbLabel(s: string | null): string {
  if (!s) return 'Any'
  const parts = s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
  if (parts.length === 0) return 'Any'
  if (parts.length === 1) return parts[0]
  return `${parts[0]} +${parts.length - 1}`
}

export function SourcingPage() {
  const { user } = useAuth()
  const { data, isLoading, error, refetch } = useLeadSearches()
  const deleteMut = useDeleteLeadSearch()

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<LeadSearch | null>(null)
  const [historyFor, setHistoryFor] = useState<LeadSearch | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<LeadSearch | null>(null)

  const rows = useMemo<LeadSearch[]>(() => data ?? [], [data])

  function openCreate() {
    setEditing(null)
    setFormOpen(true)
  }

  function openEdit(s: LeadSearch) {
    setEditing(s)
    setFormOpen(true)
  }

  async function handleDelete() {
    if (!confirmDelete) return
    try {
      await deleteMut.mutateAsync(confirmDelete.id)
      setConfirmDelete(null)
    } catch {
      /* toast via mutation */
    }
  }

  const columns: ColumnDef<LeadSearch>[] = [
    {
      id: 'name',
      header: 'Name',
      width: 'minmax(180px, 1.4fr)',
      cell: (s) => (
        <button
          onClick={() => setHistoryFor(s)}
          className="font-medium text-ink hover:text-[color:var(--jordan-accent)] text-left"
        >
          {s.name}
        </button>
      ),
    },
    {
      id: 'engine',
      header: 'Engine',
      width: '120px',
      cell: (s) => (
        <StatusPill
          tone={s.source_engine === 'outscraper' ? 'accent' : 'neutral'}
          uppercase
        >
          {s.source_engine === 'outscraper' ? 'Outscraper' : 'Google'}
        </StatusPill>
      ),
    },
    {
      id: 'suburbs',
      header: 'Suburbs',
      width: 'minmax(120px, 1fr)',
      cell: (s) => (
        <span className="text-ink-muted">{suburbLabel(s.suburb)}</span>
      ),
    },
    {
      id: 'categories',
      header: 'Categories',
      width: 'minmax(140px, 1.2fr)',
      cell: (s) => {
        const cats = s.categories ?? []
        if (cats.length === 0)
          return <span className="text-ink-faint">—</span>
        const first = cats[0].replace(/_/g, ' ')
        const more = cats.length - 1
        return (
          <span className="text-ink-muted">
            {first}
            {more > 0 && (
              <span className="text-ink-faint"> +{more}</span>
            )}
          </span>
        )
      },
    },
    {
      id: 'schedule',
      header: 'Schedule',
      width: '170px',
      cell: (s) => {
        if (!s.schedule_cron) {
          return <span className="text-ink-faint">Off</span>
        }
        const label = scheduleLabel(s.schedule_cron)
        const next = scheduleNextRun(s.schedule_cron)
        return (
          <div className="flex flex-col gap-0.5 leading-tight">
            <StatusPill tone="cold" uppercase>
              {label}
            </StatusPill>
            {next && (
              <span className="text-[11px] text-ink-faint jordan-tnum">
                next {formatDistanceToNow(next, { addSuffix: true })}
              </span>
            )}
          </div>
        )
      },
    },
    {
      id: 'last_run',
      header: 'Last run',
      width: '120px',
      cell: (s) =>
        s.last_run_at ? (
          <span className="text-ink-muted text-[12px] jordan-tnum">
            {formatDistanceToNow(new Date(s.last_run_at), {
              addSuffix: true,
            })}
          </span>
        ) : (
          <span className="text-ink-faint">Never</span>
        ),
    },
    {
      id: 'results',
      header: 'Results',
      width: '80px',
      align: 'right',
      numeric: true,
      cell: (s) => (
        <span className="font-mono jordan-tnum">
          {s.last_run_result_count ?? '—'}
        </span>
      ),
    },
    {
      id: 'cost',
      header: 'Cost',
      width: '80px',
      align: 'right',
      numeric: true,
      cell: (s) => (
        <span className="font-mono jordan-tnum text-ink-muted">
          {formatCost(s.last_run_cost_usd)}
        </span>
      ),
    },
    {
      id: 'total_runs',
      header: 'Runs',
      width: '60px',
      align: 'right',
      numeric: true,
      cell: (s) => (
        <span className="font-mono jordan-tnum text-ink-muted">
          {s.total_runs}
        </span>
      ),
    },
    {
      id: 'actions',
      header: '',
      width: '150px',
      cell: (s) => (
        <div className="flex items-center justify-end gap-1">
          <RunNowButton searchId={s.id} searchName={s.name} compact />
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            aria-label={`Edit ${s.name}`}
            onClick={(e) => {
              e.stopPropagation()
              openEdit(s)
            }}
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 text-[var(--jordan-danger-text)] hover:bg-[var(--jordan-danger-soft)]"
            aria-label={`Delete ${s.name}`}
            onClick={(e) => {
              e.stopPropagation()
              setConfirmDelete(s)
            }}
            disabled={deleteMut.isPending}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ),
    },
  ]

  return (
    <div className="p-4 sm:p-6 max-w-[1400px] space-y-5">
      <PageHeader
        eyebrow="Lead discovery"
        title="Sourcing"
        description="Saved searches feed venues + contacts into the funnel. New finds land in the Leads Inbox for your review — every result gets deduped against existing venues."
        actions={
          <>
            <Button asChild size="sm" variant="outline" className="h-8">
              <Link to="/leads/inbox">Leads Inbox</Link>
            </Button>
            <Button
              size="sm"
              className="h-8"
              onClick={openCreate}
              disabled={!user}
            >
              <Plus className="w-4 h-4 mr-1.5" />
              New search
            </Button>
          </>
        }
      />

      {error ? (
        <ErrorAlert
          error={error}
          onRetry={() => refetch()}
          title="Couldn't load searches"
        />
      ) : !isLoading && rows.length === 0 ? (
        <EmptyState
          title="No saved searches yet"
          body="Spin up your first search to pull venues from Outscraper or Google Places. Carlton restaurants, Fitzroy bars, the lot."
          action={
            <Button size="sm" onClick={openCreate} disabled={!user}>
              <Plus className="w-4 h-4 mr-1.5" />
              Create your first search
            </Button>
          }
        />
      ) : (
        <DataTable<LeadSearch>
          rows={rows}
          columns={columns}
          rowKey={(s) => s.id}
          loading={isLoading}
          ariaLabel="Saved sourcing searches"
        />
      )}

      {user && (
        <SourcingForm
          open={formOpen}
          onOpenChange={(o) => {
            setFormOpen(o)
            if (!o) setEditing(null)
          }}
          editing={editing}
          orgId={user.org_id}
          userId={user.id}
        />
      )}

      <RunHistoryDrawer
        search={historyFor}
        open={!!historyFor}
        onOpenChange={(o) => !o && setHistoryFor(null)}
      />

      <Dialog
        open={!!confirmDelete}
        onOpenChange={(o) => !o && setConfirmDelete(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this search?</DialogTitle>
            <DialogDescription>
              Run history will be deleted with the search. Venues + contacts
              already sourced stay where they are. This can't be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmDelete(null)}
              disabled={deleteMut.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={handleDelete}
              disabled={deleteMut.isPending}
              className="bg-[var(--jordan-danger)] text-white hover:bg-[var(--jordan-danger)]/90"
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
