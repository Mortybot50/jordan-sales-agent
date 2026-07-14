import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { format, addDays, formatDistanceToNowStrict } from 'date-fns'
import { Loader2, Inbox as InboxIcon, Check, X, Clock, ExternalLink } from 'lucide-react'
import {
  PageHeader,
  DataTable,
  StatusPill,
  ScoreBadge,
  type ColumnDef,
} from '@/components/primitives'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import { useAuth } from '@/hooks/useAuth'
import {
  useLeadsInbox,
  useApproveLead,
  useDiscardLead,
  useDeferLead,
  type InboxLead,
  type ApproveStep,
} from '@/lib/queries/leadsInbox'

/**
 * /leads/inbox — the scraper's face. Every venue the sourcing stack found
 * lands here as review_status='pending'; Jordan approves (full chain:
 * crawl → verify → deal → enroll → step-1 draft), discards (rejected +
 * contacts suppressed under 'lead_rejected') or defers.
 */

const SOURCE_LABEL: Record<string, string> = {
  outscraper: 'Places',
  google_places: 'Places',
  vcglr: 'VCGLR',
  broadsheet: 'Broadsheet',
  hospitality_mag: 'Hospitality Mag',
  good_food: 'Good Food',
  general_news: 'News',
  website_crawl: 'Crawler',
}

function ContactStatusPill({ lead }: { lead: InboxLead }) {
  // Truth source is contact_status (derived from an actual emailed contact),
  // NOT the raw contact_enrichment_status field — that field can drift stale
  // (e.g. CSV-imported venues arrive with emails but a never-updated crawler
  // status). is_lead === (contact_status === 'found'), so if we have an email
  // this ALWAYS wins first and reads as a lead.
  if (lead.contact_status === 'found') {
    return (
      <StatusPill tone="success">
        {lead.contact_count} contact{lead.contact_count === 1 ? '' : 's'}
      </StatusPill>
    )
  }
  // No emailed contact = prospect. Word it by the fact that matters to Jordan
  // (no email yet), not by whether a crawl happened — that was the confusing
  // "Crawled — none found" label that contradicted venues which had emails.
  if (lead.contact_status === 'crawled_empty') {
    return <StatusPill tone="warning">No email yet</StatusPill>
  }
  return <StatusPill tone="neutral">Not crawled yet</StatusPill>
}

// verification_status enum: pending | valid | invalid | catch_all | disposable | unknown
function verificationTone(status: string | null): 'success' | 'danger' | 'warning' | 'neutral' {
  switch (status) {
    case 'valid':
      return 'success'
    case 'invalid':
      return 'danger'
    case 'catch_all':
    case 'disposable':
      return 'warning'
    default:
      return 'neutral'
  }
}

/** Verification pill + email tier + deliverability flags beside an email. */
function VerificationPill({ lead }: { lead: InboxLead }) {
  const c = lead.best_contact
  if (!c?.email) return null
  return (
    <span className="inline-flex items-center gap-1">
      <StatusPill tone={verificationTone(c.verification_status)}>
        {c.verification_status ?? 'pending'}
      </StatusPill>
      {/* Honest deliverability flags — a valid-but-role/catch-all address is
          NOT outreach-ready, so surface why it won't auto-send. */}
      {c.role_based === true && (
        <StatusPill tone="warning" title="Shared/role inbox (info@, bookings@ …) — not auto-sendable">
          role
        </StatusPill>
      )}
      {c.catch_all_flag === true && (
        <StatusPill tone="warning" title="Catch-all domain — deliverability unconfirmed">
          catch-all
        </StatusPill>
      )}
      {c.email_tier != null && (
        <span className="text-[10px] text-ink-faint jordan-tnum" title="Email tier (1 = decision-maker pattern)">
          T{c.email_tier}
        </span>
      )}
    </span>
  )
}

/** Best-email cell — the address is the primary content; pill + tier inline. */
function BestEmailCell({ lead }: { lead: InboxLead }) {
  const c = lead.best_contact
  // Explicit empty state — a bare "—" read as ambiguous next to the neighbouring
  // suburb/contacts cells. Say plainly there's no email on file.
  if (!c?.email) return <span className="text-[12px] text-ink-disabled">No email</span>
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <span className="truncate text-[12px] text-ink" title={c.email}>
        {c.email}
      </span>
      <span className="shrink-0">
        <VerificationPill lead={lead} />
      </span>
    </div>
  )
}

