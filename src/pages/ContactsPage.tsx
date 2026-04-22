import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Upload, UserPlus, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DataTable,
  type ColumnDef,
  FacetBar,
  type FacetDef,
  PageHeader,
  ScoreBadge,
  StatusPill,
} from '@/components/primitives'
import { useContacts, scoreToTier, type Contact } from '@/lib/queries/contacts'
import { roleLabel, venueTypeLabel } from '@/lib/utils'

type SortField = 'name' | 'venue' | 'score' | 'suburb'
type SortDir = 'asc' | 'desc'

type SelectionState = Record<string, string[]>

const PAGE_SIZE = 50

export function ContactsPage() {
  const navigate = useNavigate()
  const { data: contacts, isLoading, error, refetch } = useContacts()

  const [search, setSearch] = useState('')
  const [sortField, setSortField] = useState<SortField>('name')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [selection, setSelection] = useState<SelectionState>({})
  const [page, setPage] = useState(0)

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

  const filtered = useMemo(() => {
    if (!contacts) return []
    let rows = contacts

    const q = search.trim().toLowerCase()
    if (q) {
      rows = rows.filter(
        (c) =>
          c.full_name.toLowerCase().includes(q) ||
          (c.email ?? '').toLowerCase().includes(q) ||
          (c.venue?.name ?? '').toLowerCase().includes(q) ||
          (c.venue?.suburb ?? '').toLowerCase().includes(q),
      )
    }

    const tier = selection.tier?.[0]
    if (tier) {
      rows = rows.filter((c) => scoreToTier(c.lead_score?.score) === tier)
    }

    const venueTypes = selection.venue_type ?? []
    if (venueTypes.length > 0) {
      rows = rows.filter((c) => c.venue?.venue_type && venueTypes.includes(c.venue.venue_type))
    }

    const suburbs = selection.suburb ?? []
    if (suburbs.length > 0) {
      rows = rows.filter((c) => c.venue?.suburb && suburbs.includes(c.venue.suburb))
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
  }, [contacts, search, selection, sortField, sortDir])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const paginated = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  function toggleSort(field: string) {
    const f = field as SortField
    if (sortField === f) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(f)
      setSortDir('asc')
    }
    setPage(0)
  }

  const columns: ColumnDef<Contact>[] = [
    {
      id: 'name',
      header: 'Name',
      sortable: true,
      width: 'minmax(180px, 1.6fr)',
      cell: (row) => (
        <span className="truncate font-medium text-ink">{row.full_name}</span>
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
      cell: (row) => (
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-ink">{row.venue?.name ?? '—'}</span>
          {row.venue?.venue_type && (
            <StatusPill tone="neutral" className="shrink-0 h-[16px] px-1 text-[10px]">
              {venueTypeLabel(row.venue.venue_type)}
            </StatusPill>
          )}
        </span>
      ),
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

  const totalCount = contacts?.length ?? 0
  const anyFilters =
    search.trim().length > 0 ||
    Object.values(selection).some((v) => v && v.length > 0)

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
                  new Set((contacts ?? []).map((c) => c.venue?.name).filter(Boolean)).size
                } venues`
        }
        actions={
          <>
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
        }}
        searchPlaceholder="Search name, email, venue, suburb…"
        facets={facets}
        selection={selection}
        onSelectionChange={(facetId, values) => {
          setSelection((s) => ({ ...s, [facetId]: values }))
          setPage(0)
        }}
        onClear={() => {
          setSelection({})
          setSearch('')
          setPage(0)
        }}
        summary={
          <span>
            {filtered.length} <span className="text-ink-disabled">of</span> {totalCount}
          </span>
        }
      />

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
            {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, filtered.length)} of{' '}
            {filtered.length}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              disabled={page >= totalPages - 1}
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
