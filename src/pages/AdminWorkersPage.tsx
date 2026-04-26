import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { formatDistanceToNowStrict } from 'date-fns'
import {
  PageHeader,
  StatusPill,
  type PillTone,
  DataTable,
  type ColumnDef,
  EmptyState,
  CapsLabel,
} from '@/components/primitives'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase'
import { WORKER_EXPECTED_INTERVALS, getWorkerMeta } from '@/lib/workersConfig'
import { ArrowLeft, RefreshCw } from 'lucide-react'

interface WorkerRunRow {
  id: string
  worker_name: string
  org_id: string | null
  started_at: string | null
  completed_at: string | null
  status: string | null
  items_processed: number | null
  error_message: string | null
  metadata: Record<string, unknown> | null
}

type Health = 'healthy' | 'stale' | 'failing' | 'idle' | 'never'

const STATUS_TONE: Record<string, PillTone> = {
  success: 'success',
  success_empty: 'neutral',
  running: 'accent',
  partial: 'warning',
  failed: 'danger',
}

const HEALTH_TONE: Record<Health, PillTone> = {
  healthy: 'success',
  stale: 'warning',
  failing: 'danger',
  idle: 'neutral',
  never: 'neutral',
}

const HEALTH_LABEL: Record<Health, string> = {
  healthy: 'Healthy',
  stale: 'Stale',
  failing: 'Failing',
  idle: 'Idle',
  never: 'Never fired',
}

interface WorkerSummary {
  name: string
  title: string
  description?: string
  cadence: string
  lastRun: WorkerRunRow | null
  lastSuccess: WorkerRunRow | null
  recent: WorkerRunRow[]
  health: Health
}

function computeHealth(
  name: string,
  lastRun: WorkerRunRow | null,
  lastSuccess: WorkerRunRow | null,
  recent: WorkerRunRow[],
): Health {
  if (!lastRun) return 'never'

  const last3 = recent.slice(0, 3)
  if (last3.length >= 3 && last3.every((r) => r.status === 'failed')) {
    return 'failing'
  }

  const meta = getWorkerMeta(name)
  if (!meta) {
    // Unknown worker — only flag failing; otherwise call it healthy.
    return lastRun.status === 'failed' ? 'failing' : 'healthy'
  }

  const sinceLastFireMs = lastRun.started_at
    ? Date.now() - new Date(lastRun.started_at).getTime()
    : Infinity
  if (sinceLastFireMs > meta.intervalMs * 2) return 'stale'

  const sinceLastSuccessMs = lastSuccess?.started_at
    ? Date.now() - new Date(lastSuccess.started_at).getTime()
    : Infinity
  if (sinceLastSuccessMs > meta.intervalMs * 2) return 'stale'

  return 'healthy'
}

function relativeTime(iso: string | null): string {
  if (!iso) return '—'
  try {
    return `${formatDistanceToNowStrict(new Date(iso))} ago`
  } catch {
    return '—'
  }
}

function durationMs(start: string | null, end: string | null): number | null {
  if (!start || !end) return null
  const ms = new Date(end).getTime() - new Date(start).getTime()
  return Number.isFinite(ms) && ms >= 0 ? ms : null
}

