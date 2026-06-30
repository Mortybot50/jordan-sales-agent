import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Mic, Upload, UserPlus, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ContactVoiceNoteDialog } from '@/components/voice/ContactVoiceNoteDialog'
import {
  DataTable,
  type ColumnDef,
  FacetBar,
  type FacetDef,
  PageHeader,
  ScoreBadge,
  StatusPill,
} from '@/components/primitives'
import {
  useContacts,
  useContactsPaginated,
  useDistinctContactTags,
  type Contact,
} from '@/lib/queries/contacts'
import { useVenueGroupBadges } from '@/lib/queries/venue-groups'
import { GroupChip } from '@/components/venue-groups/GroupChip'
import { roleLabel, venueTypeLabel, cn } from '@/lib/utils'
import { ContactBulkActionsToolbar } from '@/components/contacts/ContactBulkActionsToolbar'

type SortField = 'name' | 'venue' | 'score' | 'suburb'
type SortDir = 'asc' | 'desc'

type SelectionState = Record<string, string[]>

const PAGE_SIZE = 50

export function ContactsPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  // Legacy unbounded fetch (capped at 2000 — see `useContacts` JSDoc). Used
  // ONLY for facet-option counts + bulk-action selected-row name lookup —
  // the rendered table reads from `useContactsPaginated` below to keep
  // bandwidth bounded at bulk-sourcing scale (FE-P1-04).
  const { data: contacts } = useContacts()

  const [search, setSearch] = useState('')
  // Server `.ilike` runs against this debounced value so each keystroke
  // doesn't issue a Supabase round-trip. 300ms matches the audit
  // recommendation in FE-P2-02 (subsumed under FE-P1-04).
  const [debouncedSearch, setDebouncedSearch] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(t)
  }, [search])

  const [sortField, setSortField] = useState<SortField>('name')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [selection, setSelection] = useState<SelectionState>({})
  const [page, setPage] = useState(0)
  const [voiceOpen, setVoiceOpen] = useState(false)

  // Server-paginated page rows (FE-P1-04). Only this query hits the
  // contacts table for the visible rows — facets + tag chips stay on the
  // legacy capped fetch so they keep working at small org size.
  const {
    data: contactsPage,
    isLoading,
    error,
    refetch,
  } = useContactsPaginated({ page, pageSize: PAGE_SIZE, search: debouncedSearch })

  // Bulk-action selection — page-local; clears when paginating, filtering,
  // or sorting (the underlying row set changes, selection IDs no longer line
  // up with what's on screen). Cross-page select-all intentionally absent.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [activeTag, setActiveTag] = useState<string | null>(null)
  const { data: distinctTags } = useDistinctContactTags()
  const { data: groupBadges } = useVenueGroupBadges()

  /*
    Deep-link from Dashboard "Warm Leads" → ?segment=warm.
    Maps to the existing tier facet (hot/warm/cold) and clears the
    search-param afterwards so the URL stays clean.
  */
  useEffect(() => {
    const segment = searchParams.get('segment')
    if (!segment) return
    if (segment === 'warm' || segment === 'hot' || segment === 'cold') {
      setSelection((s) => ({ ...s, tier: [segment] }))
      setPage(0)
    }
    setSearchParams(
      (prev) => {
        const p = new URLSearchParams(prev)
        p.delete('segment')
        return p
      },
      { replace: true },
    )
  }, [searchParams, setSearchParams])

  // Derive facet options from the current data.
  const { venueTypeOptions, suburbOptions } = useMemo(() => {
    const venueSet = new Map<string, number>()
    const suburbSet = new Map<string, number>()
    for (const c of contacts ?? []) {
      const vt = c.venue?.venue_type
      if (vt) venueSet.set(vt, (venueSet.get(vt) ?? 0) + 1)
      const sb = c.venue?.suburb
      if (sb) suburbSet.set(sb, (suburbSet.get(sb) ?? 0) + 1)
    }
    const venueTypeOptions = [...venueSet.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([value, count]) => ({ value, label: venueTypeLabel(value), count }))
    const suburbOptions = [...suburbSet.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([value, count]) => ({ value, label: value, count }))
    return { venueTypeOptions, suburbOptions }
  }, [contacts])

  const facets: FacetDef[] = [
    {
      id: 'tier',
      label: 'Tier',
      mode: 'single',
      options: [
        { value: 'hot', label: 'Hot' },
        { value: 'warm', label: 'Warm' },
        { value: 'cold', label: 'Cold' },
      ],
    },
    ...(venueTypeOptions.length > 0
      ? [{ id: 'venue_type', label: 'Venue', mode: 'multi' as const, options: venueTypeOptions }]
      : []),
    ...(suburbOptions.length > 0
      ? [{ id: 'suburb', label: 'Suburb', mode: 'multi' as const, options: suburbOptions }]
      : []),
  ]

  // The current page rows come pre-windowed + pre-searched server-side.
  // Tier/venue_type/suburb/tag filters narrow the visible page client-side
  // (page-local — known limitation accepted by audit FE-P1-04 under
  // "windowed page + lazy-load search"). Sort is also page-local since the
  // server already orders by full_name; non-name sorts re-order the page.
  const filtered = useMemo(() => {
    const pageRows = contactsPage?.rows ?? []
    let rows = pageRows

    const tier = selection.tier?.[0]
    if (tier) {
      rows = rows.filter((c) => c.lead_score?.tier === tier)
    }

    const venueTypes = selection.venue_type ?? []
    if (venueTypes.length > 0) {
      rows = rows.filter((c) => c.venue?.venue_type && venueTypes.includes(c.venue.venue_type))
    }

    const suburbs = selection.suburb ?? []
    if (suburbs.length > 0) {
      rows = rows.filter((c) => c.venue?.suburb && suburbs.includes(c.venue.suburb))
    }

    if (activeTag) {
      rows = rows.filter((c) => (c.tags ?? []).includes(activeTag))
    }

    rows = [...rows].sort((a, b) => {
      let cmp = 0
      switch (sortField) {
        case 'name':
          cmp = a.full_name.localeCompare(b.full_name)
          break
        case 'venue':
          cmp = (a.venue?.name ?? '').localeCompare(b.venue?.name ?? '')
          break
        case 'suburb':
          cmp = (a.venue?.suburb ?? '').localeCompare(b.venue?.suburb ?? '')
          break
        case 'score':
          cmp = (a.lead_score?.score ?? -1) - (b.lead_score?.score ?? -1)
          break
      }
      return sortDir === 'asc' ? cmp : -cmp
    })

    return rows
  }, [contactsPage, selection, sortField, sortDir, activeTag])

  // Total rows on the server matching the current search. Used for the
  // page indicator + pager bounds; client-side filters narrow what's
  // visible on screen but don't change `serverTotal`.
  const serverTotal = contactsPage?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(serverTotal / PAGE_SIZE))
  const paginated = filtered

  // Page-local selection — never carries across pages, filters, sorts.
  function clearSelection() {
    setSelectedIds(new Set())
  }

  const visibleIds = paginated.map((r) => r.id)
  const allOnPageSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id))
  const someOnPageSelected =
    !allOnPageSelected && visibleIds.some((id) => selectedIds.has(id))

  function togglePageAll() {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (allOnPageSelected) {
        for (const id of visibleIds) next.delete(id)
      } else {
        for (const id of visibleIds) next.add(id)
      }
      return next
    })
  }

  function toggleRow(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Selection is page-local (clears on paginate/filter/sort), so the
  // selected IDs are guaranteed to be in the current page rows. Resolve
  // names from `contactsPage.rows` rather than the legacy capped fetch
  // so this still works correctly once sourcing lands >2000 contacts.
  const selectedContacts = useMemo(
    () => (contactsPage?.rows ?? []).filter((c) => selectedIds.has(c.id)),
    [contactsPage, selectedIds],
  )

  function toggleSort(field: string) {
    const f = field as SortField
    if (sortField === f) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(f)
      setSortDir('asc')
    }
    setPage(0)
    clearSelection()
  }

  const columns: ColumnDef<Contact>[] = [
    {
      id: '__select',
      ariaLabel: 'Select rows',
      width: '36px',
      header: (
        <input
          type="checkbox"
          aria-label={allOnPageSelected ? 'Deselect all on this page' : 'Select all on this page'}
          checked={allOnPageSelected}
          ref={(el) => {
            if (el) el.indeterminate = someOnPageSelected
          }}
          onClick={(e) => e.stopPropagation()}
          onChange={togglePageAll}
          className="h-3.5 w-3.5 cursor-pointer accent-[var(--jordan-accent)]"
        />
      ),
      cell: (row) => (
        <input
          type="checkbox"
          aria-label={`Select ${row.full_name}`}
          checked={selectedIds.has(row.id)}
          onClick={(e) => e.stopPropagation()}
          onChange={() => toggleRow(row.id)}
          className="h-3.5 w-3.5 cursor-pointer accent-[var(--jordan-accent)]"
        />
      ),
    },
    {
      id: 'name',
      header: 'Name',
      sortable: true,
      width: 'minmax(180px, 1.6fr)',
      cell: (row) => (
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate font-medium text-ink">{row.full_name}</span>
          {row.do_not_contact && (
            <StatusPill tone="danger" uppercase className="shrink-0 h-[16px] px-1 text-[10px]">
              DNC
            </StatusPill>
          )}
        </span>
      ),
    },
    {
      id: 'role',
      header: 'Role',
      width: 'minmax(120px, 1fr)',
      cell: (row) =>
        row.role ? (
          <span className="truncate text-ink-muted">{roleLabel(row.role)}</span>
        ) : (
          <span className="text-ink-disabled">—</span>
        ),
    },
    {
      id: 'venue',
      header: 'Venue',
      sortable: true,
      width: 'minmax(160px, 1.8fr)',
      cell: (row) => {
        const badge = row.venue?.id ? groupBadges?.[row.venue.id] : undefined
        return (
          <div className="flex flex-col gap-0.5 min-w-0">
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate text-ink">{row.venue?.name ?? '—'}</span>
              {row.venue?.venue_type && (
                <StatusPill tone="neutral" className="shrink-0 h-[16px] px-1 text-[10px]">
                  {venueTypeLabel(row.venue.venue_type)}
                </StatusPill>
              )}
            </span>
            {badge && <GroupChip name={badge.group_name} compact />}
          </div>
        )
      },
    },
    {
      id: 'suburb',
      header: 'Suburb',
      sortable: true,
      width: 'minmax(100px, 1fr)',
      cell: (row) =>
        row.venue?.suburb ? (
          <span className="truncate text-ink-muted">{row.venue.suburb}</span>
        ) : (
          <span className="text-ink-disabled">—</span>
        ),
    },
    {
      id: 'email',
      header: 'Email',
      width: 'minmax(180px, 1.8fr)',
      cell: (row) =>
        row.email ? (
          <span className="truncate text-ink-muted">{row.email}</span>
        ) : (
          <span className="text-ink-disabled">—</span>
        ),
    },
    {
      id: 'score',
      header: 'Score',
      sortable: true,
      align: 'right',
      width: '92px',
      cell: (row) => <ScoreBadge score={row.lead_score?.score} />,
    },
  ]

  // Server-reported total matching the current search (no client filters
  // applied). The page header uses this so it reflects the underlying
  // table, not just the loaded page window.
  const totalCount = serverTotal
  const anyFilters =
    search.trim().length > 0 ||
    Object.values(selection).some((v) => v && v.length > 0) ||
    !!activeTag

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-[1200px]">
      <PageHeader
        eyebrow="Workspace"
        title="Contacts"
        description={
          isLoading
            ? 'Loading…'
            : totalCount === 0
              ? 'No contacts yet — import a CSV or add your first.'
              : `${totalCount} contact${totalCount === 1 ? '' : 's'} across ${
                  // Venue count is from the legacy capped fetch (≤2000) — at
                  // bulk-sourcing scale this becomes a soft cap on the displayed
                  // figure, not an actual constraint on the data.
                  new Set((contacts ?? []).map((c) => c.venue?.name).filter(Boolean)).size
                } venues`
        }
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              onClick={() => setVoiceOpen(true)}
            >
              <Mic className="w-4 h-4 mr-1.5" />
              Voice note
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              onClick={() => navigate('/contacts/import')}
            >
              <Upload className="w-4 h-4 mr-1.5" />
              Import CSV
            </Button>
            <Button size="sm" className="h-8" onClick={() => navigate('/contacts/new')}>
              <UserPlus className="w-4 h-4 mr-1.5" />
              Add contact
            </Button>
          </>
        }
      />

      <FacetBar
        search={search}
        onSearchChange={(v) => {
          setSearch(v)
          setPage(0)
          clearSelection()
        }}
        searchPlaceholder="Search name or email…"
        facets={facets}
        selection={selection}
        onSelectionChange={(facetId, values) => {
          setSelection((s) => ({ ...s, [facetId]: values }))
          setPage(0)
          clearSelection()
        }}
        onClear={() => {
          setSelection({})
          setSearch('')
          setPage(0)
          setActiveTag(null)
          clearSelection()
        }}
        summary={
          <span>
            {filtered.length} <span className="text-ink-disabled">of</span> {serverTotal}
          </span>
        }
      />

      {/* Tag filter strip — payoff for the bulk-tag action. Click a pill to
          isolate the cohort; click again (or any active pill) to clear. */}
      {distinctTags && distinctTags.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] uppercase tracking-[var(--jordan-tracking-label)] text-ink-faint">
            Tags
          </span>
          {distinctTags.map(({ tag, count: tc }) => {
            const active = activeTag === tag
            return (
              <button
                key={tag}
                type="button"
                onClick={() => {
                  setActiveTag(active ? null : tag)
                  setPage(0)
                  clearSelection()
                }}
                className={cn(
                  'rounded-[var(--jordan-radius-sm)] border px-2 py-0.5 text-[11px] transition-colors',
                  active
                    ? 'border-[color:color-mix(in_oklab,var(--jordan-accent)_40%,transparent)] bg-[var(--jordan-accent-soft)] text-[var(--jordan-accent-hover)]'
                    : 'border-hairline bg-surface-2 text-ink-muted hover:bg-surface-3 hover:text-ink',
                )}
              >
                {tag}
                <span className="ml-1 text-ink-faint">{tc}</span>
              </button>
            )
          })}
          {activeTag && (
            <button
              type="button"
              onClick={() => {
                setActiveTag(null)
                setPage(0)
              }}
              className="text-[11px] uppercase tracking-[var(--jordan-tracking-label)] text-ink-faint hover:text-ink"
            >
              Clear
            </button>
          )}
        </div>
      )}

      {selectedIds.size > 0 && (
        <ContactBulkActionsToolbar selected={selectedContacts} onClear={clearSelection} />
      )}

      <DataTable
        ariaLabel="Contacts"
        columns={columns}
        rows={paginated}
        rowKey={(row) => row.id}
        loading={isLoading}
        error={error}
        onRetry={() => refetch()}
        sort={{ columnId: sortField, direction: sortDir }}
        onSortChange={toggleSort}
        onRowClick={(row) => navigate(`/contacts/${row.id}`)}
        empty={{
          icon: Users,
          title: anyFilters ? 'No contacts match your filters' : 'No contacts yet',
          body: anyFilters
            ? 'Try clearing filters or adjusting the search.'
            : 'Add your first contact or import a CSV to get started.',
          action: anyFilters ? undefined : (
            <Button size="sm" className="h-8" onClick={() => navigate('/contacts/new')}>
              <UserPlus className="w-4 h-4 mr-1.5" />
              Add contact
            </Button>
          ),
          secondary: anyFilters ? undefined : (
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              onClick={() => navigate('/contacts/import')}
            >
              <Upload className="w-4 h-4 mr-1.5" />
              Import CSV
            </Button>
          ),
        }}
      />

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-[12px] text-ink-faint">
          <span className="jordan-tnum">
            {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, serverTotal)} of{' '}
            {serverTotal}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              disabled={page === 0}
              onClick={() => {
                setPage((p) => Math.max(0, p - 1))
                clearSelection()
              }}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              disabled={page >= totalPages - 1}
              onClick={() => {
                setPage((p) => Math.min(totalPages - 1, p + 1))
                clearSelection()
              }}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      <ContactVoiceNoteDialog open={voiceOpen} onOpenChange={setVoiceOpen} />
    </div>
  )
}
