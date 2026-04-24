import { useState } from 'react'
import { Radar, Plus, ExternalLink, Check, X } from 'lucide-react'
import { format, formatDistanceToNowStrict } from 'date-fns'
import { PageHeader, EmptyState, DataTable, type ColumnDef } from '@/components/primitives'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/hooks/useAuth'
import {
  useReopeningEvents,
  useManualSeed,
  useDismissReopening,
  usePromoteReopening,
  type ReopeningEvent,
} from '@/lib/queries/reopeningRadar'

function eventTypeLabel(t: ReopeningEvent['event_type']): string {
  switch (t) {
    case 'reopened': return 'Reopened'
    case 'licensee_changed': return 'Licensee changed'
    case 'renamed': return 'Renamed'
    case 'status_flip': return 'Status flip'
    case 'manual': return 'Manual tip'
  }
}

function sourceLabel(s: ReopeningEvent['new']['source']): string {
  switch (s) {
    case 'vcglr': return 'VCGLR'
    case 'google_places': return 'Google Places'
    case 'manual': return 'Manual'
  }
}

function ManualSeedForm() {
  const seed = useManualSeed()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({
    venue_name: '',
    address: '',
    suburb: '',
    licensee: '',
    prior_licensee: '',
    evidence_url: '',
  })

  if (!open) {
    return (
      <Button variant="outline" size="sm" className="h-8" onClick={() => setOpen(true)}>
        <Plus className="size-4 mr-1.5" />
        Add tip
      </Button>
    )
  }

  return (
    <div className="rounded-[var(--jordan-radius-md)] border border-hairline bg-surface-1 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-ink">Add a reopening tip</h3>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setOpen(false)}>
          <X className="size-4" />
        </Button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="rr-venue" className="text-[11px] uppercase tracking-[var(--jordan-tracking-label)] text-ink-faint">Venue name *</Label>
          <Input id="rr-venue" value={form.venue_name} onChange={(e) => setForm({ ...form, venue_name: e.target.value })} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="rr-suburb" className="text-[11px] uppercase tracking-[var(--jordan-tracking-label)] text-ink-faint">Suburb</Label>
          <Input id="rr-suburb" value={form.suburb} onChange={(e) => setForm({ ...form, suburb: e.target.value })} />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="rr-addr" className="text-[11px] uppercase tracking-[var(--jordan-tracking-label)] text-ink-faint">Address</Label>
          <Input id="rr-addr" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="rr-licensee" className="text-[11px] uppercase tracking-[var(--jordan-tracking-label)] text-ink-faint">New licensee</Label>
          <Input id="rr-licensee" value={form.licensee} onChange={(e) => setForm({ ...form, licensee: e.target.value })} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="rr-prior" className="text-[11px] uppercase tracking-[var(--jordan-tracking-label)] text-ink-faint">Prior licensee</Label>
          <Input id="rr-prior" value={form.prior_licensee} onChange={(e) => setForm({ ...form, prior_licensee: e.target.value })} />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="rr-evidence" className="text-[11px] uppercase tracking-[var(--jordan-tracking-label)] text-ink-faint">Evidence URL</Label>
          <Input id="rr-evidence" placeholder="https://…" value={form.evidence_url} onChange={(e) => setForm({ ...form, evidence_url: e.target.value })} />
        </div>
      </div>
      <div className="flex items-center gap-2 pt-1">
        <Button
          size="sm"
          className="h-8"
          disabled={!form.venue_name.trim() || seed.isPending}
          onClick={async () => {
            await seed.mutateAsync({
              venue_name: form.venue_name.trim(),
              address: form.address.trim() || undefined,
              suburb: form.suburb.trim() || undefined,
              licensee: form.licensee.trim() || undefined,
              prior_licensee: form.prior_licensee.trim() || undefined,
              evidence_url: form.evidence_url.trim() || undefined,
            })
            setForm({ venue_name: '', address: '', suburb: '', licensee: '', prior_licensee: '', evidence_url: '' })
            setOpen(false)
          }}
        >
          {seed.isPending ? 'Adding…' : 'Add reopening'}
        </Button>
        <Button variant="ghost" size="sm" className="h-8" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

export function ReopeningRadarPage() {
  const { user } = useAuth()
  const { data: events, isLoading, error, refetch } = useReopeningEvents()
  const promote = usePromoteReopening()
  const dismiss = useDismissReopening()

  const columns: ColumnDef<ReopeningEvent>[] = [
    {
      id: 'venue',
      header: 'Venue',
      cell: (row) => (
        <div className="min-w-0">
          <div className="truncate text-[13px] text-ink font-medium">{row.new.venue_name}</div>
          {row.new.address && (
            <div className="truncate text-[11px] text-ink-faint">{row.new.address}</div>
          )}
        </div>
      ),
    },
    {
      id: 'suburb',
      header: 'Suburb',
      width: '140px',
      cell: (row) => <span className="text-[13px] text-ink-muted">{row.new.suburb ?? '—'}</span>,
    },
    {
      id: 'source',
      header: 'Source',
      width: '110px',
      cell: (row) => (
        <span className="inline-flex items-center rounded-[3px] border border-hairline px-1.5 py-[1px] text-[11px] uppercase tracking-[var(--jordan-tracking-label)] text-ink-muted">
          {sourceLabel(row.new.source)}
        </span>
      ),
    },
    {
      id: 'detected',
      header: 'Detected',
      width: '110px',
      cell: (row) => (
        <span
          className="text-[12px] text-ink-faint jordan-tnum"
          title={format(new Date(row.detected_at), 'd MMM yyyy HH:mm')}
        >
          {formatDistanceToNowStrict(new Date(row.detected_at), { addSuffix: true })}
        </span>
      ),
    },
    {
      id: 'transition',
      header: 'Transition',
      cell: (row) => {
        const prior = row.prior
        if (!prior) {
          return (
            <span className="inline-flex items-center rounded-[3px] bg-[color:var(--jordan-accent-mint-soft)] text-[color:var(--jordan-success-text)] px-1.5 py-[1px] text-[11px]">
              {eventTypeLabel(row.event_type)}
            </span>
          )
        }
        if (row.event_type === 'licensee_changed') {
          return (
            <span className="text-[12px] text-ink-muted truncate">
              <span className="text-ink-faint">Licensee:</span>{' '}
              {prior.licensee ?? '—'} → {row.new.licensee ?? '—'}
            </span>
          )
        }
        if (row.event_type === 'renamed') {
          return (
            <span className="text-[12px] text-ink-muted truncate">
              <span className="text-ink-faint">Was:</span> {prior.venue_name ?? '—'}
            </span>
          )
        }
        return (
          <span className="text-[12px] text-ink-muted truncate">
            <span className="text-ink-faint">{prior.business_status ?? 'prior'}:</span> → {row.new.business_status}
          </span>
        )
      },
    },
    {
      id: 'actions',
      header: '',
      width: '200px',
      align: 'right',
      cell: (row) => (
        <div className="flex items-center justify-end gap-1">
          {row.new.evidence_url && (
            <a
              href={row.new.evidence_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-[12px] text-[color:var(--jordan-accent)] hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              <ExternalLink className="size-3" /> source
            </a>
          )}
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2 text-[12px]"
            disabled={promote.isPending}
            onClick={(e) => {
              e.stopPropagation()
              if (!user) return
              promote.mutate({ event: row, orgId: user.org_id })
            }}
          >
            <Check className="size-3 mr-1" /> Add to pipeline
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0"
            onClick={(e) => {
              e.stopPropagation()
              dismiss.mutate(row.id)
            }}
            title="Dismiss"
          >
            <X className="size-4" />
          </Button>
        </div>
      ),
    },
  ]

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-[1280px]">
      <PageHeader
        eyebrow="Workspace"
        title="Reopening Radar"
        description="Watches VIC venues going from closed → active. Fresh leads at the moment of reopening."
        actions={<ManualSeedForm />}
      />

      {(!events || events.length === 0) && !isLoading && !error ? (
        <EmptyState
          icon={Radar}
          title="No reopenings detected yet"
          body="When VCGLR or Google Places flag a venue going from closed to active, it lands here. You can also paste a tip using the button above."
        />
      ) : (
        <DataTable
          rows={events}
          columns={columns}
          loading={isLoading}
          error={error as Error | null}
          onRetry={() => refetch()}
          density="cozy"
          ariaLabel="Detected reopenings"
          empty={{ title: 'No reopenings detected yet' }}
        />
      )}
    </div>
  )
}
