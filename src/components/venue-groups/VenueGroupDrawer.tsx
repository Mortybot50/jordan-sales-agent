import { Loader2, X } from 'lucide-react'

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { EmptyState, StatusPill } from '@/components/primitives'
import {
  useVenueGroup,
  useAssignVenueToGroup,
} from '@/lib/queries/venue-groups'
import { venueTypeLabel } from '@/lib/utils'

interface VenueGroupDrawerProps {
  groupId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function VenueGroupDrawer({
  groupId,
  open,
  onOpenChange,
}: VenueGroupDrawerProps) {
  const { data, isLoading } = useVenueGroup(groupId)
  const removeMut = useAssignVenueToGroup()

  async function handleRemove(venueId: string) {
    try {
      await removeMut.mutateAsync({ venue_id: venueId, group_id: null })
    } catch {
      /* toast via mutation */
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto p-0">
        <SheetHeader className="px-5 pt-5 pb-3 border-b border-hairline">
          <SheetTitle>{data?.group.name ?? 'Group'}</SheetTitle>
          <SheetDescription>
            {data?.group.abn ? `ABN ${data.group.abn} · ` : ''}
            {(data?.members.length ?? 0)} member
            {(data?.members.length ?? 0) === 1 ? '' : 's'}
          </SheetDescription>
        </SheetHeader>

        <div className="px-5 py-4 space-y-4">
          {data?.group.notes && (
            <p className="text-[12px] text-ink-muted whitespace-pre-wrap">
              {data.group.notes}
            </p>
          )}

          {isLoading ? (
            <div className="flex items-center gap-2 text-ink-faint text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading members…
            </div>
          ) : !data || data.members.length === 0 ? (
            <EmptyState
              title="No venues in this group yet"
              body="Open a venue from Contacts and use 'Assign to group' to add it here."
            />
          ) : (
            <ul className="space-y-1.5">
              {data.members.map((v) => (
                <li
                  key={v.id}
                  className="rounded-md border border-hairline px-3 py-2 flex items-center justify-between gap-2"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="truncate font-medium text-ink text-[13px]">
                        {v.name}
                      </span>
                      {v.venue_type && (
                        <StatusPill
                          tone="neutral"
                          className="shrink-0 h-[16px] px-1 text-[10px]"
                        >
                          {venueTypeLabel(v.venue_type)}
                        </StatusPill>
                      )}
                    </div>
                    {v.suburb && (
                      <p className="text-[11px] text-ink-faint truncate">
                        {v.suburb}
                      </p>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 shrink-0 text-ink-faint hover:text-[var(--jordan-danger-text)] hover:bg-[var(--jordan-danger-soft)]"
                    onClick={() => handleRemove(v.id)}
                    disabled={removeMut.isPending}
                    aria-label={`Remove ${v.name} from group`}
                    title="Remove from group"
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