export function LeadsInboxPage() {
  const { user } = useAuth()
  const { data: leads, isLoading, error, refetch } = useLeadsInbox()
  const approve = useApproveLead()
  const discard = useDiscardLead()
  const defer = useDeferLead()

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [peek, setPeek] = useState<InboxLead | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [bulkRunning, setBulkRunning] = useState(false)
  const [approveSteps, setApproveSteps] = useState<ApproveStep[] | null>(null)
  const [segment, setSegment] = useState<'all' | 'leads' | 'prospects'>('all')

  const allRows = leads ?? []
  const leadCount = allRows.filter((l) => l.is_lead).length
  const prospectCount = allRows.length - leadCount
  const rows =
    segment === 'leads'
      ? allRows.filter((l) => l.is_lead)
      : segment === 'prospects'
        ? allRows.filter((l) => !l.is_lead)
        : allRows
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id))

  function toggle(id: string) {
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }

  async function runApprove(id: string) {
    setBusyId(id)
    setApproveSteps(null)
    try {
      const res = await approve.mutateAsync(id)
      setApproveSteps(res.steps)
    } finally {
      setBusyId(null)
    }
  }

  async function runBulk(action: 'approve' | 'discard' | 'defer') {
    if (!user) return
    setBulkRunning(true)
    try {
      for (const id of selected) {
        if (action === 'approve') {
          await approve.mutateAsync(id).catch(() => {})
        } else if (action === 'discard') {
          await discard.mutateAsync({ venueId: id, orgId: user.org_id, userId: user.id }).catch(() => {})
        } else {
          await defer.mutateAsync({ venueId: id, userId: user.id, until: addDays(new Date(), 14) }).catch(() => {})
        }
      }
      setSelected(new Set())
    } finally {
      setBulkRunning(false)
    }
  }

  const columns = useMemo<ColumnDef<InboxLead>[]>(() => [
    {
      id: 'select',
      header: (
        <input
          type="checkbox"
          aria-label="Select all"
          checked={allSelected}
          onChange={() =>
            setSelected((s) => {
              const n = new Set(s)
              if (allSelected) rows.forEach((r) => n.delete(r.id))
              else rows.forEach((r) => n.add(r.id))
              return n
            })
          }
          className="h-3.5 w-3.5 cursor-pointer accent-[var(--jordan-accent)]"
        />
      ),
      ariaLabel: 'Select',
      width: '36px',
      cell: (row) => (
        <span onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            aria-label={`Select ${row.name}`}
            checked={selected.has(row.id)}
            onChange={() => toggle(row.id)}
            className="h-3.5 w-3.5 cursor-pointer accent-[var(--jordan-accent)]"
          />
        </span>
      ),
    },
    {
      id: 'name',
      header: 'Venue',
      cell: (row) => (
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 truncate font-medium text-ink">
            <span
              aria-hidden
              title={row.is_lead ? 'Lead — email discovered' : 'Prospect — no email yet'}
              className={cn(
                'inline-block h-1.5 w-1.5 shrink-0 rounded-full',
                row.is_lead ? 'bg-[color:var(--jordan-accent)]' : 'bg-ink-disabled',
              )}
            />
            <span className="truncate">{row.name}</span>
          </p>
          {row.review_notes?.includes('needs contact') && (
            <StatusPill tone="warning" className="mt-0.5">needs contact</StatusPill>
          )}
        </div>
      ),
    },
    {
      id: 'source',
      header: 'Source',
      width: '110px',
      cell: (row) => (
        <span className="text-[12px] text-ink-muted">
          {SOURCE_LABEL[row.source ?? ''] ?? row.source ?? '—'}
        </span>
      ),
    },
    {
      id: 'arrived',
      header: 'Arrived',
      width: '90px',
      cell: (row) => (
        <span className="text-[12px] text-ink-faint jordan-tnum" title={row.created_at ?? ''}>
          {row.created_at ? formatDistanceToNowStrict(new Date(row.created_at), { addSuffix: true }) : '—'}
        </span>
      ),
    },
    {
      id: 'suburb',
      header: 'Suburb',
      width: '110px',
      cell: (row) => <span className="text-[12px] text-ink-muted truncate">{row.suburb ?? '—'}</span>,
    },
    {
      id: 'icp',
      header: 'ICP',
      width: '64px',
      align: 'center',
      cell: (row) => (row.icp_score != null ? <ScoreBadge score={row.icp_score} /> : <span className="text-ink-disabled">—</span>),
    },
    {
      id: 'contacts',
      header: 'Contacts',
      width: '150px',
      cell: (row) => <ContactStatusPill lead={row} />,
    },
    {
      id: 'verification',
      header: 'Best email',
      width: '260px',
      cell: (row) => <BestEmailCell lead={row} />,
    },
    {
      id: 'actions',
      header: '',
      ariaLabel: 'Actions',
      width: '210px',
      cell: (row) => (
        <span className="inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <Button
            size="sm"
            className="h-7 px-2 text-[12px]"
            disabled={busyId === row.id || bulkRunning}
            onClick={() => runApprove(row.id)}
          >
            {busyId === row.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5 mr-1" />}
            Approve
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2 text-[12px]"
            disabled={busyId === row.id || bulkRunning || !user}
            onClick={() => user && discard.mutate({ venueId: row.id, orgId: user.org_id, userId: user.id })}
          >
            <X className="w-3.5 h-3.5" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-[12px]"
            title="Defer 14 days"
            disabled={busyId === row.id || bulkRunning || !user}
            onClick={() => user && defer.mutate({ venueId: row.id, userId: user.id, until: addDays(new Date(), 14) })}
          >
            <Clock className="w-3.5 h-3.5" />
          </Button>
        </span>
      ),
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [rows, selected, allSelected, busyId, bulkRunning, user])

  return (
    <div className="p-4 sm:p-6 max-w-[1400px] space-y-4">
      <PageHeader
        eyebrow="Intelligence"
        title="Leads inbox"
        description={`${allRows.length} venue${allRows.length === 1 ? '' : 's'} waiting for your call — sourced by Places, VCGLR, publications and the crawler. Approve = contacts crawled & verified, deal created, first email drafted for your review.`}
        actions={
          <Button asChild size="sm" variant="outline" className="h-8">
            <Link to="/sourcing">Sourcing searches</Link>
          </Button>
        }
      />

      {/* Lead vs prospect segment — a venue is a "lead" only once an email is found. */}
      <div
        role="group"
        aria-label="Filter by lead status"
        className="inline-flex rounded-[var(--jordan-radius-md)] border border-hairline bg-surface-2 p-0.5 text-[12px]"
      >
        {([
          ['all', 'All', allRows.length],
          ['leads', 'Leads', leadCount],
          ['prospects', 'Prospects', prospectCount],
        ] as const).map(([key, label, count]) => (
          <button
            key={key}
            type="button"
            aria-pressed={segment === key}
            onClick={() => setSegment(key)}
            className={cn(
              'rounded-[calc(var(--jordan-radius-md)-2px)] px-3 py-1 transition-colors',
              segment === key
                ? 'bg-surface-1 text-ink shadow-sm'
                : 'text-ink-muted hover:text-ink',
            )}
          >
            {label}{' '}
            <span className="jordan-tnum text-ink-faint">{count}</span>
          </button>
        ))}
      </div>

      {selected.size > 0 && (
        <div className="flex items-center gap-2 rounded-[var(--jordan-radius-md)] border border-hairline bg-surface-2 px-3 py-2">
          <span className="text-[12px] text-ink-muted">{selected.size} selected</span>
          <Button size="sm" className="h-7 text-[12px]" disabled={bulkRunning} onClick={() => runBulk('approve')}>
            {bulkRunning ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Check className="w-3.5 h-3.5 mr-1" />}
            Approve all
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-[12px]" disabled={bulkRunning} onClick={() => runBulk('discard')}>
            <X className="w-3.5 h-3.5 mr-1" /> Discard all
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-[12px]" disabled={bulkRunning} onClick={() => runBulk('defer')}>
            <Clock className="w-3.5 h-3.5 mr-1" /> Defer all 14d
          </Button>
          <button type="button" className="ml-auto text-[11px] text-ink-faint underline" onClick={() => setSelected(new Set())}>
            Clear
          </button>
        </div>
      )}

      {/* Per-step progress from the last approve */}
      {approveSteps && (
        <div className="rounded-[var(--jordan-radius-md)] border border-hairline bg-surface-1 px-3 py-2 space-y-1">
          {approveSteps.map((s) => (
            <p key={s.step} className="text-[12px] flex items-center gap-2">
              <span aria-hidden>
                {s.status === 'ok' ? '✅' : s.status === 'skipped' ? '⏭' : '❌'}
              </span>
              <span className="uppercase text-[10px] tracking-[var(--jordan-tracking-label)] text-ink-faint w-12">{s.step}</span>
              <span className="text-ink-muted">{s.detail}</span>
            </p>
          ))}
          <button type="button" className="text-[11px] text-ink-faint underline" onClick={() => setApproveSteps(null)}>
            Dismiss
          </button>
        </div>
      )}

      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        loading={isLoading}
        error={error as Error | null}
        onRetry={() => refetch()}
        onRowClick={(row) => setPeek(row)}
        aria-label="Leads inbox"
        empty={
          segment !== 'all' && allRows.length > 0
            ? {
                icon: InboxIcon,
                title: segment === 'leads' ? 'No leads in this view' : 'No prospects in this view',
                body:
                  segment === 'leads'
                    ? 'None of the waiting venues have a discovered email yet. Switch to All or Prospects.'
                    : 'Every waiting venue already has a discovered email. Switch to All or Leads.',
              }
            : {
                icon: InboxIcon,
                title: 'Inbox zero — no leads waiting',
                body: 'New venues from sourcing runs land here for review. Kick off a search from the Sourcing page.',
                action: (
                  <Button asChild size="sm">
                    <Link to="/sourcing">Open Sourcing</Link>
                  </Button>
                ),
              }
        }
      />

      {/* Detail peek */}
      <Sheet open={!!peek} onOpenChange={(o) => !o && setPeek(null)}>
        <SheetContent side="right" className="w-full sm:max-w-[440px] overflow-y-auto pb-6">
          {peek && (
            <>
              <SheetHeader className="mb-4">
                <SheetTitle className="text-lg">{peek.name}</SheetTitle>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <StatusPill tone="neutral">{SOURCE_LABEL[peek.source ?? ''] ?? peek.source}</StatusPill>
                  {peek.icp_score != null && <ScoreBadge score={peek.icp_score} withLabel />}
                  <ContactStatusPill lead={peek} />
                </div>
              </SheetHeader>

              <dl className="space-y-2 text-[13px]">
                {peek.address && (
                  <div>
                    <dt className="text-[10px] uppercase tracking-[var(--jordan-tracking-label)] text-ink-faint">Address</dt>
                    <dd className="text-ink">{peek.address}{peek.suburb ? `, ${peek.suburb}` : ''}</dd>
                  </div>
                )}
                {peek.website && (
                  <div>
                    <dt className="text-[10px] uppercase tracking-[var(--jordan-tracking-label)] text-ink-faint">Website</dt>
                    <dd>
                      <a href={peek.website.startsWith('http') ? peek.website : `https://${peek.website}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[color:var(--jordan-accent)] hover:underline">
                        {peek.website} <ExternalLink className="w-3 h-3" />
                      </a>
                    </dd>
                  </div>
                )}
                {peek.licence_type && (
                  <div>
                    <dt className="text-[10px] uppercase tracking-[var(--jordan-tracking-label)] text-ink-faint">Licence</dt>
                    <dd className="text-ink">{peek.licence_type}</dd>
                  </div>
                )}
                {peek.best_contact?.email && (
                  <div>
                    <dt className="text-[10px] uppercase tracking-[var(--jordan-tracking-label)] text-ink-faint">Best contact</dt>
                    <dd className="text-ink">
                      {peek.best_contact.full_name ?? peek.best_contact.email}
                      <span className="ml-1.5"><VerificationPill lead={peek} /></span>
                    </dd>
                  </div>
                )}
                {peek.source_details && Object.keys(peek.source_details).length > 0 && (
                  <div>
                    <dt className="text-[10px] uppercase tracking-[var(--jordan-tracking-label)] text-ink-faint">Raw source data</dt>
                    <dd>
                      <pre className="mt-1 max-h-72 overflow-auto rounded-[6px] border border-hairline bg-surface-2 p-2 text-[10px] leading-relaxed whitespace-pre-wrap break-all">
                        {JSON.stringify(peek.source_details, null, 2)}
                      </pre>
                    </dd>
                  </div>
                )}
                <div className="text-[11px] text-ink-faint">
                  Arrived {peek.created_at ? format(new Date(peek.created_at), 'd MMM yyyy, h:mma') : '—'}
                </div>
              </dl>

              <div className="mt-5 flex gap-2">
                <Button className="flex-1" disabled={busyId === peek.id} onClick={() => { runApprove(peek.id); setPeek(null) }}>
                  <Check className="w-4 h-4 mr-1.5" /> Approve
                </Button>
                <Button variant="outline" className="flex-1" disabled={!user} onClick={() => { if (user) discard.mutate({ venueId: peek.id, orgId: user.org_id, userId: user.id }); setPeek(null) }}>
                  <X className="w-4 h-4 mr-1.5" /> Discard
                </Button>
                <Button variant="ghost" disabled={!user} onClick={() => { if (user) defer.mutate({ venueId: peek.id, userId: user.id, until: addDays(new Date(), 14) }); setPeek(null) }}>
                  <Clock className="w-4 h-4" />
                </Button>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  )
}
