import { useMemo, useState } from 'react'
import { Building2, Check, ChevronsUpDown, Plus, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import {
  useVenueGroups,
  useAssignVenueToGroup,
  useCreateVenueGroup,
  type VenueGroupWithCount,
} from '@/lib/queries/venue-groups'

interface AssignToGroupComboboxProps {
  venueId: string
  /** Current group_id on the venue, or null if ungrouped. */
  currentGroupId: string | null
  orgId: string
  /** Compact icon-only trigger for use in dense table rows. */
  compact?: boolean
  className?: string
}

/**
 * Searchable group picker with inline create. Used on venue rows / contact
 * detail to assign or change the venue's parent group.
 *
 * UX: button → popover. Search filters by name. Empty list shows the
 * "+ Create '<query>'" CTA which creates the group and assigns in one go.
 */
export function AssignToGroupCombobox({
  venueId,
  currentGroupId,
  orgId,
  compact = false,
  className,
}: AssignToGroupComboboxProps) {
  const { data: groups, isLoading } = useVenueGroups()
  const assignMut = useAssignVenueToGroup()
  const createMut = useCreateVenueGroup()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  const currentGroup = useMemo<VenueGroupWithCount | null>(() => {
    if (!currentGroupId) return null
    return groups?.find((g) => g.id === currentGroupId) ?? null
  }, [groups, currentGroupId])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = groups ?? []
    if (!q) return list
    return list.filter((g) => g.name.toLowerCase().includes(q))
  }, [groups, query])

  const exactMatch = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return false
    return (groups ?? []).some((g) => g.name.toLowerCase() === q)
  }, [groups, query])

  async function handleSelect(groupId: string) {
    if (groupId === currentGroupId) {
      setOpen(false)
      return
    }
    try {
      await assignMut.mutateAsync({ venue_id: venueId, group_id: groupId })
      setOpen(false)
      setQuery('')
    } catch {
      /* toast via mutation */
    }
  }

  async function handleClear() {
    try {
      await assignMut.mutateAsync({ venue_id: venueId, group_id: null })
      setOpen(false)
      setQuery('')
    } catch {
      /* toast via mutation */
    }
  }

  async function handleCreateAndAssign() {
    const name = query.trim()
    if (!name) return
    try {
      const res = await createMut.mutateAsync({
        org_id: orgId,
        payload: { name, abn: null, notes: null },
      })
      await assignMut.mutateAsync({
        venue_id: venueId,
        group_id: res.id,
      })
      setOpen(false)
      setQuery('')
    } catch {
      /* toast via mutation */
    }
  }

  const isBusy = assignMut.isPending || createMut.isPending

  const triggerLabel = currentGroup ? currentGroup.name : 'Assign to group'

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          role="combobox"
          aria-expanded={open}
          aria-label={
            currentGroup
              ? `Group: ${currentGroup.name}. Change group.`
              : 'Assign venue to a group'
          }
          disabled={isBusy}
          className={cn(
            'h-8 justify-between gap-2 font-normal',
            compact ? 'w-auto px-2' : 'w-full sm:w-[240px]',
            !currentGroup && 'text-ink-muted',
            className,
          )}
        >
          <span className="flex items-center gap-1.5 min-w-0">
            <Building2 className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{triggerLabel}</span>
          </span>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[--radix-popover-trigger-width] min-w-[260px] p-0"
        align="start"
      >
        <div className="border-b border-hairline p-2">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search or create a group…"
            autoFocus
            className="h-8"
          />
        </div>
        <div className="max-h-[260px] overflow-y-auto py-1">
          {isLoading ? (
            <div className="px-3 py-2 text-[12px] text-ink-faint">
              Loading…
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-3 py-2 text-[12px] text-ink-faint">
              No groups match.
            </div>
          ) : (
            <ul className="space-y-0.5">
              {filtered.map((g) => {
                const isCurrent = g.id === currentGroupId
                return (
                  <li key={g.id}>
                    <button
                      type="button"
                      onClick={() => handleSelect(g.id)}
                      disabled={isBusy}
                      className={cn(
                        'w-full flex items-center justify-between gap-2 px-3 py-1.5 text-left text-[13px] rounded-sm',
                        'hover:bg-surface-3 disabled:opacity-50',
                        isCurrent && 'bg-[var(--jordan-accent-soft)]',
                      )}
                    >
                      <span className="flex items-center gap-2 min-w-0">
                        <Check
                          className={cn(
                            'h-3.5 w-3.5 shrink-0',
                            isCurrent
                              ? 'opacity-100 text-[var(--jordan-accent-hover)]'
                              : 'opacity-0',
                          )}
                        />
                        <span className="truncate">{g.name}</span>
                      </span>
                      <span className="text-[11px] text-ink-faint jordan-tnum shrink-0">
                        {g.member_count}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
        <div className="border-t border-hairline p-1.5 space-y-0.5">
          {query.trim() && !exactMatch && (
            <button
              type="button"
              onClick={handleCreateAndAssign}
              disabled={isBusy}
              className={cn(
                'w-full flex items-center gap-2 px-2 py-1.5 text-left text-[13px] rounded-sm',
                'hover:bg-surface-3 disabled:opacity-50',
              )}
            >
              <Plus className="h-3.5 w-3.5" />
              <span className="truncate">
                Create &ldquo;{query.trim()}&rdquo;
              </span>
            </button>
          )}
          {currentGroupId && (
            <button
              type="button"
              onClick={handleClear}
              disabled={isBusy}
              className={cn(
                'w-full flex items-center gap-2 px-2 py-1.5 text-left text-[13px] rounded-sm',
                'hover:bg-surface-3 disabled:opacity-50 text-ink-muted',
              )}
            >
              <X className="h-3.5 w-3.5" />
              Remove from group
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
