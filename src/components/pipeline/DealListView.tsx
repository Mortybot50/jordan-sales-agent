import { useState, useMemo, useEffect } from 'react'
import {
  BrandChip,
  DataTable,
  type ColumnDef,
  FacetBar,
  type FacetDef,
  MetricNumber,
  ScoreBadge,
  StatusPill,
} from '@/components/primitives'
import { Briefcase } from 'lucide-react'
import { useDeals, type Deal } from '@/lib/queries/deals'
import { useStages } from '@/lib/queries/stages'
import { formatDate } from '@/lib/utils'
import { scoreToTier } from '@/lib/queries/contacts'
import { DealDrawer } from './DealDrawer'

type SortField = 'title' | 'venue' | 'value' | 'days' | 'followup' | 'score' | 'stalest'
type SortDir = 'asc' | 'desc'

type SelectionState = Record<string, string[]>

export interface DealListViewProps {
  /** When true, include currently-snoozed deals (otherwise hidden by default). */
  includeSnoozed?: boolean
  /** External sort hint from the page-level Pipeline sort dropdown. */
  sortBy?: 'default' | 'stalest'
}

export function DealListView({ includeSnoozed = false, sortBy = 'default' }: DealListViewProps = {}) {
  const { data: deals, isLoading, error, refetch } = useDeals({ includeSnoozed })
  const { data: stages } = useStages()

  const [sortField, setSortField] = useState<SortField>(sortBy === 'stalest' ? 'stalest' : 'value')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  // Reflect external sort changes from the Pipeline-level dropdown.
  // Only react when sortBy actually flips between modes.
  useEffect(() => {
    if (sortBy === 'stalest') {
      setSortField('stalest')
      setSortDir('desc')
    } else if (sortField === 'stalest') {
      setSortField('value')
      setSortDir('desc')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortBy])
  const [selection, setSelection] = useState<SelectionState>({})
  const [search, setSearch] = useState('')
  const [selectedDeal, setSelectedDeal] = useState<Deal | null>(null)

  function toggleSort(field: string) {
    const f = field as SortField
    if (sortField === f) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(f)
      setSortDir('asc')
    }
  }

  const facets: FacetDef[] = useMemo(
    () => [
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
      ...(stages && stages.length > 0
        ? [
            {
              id: 'stage',
              label: 'Stage',
              mode: 'multi' as const,
              options: stages.map((s) => ({ value: s.id, label: s.name })),
            },
          ]
        : []),
    ],
    [stages],
  )

  const filtered = useMemo(() => {
    if (!deals) return []
    let rows = deals

    const q = search.trim().toLowerCase()
    if (q) {
      rows = rows.filter(
        (d) =>
          (d.title ?? '').toLowerCase().includes(q) ||
          (d.contact?.full_name ?? '').toLowerCase().includes(q) ||
          (d.venue?.name ?? '').toLowerCase().includes(q),
      )
    }

    const tier = selection.tier?.[0]
    if (tier) {
      rows = rows.filter((d) => scoreToTier(d.lead_score?.score) === tier)
    }

    const stageIds = selection.stage ?? []
    if (stageIds.length > 0) {
      rows = rows.filter((d) => d.stage_id && stageIds.includes(d.stage_id))
    }

    return [...rows].sort((a, b) => {
      let cmp = 0
      switch (sortField) {
        case 'title':
          cmp = (a.title ?? '').localeCompare(b.title ?? '')
          break
        case 'venue':
          cmp = (a.venue?.name ?? '').localeCompare(b.venue?.name ?? '')
          break
        case 'value':
          cmp = (a.contract_value ?? 0) - (b.contract_value ?? 0)
          break
        case 'days':
          cmp = (a.days_in_stage ?? 0) - (b.days_in_stage ?? 0)
          break
        case 'followup':
          cmp = (a.follow_up_due ?? '').localeCompare(b.follow_up_due ?? '')
          break
        case 'score':
          cmp = (a.lead_score?.score ?? -1) - (b.lead_score?.score ?? -1)
          break
        case 'stalest':
          cmp =
            (a.days_since_last_activity ?? 0) -
            (b.days_since_last_activity ?? 0)
          break
      }
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [deals, search, selection, sortField, sortDir])

  const columns: ColumnDef<Deal>[] = [
    {
      id: 'title',
      header: 'Deal',
      sortable: true,
      width: 'minmax(200px, 1.8fr)',
      cell: (row) => {
        const label = row.product?.label ?? row.title ?? 'Untitled'
        return (
          <span className="flex items-center gap-1.5 min-w-0">
            {row.product?.brand && <BrandChip brand={row.product.brand} />}
            <span className="truncate font-medium text-ink" title={row.title ?? label}>
              {label}
            </span>
          </span>
        )
      },
    },
    {
      id: 'venue',
      header: 'Venue',
      sortable: true,
      width: 'minmax(140px, 1.4fr)',
      cell: (row) => (
        <span className="truncate text-ink-muted">
          {row.venue?.name ?? row.contact?.full_name ?? '—'}
        </span>
      ),
    },
    {
      id: 'stage',
      header: 'Stage',
      width: '120px',
      cell: (row) =>
        row.stage ? (
          <StatusPill
            tone="neutral"
            className="h-[18px] px-1.5 text-[10px]"
            style={
              row.stage.color
                ? {
                    color: row.stage.color,
                    borderColor: row.stage.color,
                    backgroundColor: 'transparent',
                    borderWidth: 1,
                    borderStyle: 'solid',
                  }
                : undefined
            }
          >
            {row.stage.name}
          </StatusPill>
        ) : (
          <span className="text-ink-disabled">—</span>
        ),
    },
    {
      id: 'value',
      header: 'Value',
      sortable: true,
      align: 'right',
      width: '104px',
      cell: (row) => (
        <MetricNumber value={row.contract_value} format="currency" className="text-ink" />
      ),
    },
    {
      id: 'days',
      header: 'Days',
      sortable: true,
      align: 'right',
      width: '72px',
      cell: (row) => {
        const d = row.days_in_stage ?? 0
        return (
          <span className={`jordan-tnum ${d >= 14 ? 'text-warm' : 'text-ink-muted'}`}>
            {d}d
          </span>
        )
      },
    },
    {
      id: 'followup',
      header: 'Follow-up',
      sortable: true,
      align: 'right',
      width: '108px',
      cell: (row) =>
        row.follow_up_due ? (
          <span className="jordan-tnum text-ink-muted">{formatDate(row.follow_up_due)}</span>
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

  const totalValue = filtered.reduce((sum, d) => sum + (d.contract_value ?? 0), 0)
  const anyFilters = search.trim().length > 0 || Object.values(selection).some((v) => v && v.length > 0)

  return (
    <>
      <div className="p-4 sm:p-6 space-y-4">
        <FacetBar
          search={search}
          onSearchChange={setSearch}
          searchPlaceholder="Search title, contact, venue…"
          facets={facets}
          selection={selection}
          onSelectionChange={(facetId, values) =>
            setSelection((s) => ({ ...s, [facetId]: values }))
          }
          onClear={() => {
            setSelection({})
            setSearch('')
          }}
          summary={
            <span>
              {filtered.length}{' '}
              <span className="text-ink-disabled">deals ·</span>{' '}
              <MetricNumber value={totalValue} format="currency" />
            </span>
          }
        />

        <DataTable
          ariaLabel="Deals"
          columns={columns}
          rows={filtered}
          rowKey={(row) => row.id}
          loading={isLoading}
          error={error}
          onRetry={() => refetch()}
          sort={{ columnId: sortField, direction: sortDir }}
          onSortChange={toggleSort}
          onRowClick={(row) => setSelectedDeal(row)}
          empty={{
            icon: Briefcase,
            title: anyFilters ? 'No deals match your filters' : 'No deals yet',
            body: anyFilters
              ? 'Try clearing filters or adjusting the search.'
              : 'Add a deal from the Kanban view or from a contact page.',
          }}
        />
      </div>

      {selectedDeal && (
        <DealDrawer
          deal={selectedDeal}
          open={!!selectedDeal}
          onClose={() => setSelectedDeal(null)}
        />
      )}
    </>
  )
}
