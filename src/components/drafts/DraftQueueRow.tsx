import * as React from 'react'
import { cn, formatRelative } from '@/lib/utils'
import { DraftTypeBadge, StatusPill } from '@/components/primitives'
import type { Draft } from '@/lib/queries/drafts'

/**
 * Compact queue row for the Drafts left pane.
 *
 * 60px tall. Hairline bottom, surface-3 hover, accent ring on active,
 * fade+slide out on removal (triggered by parent via key prop).
 */
export interface DraftQueueRowProps extends React.HTMLAttributes<HTMLButtonElement> {
  draft: Draft
  isActive: boolean
  isSkipped?: boolean
  isRemoving?: boolean
  onSelect: () => void
}

export const DraftQueueRow = React.forwardRef<HTMLButtonElement, DraftQueueRowProps>(
  ({ draft, isActive, isSkipped, isRemoving, onSelect, className, ...rest }, ref) => {
    const contact = draft.contact
    const venue = contact?.venue

    return (
      <button
        ref={ref}
        type="button"
        data-slot="draft-queue-row"
        data-active={isActive || undefined}
        onClick={onSelect}
        className={cn(
          'group flex w-full items-start gap-2.5 border-b border-hairline px-3 py-2.5 text-left',
          'transition-[opacity,transform,background-color,border-color] duration-150 ease-out',
          'focus:outline-none focus-visible:outline-none',
          isActive
            ? 'bg-[var(--jordan-accent-soft)] ring-1 ring-inset ring-[color:var(--jordan-accent)]'
            : 'hover:bg-surface-3',
          isSkipped && !isActive && 'opacity-55',
          isRemoving && 'pointer-events-none translate-x-2 opacity-0',
          className,
        )}
        {...rest}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[13px] font-medium text-ink">
              {contact?.full_name ?? 'Unknown contact'}
            </span>
            {venue?.name && (
              <>
                <span className="text-ink-faint">·</span>
                <span className="truncate text-[12px] text-ink-muted">{venue.name}</span>
              </>
            )}
          </div>
          <div className="mt-0.5 truncate text-[12px] text-ink-muted">
            {draft.subject ?? <span className="italic text-ink-faint">(no subject)</span>}
          </div>
          <div className="mt-1 flex items-center gap-1.5">
            <DraftTypeBadge type={draft.draft_type} />
            {draft.status === 'edited' && (
              <StatusPill tone="neutral" uppercase>
                Edited
              </StatusPill>
            )}
            {isSkipped && (
              <StatusPill tone="cold" uppercase>
                Skipped
              </StatusPill>
            )}
          </div>
        </div>
        <span className="jordan-tnum shrink-0 text-[11px] text-ink-faint">
          {formatRelative(draft.generated_at ?? draft.created_at)}
        </span>
      </button>
    )
  },
)
DraftQueueRow.displayName = 'DraftQueueRow'