function formatDuration(ms: number | null): string {
  if (ms == null) return '—'
  if (ms < 1000) return `${ms}ms`
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(1)}s`
  const m = s / 60
  return `${m.toFixed(1)}m`
}

export function AdminWorkersPage() {
  const { user, loading: authLoading } = useAuth()
  const [filterWorker, setFilterWorker] = useState<string>('all')
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [expandedRow, setExpandedRow] = useState<string | null>(null)

  const isOwner = user?.role === 'owner'

  const { data, isLoading, error, refetch, isFetching, dataUpdatedAt } = useQuery({
    queryKey: ['worker-runs', 100],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('worker_runs')
        .select('id, worker_name, org_id, started_at, completed_at, status, items_processed, error_message, metadata')
        .order('started_at', { ascending: false })
        .limit(100)
      if (error) throw error
      return (data ?? []) as WorkerRunRow[]
    },
    enabled: !!user && isOwner,
    refetchInterval: 30_000,
    staleTime: 10_000,
  })

  const summaries = useMemo<WorkerSummary[]>(() => {
    const rows = data ?? []
    const knownWorkers = Object.keys(WORKER_EXPECTED_INTERVALS)
    const seen = new Set<string>()
    rows.forEach((r) => seen.add(r.worker_name))
    const allNames = Array.from(new Set([...knownWorkers, ...seen]))

    return allNames.map((name) => {
      const meta = getWorkerMeta(name)
      const recent = rows.filter((r) => r.worker_name === name)
      const lastRun = recent[0] ?? null
      const lastSuccess = recent.find((r) => r.status === 'success' || r.status === 'success_empty') ?? null
      return {
        name,
        title: meta?.title ?? name,
        description: meta?.description,
        cadence: meta?.label ?? 'Unknown cadence',
        lastRun,
        lastSuccess,
        recent,
        health: computeHealth(name, lastRun, lastSuccess, recent),
      }
    })
  }, [data])

  const filteredRuns = useMemo<WorkerRunRow[]>(() => {
    const rows = data ?? []
    const q = search.trim().toLowerCase()
    return rows.filter((r) => {
      if (filterWorker !== 'all' && r.worker_name !== filterWorker) return false
      if (filterStatus !== 'all' && r.status !== filterStatus) return false
      if (q) {
        const hay = `${r.worker_name} ${r.error_message ?? ''} ${r.status ?? ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [data, filterWorker, filterStatus, search])

  // ── Auth/permission gates ─────────────────────────────────────────
  if (authLoading) {
    return (
      <div className="p-6 text-sm text-muted-foreground">Loading…</div>
    )
  }

  if (!isOwner) {
    return (
      <div className="p-6">
        <PageHeader
          eyebrow="Admin"
          title="Worker runs"
          description="Background worker observability — admin only."
        />
        <div className="mt-8">
          <EmptyState
            title="403 — admin access required"
            body="This page is restricted to org owners."
          />
        </div>
      </div>
    )
  }

  // ── Table columns ─────────────────────────────────────────────────
  const columns: ColumnDef<WorkerRunRow>[] = [
    {
      id: 'worker_name',
      header: 'Worker',
      width: '180px',
      cell: (r) => <span className="font-medium text-ink">{r.worker_name}</span>,
    },
    {
      id: 'started_at',
      header: 'Started',
      width: '180px',
      cell: (r) => (
        <span className="text-ink-muted">
          {r.started_at ? new Date(r.started_at).toLocaleString('en-AU', {
            timeZone: 'Australia/Melbourne',
            day: '2-digit',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
          }) : '—'}
        </span>
      ),
    },
    {
      id: 'duration',
      header: 'Duration',
      width: '90px',
      align: 'right',
      numeric: true,
      cell: (r) => (
        <span className="font-mono text-ink-muted text-xs">
          {formatDuration(durationMs(r.started_at, r.completed_at))}
        </span>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      width: '110px',
      cell: (r) => {
        const tone = STATUS_TONE[r.status ?? ''] ?? 'neutral'
        return (
          <StatusPill tone={tone} uppercase>
            {r.status ?? '—'}
          </StatusPill>
        )
      },
    },
    {
      id: 'items',
      header: 'Items',
      width: '70px',
      align: 'right',
      numeric: true,
      cell: (r) => (
        <span className="font-mono jordan-tnum">{r.items_processed ?? 0}</span>
      ),
    },
    {
      id: 'error',
      header: 'Error',
      cell: (r) => {
        if (!r.error_message) return <span className="text-ink-faint">—</span>
        const isExpanded = expandedRow === r.id
        const truncated = r.error_message.length > 80 && !isExpanded
        const text = truncated ? r.error_message.slice(0, 80) + '…' : r.error_message
        return (
          <button
            type="button"
            className="text-left text-xs text-[var(--jordan-danger-text)] hover:underline whitespace-pre-wrap break-words"
            onClick={(e) => {
              e.stopPropagation()
              setExpandedRow(isExpanded ? null : r.id)
            }}
          >
            {text}
          </button>
        )
      },
    },
  ]

  const lastFetched = dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString('en-AU', {
    timeZone: 'Australia/Melbourne', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }) : '—'

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <PageHeader
        eyebrow={
          <Link to="/settings?tab=integrations" className="inline-flex items-center gap-1 hover:text-ink-muted">
            <ArrowLeft className="w-3 h-3" /> Settings
          </Link>
        }
        title="Worker runs"
        description="Background worker observability — last 100 runs across all workers."
        actions={
          <div className="flex items-center gap-3">
            <span className="text-[11px] text-ink-faint">Auto-refresh 30s · last {lastFetched}</span>
            <Button
              size="sm"
              variant="outline"
              className="h-8"
              onClick={() => refetch()}
              disabled={isFetching}
            >
              <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${isFetching ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        }
      />

      {/* Worker summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {summaries.map((w) => {
          const tone = HEALTH_TONE[w.health]
          const lastStatusTone = STATUS_TONE[w.lastRun?.status ?? ''] ?? 'neutral'
          return (
            <Card
              key={w.name}
              className="bg-[var(--jordan-ink-dark)] text-white border-0"
            >
              <CardContent className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <CapsLabel className="text-white/55">{w.cadence}</CapsLabel>
                    <div className="font-semibold text-[15px] mt-0.5 truncate">{w.title}</div>
                    {w.description && (
                      <div className="text-[12px] text-white/55 mt-0.5 line-clamp-2">{w.description}</div>
                    )}
                  </div>
                  <StatusPill tone={tone} uppercase>{HEALTH_LABEL[w.health]}</StatusPill>
                </div>
                <div className="grid grid-cols-3 gap-2 text-[11px] pt-2 border-t border-white/10">
                  <div>
                    <div className="text-white/55 uppercase tracking-wide">Last fired</div>
                    <div className="font-mono text-white mt-0.5">{relativeTime(w.lastRun?.started_at ?? null)}</div>
                  </div>
                  <div>
                    <div className="text-white/55 uppercase tracking-wide">Last status</div>
                    <div className="mt-0.5">
                      {w.lastRun ? (
                        <StatusPill tone={lastStatusTone} uppercase>{w.lastRun.status ?? '—'}</StatusPill>
                      ) : (
                        <span className="text-white/55">—</span>
                      )}
                    </div>
                  </div>
                  <div>
                    <div className="text-white/55 uppercase tracking-wide">Items</div>
                    <div className="font-mono jordan-tnum text-white mt-0.5">
                      {w.lastRun?.items_processed ?? 0}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="Search worker / error…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-8 max-w-xs"
        />
        <select
          value={filterWorker}
          onChange={(e) => setFilterWorker(e.target.value)}
          className="h-8 px-2 text-sm border border-hairline rounded-[var(--jordan-radius-sm)] bg-background"
        >
          <option value="all">All workers</option>
          {summaries.map((w) => (
            <option key={w.name} value={w.name}>{w.title}</option>
          ))}
        </select>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="h-8 px-2 text-sm border border-hairline rounded-[var(--jordan-radius-sm)] bg-background"
        >
          <option value="all">All statuses</option>
          <option value="success">success</option>
          <option value="success_empty">success_empty</option>
          <option value="running">running</option>
          <option value="partial">partial</option>
          <option value="failed">failed</option>
        </select>
        <span className="text-[11px] text-ink-faint ml-auto">
          {filteredRuns.length} of {data?.length ?? 0} runs
        </span>
      </div>

      <DataTable<WorkerRunRow>
        rows={filteredRuns}
        columns={columns}
        rowKey={(r) => r.id}
        loading={isLoading}
        error={error instanceof Error ? error.message : null}
        onRetry={() => refetch()}
        empty={{
          title: 'No worker runs yet',
          body: 'Runs appear here as soon as a background worker fires.',
        }}
        ariaLabel="Worker runs"
      />
    </div>
  )
}
