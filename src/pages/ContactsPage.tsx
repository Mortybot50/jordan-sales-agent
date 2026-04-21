import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useContacts, scoreToTier } from '@/lib/queries/contacts'
import { venueTypeLabel, roleLabel } from '@/lib/utils'
import { UserPlus, Upload, ChevronUp, ChevronDown, Users } from 'lucide-react'

type SortField = 'name' | 'venue' | 'score'
type SortDir = 'asc' | 'desc'
type TierFilter = 'all' | 'hot' | 'warm' | 'cold'

const PAGE_SIZE = 50

function scoreBadge(score: number | null | undefined) {
  const tier = scoreToTier(score)
  if (tier === 'hot') return <Badge className="bg-red-100 text-red-700 border-0">Hot</Badge>
  if (tier === 'warm') return <Badge className="bg-amber-100 text-amber-700 border-0">Warm</Badge>
  return <Badge className="bg-slate-100 text-slate-600 border-0">Cold</Badge>
}

export function ContactsPage() {
  const navigate = useNavigate()
  const { data: contacts, isLoading, error } = useContacts()

  const [search, setSearch] = useState('')
  const [sortField, setSortField] = useState<SortField>('name')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [tierFilter, setTierFilter] = useState<TierFilter>('all')
  const [page, setPage] = useState(0)

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortDir('asc')
    }
    setPage(0)
  }

  const filtered = useMemo(() => {
    if (!contacts) return []

    let result = contacts

    if (search.trim()) {
      const q = search.trim().toLowerCase()
      result = result.filter(
        (c) =>
          c.full_name.toLowerCase().includes(q) ||
          (c.email ?? '').toLowerCase().includes(q) ||
          (c.venue?.name ?? '').toLowerCase().includes(q)
      )
    }

    if (tierFilter !== 'all') {
      result = result.filter(
        (c) => scoreToTier(c.lead_score?.score) === tierFilter
      )
    }

    result = [...result].sort((a, b) => {
      let cmp = 0
      if (sortField === 'name') {
        cmp = a.full_name.localeCompare(b.full_name)
      } else if (sortField === 'venue') {
        cmp = (a.venue?.name ?? '').localeCompare(b.venue?.name ?? '')
      } else if (sortField === 'score') {
        cmp = (a.lead_score?.score ?? 0) - (b.lead_score?.score ?? 0)
      }
      return sortDir === 'asc' ? cmp : -cmp
    })

    return result
  }, [contacts, search, sortField, sortDir, tierFilter])

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE)
  const paginated = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  function SortIcon({ field }: { field: SortField }) {
    if (sortField !== field)
      return <ChevronDown className="w-3 h-3 text-muted-foreground opacity-40" />
    return sortDir === 'asc' ? (
      <ChevronUp className="w-3 h-3" />
    ) : (
      <ChevronDown className="w-3 h-3" />
    )
  }

  return (
    <div className="p-4 sm:p-6 space-y-4 max-w-7xl">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Contacts</h1>
          {!isLoading && contacts && (
            <p className="text-sm text-muted-foreground mt-0.5">
              {contacts.length} contact{contacts.length !== 1 ? 's' : ''}
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate('/contacts/import')}
          >
            <Upload className="w-4 h-4 mr-1.5" />
            Import CSV
          </Button>
          <Button size="sm" onClick={() => navigate('/contacts/new')}>
            <UserPlus className="w-4 h-4 mr-1.5" />
            Add contact
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        <Input
          placeholder="Search by name, email or venue…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(0) }}
          className="max-w-xs h-8 text-sm"
        />
        <Select
          value={tierFilter}
          onValueChange={(v) => { setTierFilter(v as TierFilter); setPage(0) }}
        >
          <SelectTrigger className="w-32 h-8 text-sm">
            <SelectValue placeholder="Score tier" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All tiers</SelectItem>
            <SelectItem value="hot">Hot (80+)</SelectItem>
            <SelectItem value="warm">Warm (50–79)</SelectItem>
            <SelectItem value="cold">Cold (&lt;50)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Error */}
      {error && (
        <div className="text-destructive text-sm p-4">
          Failed to load: {error.message}
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="text-sm text-muted-foreground py-8 text-center">Loading…</div>
      )}

      {/* Empty state */}
      {!isLoading && !error && filtered.length === 0 && (
        <div className="border rounded-lg py-16 text-center space-y-4">
          <Users className="w-10 h-10 mx-auto text-muted-foreground opacity-40" />
          <div>
            <p className="text-sm font-medium">
              {search || tierFilter !== 'all' ? 'No contacts match your filters' : 'No contacts yet'}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {search || tierFilter !== 'all'
                ? 'Try adjusting your search or filter.'
                : 'Add your first contact or import a CSV to get started.'}
            </p>
          </div>
          {!search && tierFilter === 'all' && (
            <div className="flex gap-2 justify-center">
              <Button variant="outline" size="sm" onClick={() => navigate('/contacts/import')}>
                <Upload className="w-4 h-4 mr-1.5" />
                Import CSV
              </Button>
              <Button size="sm" onClick={() => navigate('/contacts/new')}>
                <UserPlus className="w-4 h-4 mr-1.5" />
                Add contact
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Table */}
      {!isLoading && !error && filtered.length > 0 && (
        <>
          <div className="border rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/40">
                    <th className="text-left px-3 py-2 font-medium">
                      <button
                        className="flex items-center gap-1 hover:text-foreground"
                        onClick={() => toggleSort('name')}
                      >
                        Name <SortIcon field="name" />
                      </button>
                    </th>
                    <th className="text-left px-3 py-2 font-medium hidden sm:table-cell">
                      Role
                    </th>
                    <th className="text-left px-3 py-2 font-medium">
                      <button
                        className="flex items-center gap-1 hover:text-foreground"
                        onClick={() => toggleSort('venue')}
                      >
                        Venue <SortIcon field="venue" />
                      </button>
                    </th>
                    <th className="text-left px-3 py-2 font-medium hidden md:table-cell">
                      Email
                    </th>
                    <th className="text-left px-3 py-2 font-medium hidden lg:table-cell">
                      Phone
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
                  {paginated.map((contact) => (
                    <tr
                      key={contact.id}
                      className="hover:bg-muted/30 cursor-pointer transition-colors"
                      onClick={() => navigate(`/contacts/${contact.id}`)}
                    >
                      <td className="px-3 py-2.5 font-medium">{contact.full_name}</td>
                      <td className="px-3 py-2.5 text-muted-foreground hidden sm:table-cell">
                        {roleLabel(contact.role)}
                      </td>
                      <td className="px-3 py-2.5">
                        <div>
                          <span className="text-sm">{contact.venue?.name ?? '—'}</span>
                          {contact.venue?.venue_type && (
                            <Badge
                              variant="outline"
                              className="ml-1.5 text-xs hidden sm:inline-flex"
                            >
                              {venueTypeLabel(contact.venue.venue_type)}
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground hidden md:table-cell">
                        {contact.email ?? '—'}
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground hidden lg:table-cell">
                        {contact.phone ?? '—'}
                      </td>
                      <td className="px-3 py-2.5">
                        {scoreBadge(contact.lead_score?.score)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, filtered.length)} of {filtered.length}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page === 0}
                  onClick={() => setPage((p) => p - 1)}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages - 1}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
