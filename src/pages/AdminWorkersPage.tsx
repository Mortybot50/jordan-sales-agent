import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { formatDistanceToNowStrict } from 'date-fns'
import { toast } from 'sonner'
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
import { canAdmin } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { WORKER_EXPECTED_INTERVALS, getWorkerMeta } from '@/lib/workersConfig'
import { ArrowLeft, RefreshCw, Send } from 'lucide-react'

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

interface BriefingSendRow {
  id: string
  user_id: string
  sent_at: string
  sent_local_date: string
  item_count: number | null
  resend_message_id: string | null
  error: string | null
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
  const [sendingNow, setSendingNow] = useState(false)

  const isAdmin = canAdmin(user)

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
    enabled: !!user && isAdmin,
    refetchInterval: 30_000,
    staleTime: 10_000,
  })

  const {
    data: briefingSends,
    isLoading: briefingLoading,
    error: briefingError,
    refetch: refetchBriefing,
    isFetching: briefingFetching,
  } = useQuery({
    queryKey: ['briefing-sends', 30],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('briefing_sends')
        .select('id, user_id, sent_at, sent_local_date, item_count, resend_message_id, error')
        .order('sent_at', { ascending: false })
        .limit(30)
      if (error) throw error
      return (data ?? []) as BriefingSendRow[]
    },
    enabled: !!user && isAdmin,
    refetchInterval: 30_000,
    staleTime: 10_000,
  })

  async function handleSendNow() {
    if (!user) return
    setSendingNow(true)
    try {
      const { data, error } = await supabase.functions.invoke('send-morning-briefing', {
        body: { mode: 'manual', user_id: user.id, force: true },
      })
      if (error) throw error
      const result = data as {
        sent?: number
        skipped_already_sent_today?: number
        errors?: string[]
      }
      if (result?.sent && result.sent > 0) {
        toast.success('Briefing sent', {
          description: 'Check your inbox.',
        })
      } else if (result?.skipped_already_sent_today) {
        toast.message('Already sent today', {
          description: 'Idempotency guard fired — clear briefing_sends to re-send.',
        })
      } else if (result?.errors?.length) {
        toast.error(`Send failed: ${result.errors[0]}`)
      } else {
        toast.message('No briefing sent', { description: JSON.stringify(result) })
      }
      await refetchBriefing()
    } catch (e) {
      toast.error(`Manual trigger failed: ${(e as Error).message}`)
    } finally {
      setSendingNow(false)
    }
  }

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

  const briefingStats = useMemo(() => {
    const rows = briefingSends ?? []
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
    const recent7d = rows.filter((r) => new Date(r.sent_at).getTime() >= sevenDaysAgo)
    const successes = recent7d.filter((r) => !r.error && r.resend_message_id).length
    const errors = recent7d.filter((r) => r.error).length
    return {
      total7d: recent7d.length,
      successes,
      errors,
      lastSentAt: rows[0]?.sent_at ?? null,
    }
  }, [briefingSends])

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

  if (!isAdmin) {
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
            body="This page is restricted to org owners and admins."
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

      {/* Morning briefing send history — FE-P1-02 */}
      <Card className="bg-background border border-hairline">
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CapsLabel>Morning briefing — sends</CapsLabel>
              <div className="text-sm text-ink-muted mt-0.5">
                Idempotent dedup table — one row per (user, Melbourne date).
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-[11px] text-ink-faint">
                Last 7d: {briefingStats.total7d} sent · {briefingStats.errors} errors
              </span>
              <Button
                size="sm"
                variant="outline"
                className="h-8"
                onClick={() => refetchBriefing()}
                disabled={briefingFetching}
              >
                <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${briefingFetching ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
              <Button
                size="sm"
                className="h-8"
                onClick={handleSendNow}
                disabled={sendingNow}
              >
                <Send className={`w-3.5 h-3.5 mr-1.5 ${sendingNow ? 'animate-pulse' : ''}`} />
                {sendingNow ? 'Sending…' : 'Send now'}
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3 text-[11px] pt-2 border-t border-hairline">
            <div>
              <div className="text-ink-faint uppercase tracking-wide">Last sent</div>
              <div className="font-mono text-ink mt-0.5">
                {relativeTime(briefingStats.lastSentAt)}
              </div>
            </div>
            <div>
              <div className="text-ink-faint uppercase tracking-wide">Successes 7d</div>
              <div className="font-mono jordan-tnum text-ink mt-0.5">{briefingStats.successes}</div>
            </div>
            <div>
              <div className="text-ink-faint uppercase tracking-wide">Errors 7d</div>
              <div className="font-mono jordan-tnum text-ink mt-0.5">{briefingStats.errors}</div>
            </div>
          </div>

          <DataTable<BriefingSendRow>
            rows={briefingSends ?? []}
            columns={[
              {
                id: 'sent_at',
                header: 'Sent',
                width: '170px',
                cell: (r) => (
                  <span className="text-ink-muted">
                    {new Date(r.sent_at).toLocaleString('en-AU', {
                      timeZone: 'Australia/Melbourne',
                      day: '2-digit',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                ),
              },
              {
                id: 'sent_local_date',
                header: 'Local date',
                width: '110px',
                cell: (r) => (
                  <span className="font-mono text-xs text-ink-muted">{r.sent_local_date}</span>
                ),
              },
              {
                id: 'user_id',
                header: 'User',
                width: '110px',
                cell: (r) => (
                  <span className="font-mono text-[11px] text-ink-muted">
                    {r.user_id.slice(0, 8)}…
                  </span>
                ),
              },
              {
                id: 'item_count',
                header: 'Items',
                width: '70px',
                align: 'right',
                numeric: true,
                cell: (r) => (
                  <span className="font-mono jordan-tnum">{r.item_count ?? 0}</span>
                ),
              },
              {
                id: 'resend_message_id',
                header: 'Resend ID',
                width: '160px',
                cell: (r) => (
                  <span className="font-mono text-[10px] text-ink-faint">
                    {r.resend_message_id ? `${r.resend_message_id.slice(0, 18)}…` : '—'}
                  </span>
                ),
              },
              {
                id: 'error',
                header: 'Error',
                cell: (r) =>
                  r.error ? (
                    <span className="text-xs text-[var(--jordan-danger-text)] whitespace-pre-wrap break-words">
                      {r.error}
                    </span>
                  ) : (
                    <span className="text-ink-faint">—</span>
                  ),
              },
            ]}
            rowKey={(r) => r.id}
            loading={briefingLoading}
            error={briefingError instanceof Error ? briefingError.message : null}
            onRetry={() => refetchBriefing()}
            empty={{
              title: 'No briefing sends yet',
              body: 'Rows appear after the first morning briefing fires.',
            }}
            ariaLabel="Morning briefing sends"
          />
        </CardContent>
      </Card>

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
