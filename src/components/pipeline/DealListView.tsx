import { useState, useMemo } from 'react'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useDeals, type Deal } from '@/lib/queries/deals'
import { useStages } from '@/lib/queries/stages'
import { formatCurrency, formatDate } from '@/lib/utils'
import { scoreToTier } from '@/lib/queries/contacts'
import { DealDrawer } from './DealDrawer'
import { ChevronUp, ChevronDown } from 'lucide-react'

type SortField = 'title' | 'contact' | 'venue' | 'value' | 'days' | 'followup' | 'score'
type SortDir = 'asc' | 'desc'

function scoreBadge(score: number | null | undefined) {
  if (score == null) return <Badge className="bg-slate-100 text-slate-600 border-0 text-xs">Cold</Badge>
  if (score >= 80) return <Badge className="bg-red-100 text-red-700 border-0 text-xs">Hot</Badge>
  if (score >= 50) return <Badge className="bg-amber-100 text-amber-700 border-0 text-xs">Warm</Badge>
  return <Badge className="bg-slate-100 text-slate-600 border-0 text-xs">Cold</Badge>
}

function stageBadge(deal: Deal) {
  if (!deal.stage) return null
  return (
    <Badge
      variant="outline"
      className="text-xs"
      style={
        deal.stage.color
          ? { borderColor: deal.stage.color, color: deal.stage.color }
          : {}
      }
    >
      {deal.stage.name}
    </Badge>
  )
}

export function DealListView() {
  const { data: deals, isLoading, error } = useDeals()
  const { data: stages } = useStages()

  const [sortField, setSortField] = useState<SortField>('value')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [stageFilter, setStageFilter] = useState<string>('all')
  const [tierFilter, setTierFilter] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [selectedDeal, setSelectedDeal] = useState<Deal | null>(null)

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortDir('asc')
    }
  }

  const filtered = useMemo(() => {
    if (!deals) return []
    let result = deals

    if (search.trim()) {
      const q = search.toLowerCase()
      result = result.filter(
        (d) =>
          (d.title ?? '').toLowerCase().includes(q) ||
          (d.contact?.full_name ?? '').toLowerCase().includes(q) ||
          (d.venue?.name ?? '').toLowerCase().includes(q)
      )
    }

    if (stageFilter !== 'all') {
      result = result.filter((d) => d.stage_id === stageFilter)
    }

    if (tierFilter !== 'all') {
      result = result.filter(
        (d) => scoreToTier(d.lead_score?.score) === tierFilter
      )
    }

    return [...result].sort((a, b) => {
      let cmp = 0
      switch (sortField) {
        case 'title':
          cmp = (a.title ?? '').localeCompare(b.title ?? '')
          break
        case 'contact':
          cmp = (a.contact?.full_name ?? '').localeCompare(
            b.contact?.full_name ?? ''
          )
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
          cmp = (a.lead_score?.score ?? 0) - (b.lead_score?.score ?? 0)
          break
      }
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [deals, search, stageFilter, tierFilter, sortField, sortDir])

  function SortIcon({ field }: { field: SortField }) {
    if (sortField !== field) return <ChevronDown className="w-3 h-3 opacity-30" />
    return sortDir === 'asc' ? (
      <ChevronUp className="w-3 h-3" />
    ) : (
      <ChevronDown className="w-3 h-3" />
    )
  }

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>
  if (error) return <div className="text-destructive text-sm p-4">Failed to load: {error.message}</div>

  return (
    <>
      <div className="p-4 sm:p-6 space-y-4">
        {/* Filters */}
        <div className="flex gap-2 flex-wrap">
          <Input
            placeholder="Search deals…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-xs h-8 text-sm"
          />
          <Select value={stageFilter} onValueChange={setStageFilter}>
            <SelectTrigger className="w-36 h-8 text-sm">
              <SelectValue placeholder="All stages" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All stages</SelectItem>
              {stages?.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={tierFilter} onValueChange={setTierFilter}>
            <SelectTrigger className="w-28 h-8 text-sm">
              <SelectValue placeholder="All tiers" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All tiers</SelectItem>
              <SelectItem value="hot">Hot</SelectItem>
              <SelectItem value="warm">Warm</SelectItem>
              <SelectItem value="cold">Cold</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {filtered.length === 0 && (
          <div className="text-center py-12 text-sm text-muted-foreground">
            {search || stageFilter !== 'all' || tierFilter !== 'all'
              ? 'No deals match your filters.'
              : 'No deals yet. Add deals from the Kanban view or a contact page.'}
          </div>
        )}

        {filtered.length > 0 && (
          <div className="border rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/40">
                    <th className="text-left px-3 py-2 font-medium">
                      <button
                        className="flex items-center gap-1 hover:text-foreground"
                        onClick={() => toggleSort('title')}
                      >
                        Title <SortIcon field="title" />
                      </button>
                    </th>
                    <th className="text-left px-3 py-2 font-medium hidden sm:table-cell">
                      <button
                        className="flex items-center gap-1 hover:text-foreground"
                        onClick={() => toggleSort('contact')}
                      >
                        Contact <SortIcon field="contact" />
                      </button>
                    </th>
                    <th className="text-left px-3 py-2 font-medium hidden md:table-cell">
                      <button
                        className="flex items-center gap-1 hover:text-foreground"
                        onClick={() => toggleSort('venue')}
                      >
                        Venue <SortIcon field="venue" />
                      </button>
                    </th>
                    <th className="text-left px-3 py-2 font-medium">
                      Stage
                    </th>
                    <th className="text-left px-3 py-2 font-medium">
                      <button
                        className="flex items-center gap-1 hover:text-foreground"
                        onClick={() => toggleSort('value')}
                      >
                        Value <SortIcon field="value" />
                      </button>
                    </th>
                    <th className="text-left px-3 py-2 font-medium hidden sm:table-cell">
                      <button
                        className="flex items-center gap-1 hover:text-foreground"
                        onClick={() => toggleSort('days')}
                      >
                        Days <SortIcon field="days" />
                      </button>
                    </th>
                    <th className="text-left px-3 py-2 font-medium hidden lg:table-cell">
                      <button
                        className="flex items-center gap-1 hover:text-foreground"
                        onClick={() => toggleSort('followup')}
                      >
                        Follow-up <SortIcon field="followup" />
                      </button>
                    </th>
                    <th className="text-left px-3 py-2 font-medium">
                      <button
                        className="flex items-center gap-1 hover:text-foreground"
                        onClick={() => toggleSort('score')}
                      >
                        Score <SortIcon field="score" />
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filtered.map((deal) => (
                    <tr
                      key={deal.id}
                      className="hover:bg-muted/30 cursor-pointer transition-colors"
                      onClick={() => setSelectedDeal(deal)}
                    >
                      <td className="px-3 py-2.5 font-medium max-w-[160px] truncate">
                        {deal.title ?? 'Untitled'}
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground hidden sm:table-cell">
                        {deal.contact?.full_name ?? '—'}
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground hidden md:table-cell">
                        {deal.venue?.name ?? '—'}
                      </td>
                      <td className="px-3 py-2.5">{stageBadge(deal)}</td>
                      <td className="px-3 py-2.5 font-medium">
                        {formatCurrency(deal.contract_value)}
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground hidden sm:table-cell">
                        {deal.days_in_stage ?? 0}d
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground hidden lg:table-cell">
                        {formatDate(deal.follow_up_due)}
                      </td>
                      <td className="px-3 py-2.5">
                        {scoreBadge(deal.lead_score?.score)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
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
