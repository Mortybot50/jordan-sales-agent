import * as React from 'react'
import { cn, formatRelative } from '@/lib/utils'
import { IntentBadge, StatusPill } from '@/components/primitives'
import { getDraftVariantLabel, type Draft } from '@/lib/queries/drafts'

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
  /** AI-classified reply intent for the most recent inbound from this contact */
  intent?: string | null
  onSelect: () => void
}

export const DraftQueueRow = React.forwardRef<HTMLButtonElement, DraftQueueRowProps>(
  ({ draft, isActive, isSkipped, isRemoving, intent, onSelect, className, ...rest }, ref) => {
    const contact = draft.contact
    const venue = contact?.venue
    const variantLabel = getDraftVariantLabel(draft)

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
            <IntentBadge intent={intent} />
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
          {(draft.sequence_enrollment_id ||
            draft.draft_kind === 'proposed_meeting' ||
            draft.status === 'edited' ||
            isSkipped) && (
            <div className="mt-1 flex items-center gap-1.5">
              {draft.sequence_enrollment_id && (
                <StatusPill
                  tone="neutral"
                  uppercase={false}
                  data-testid="sequence-pill"
                  title={
                    draft.sequence_enrollment?.sequence?.name
                      ? `From sequence: ${draft.sequence_enrollment.sequence.name}`
                      : 'From a sequence'
                  }
                >
                  {variantLabel
                    ? `${variantLabel} · Step ${draft.sequence_step_number ?? '?'}`
                    : `Step ${draft.sequence_step_number ?? '?'}`}
                </StatusPill>
              )}
              {draft.draft_kind === 'proposed_meeting' && (
                <StatusPill
                  tone="warm"
                  uppercase={false}
                  data-testid="needs-diary-pill"
                  title="Needs your diary — add real time slots before sending"
                >
                  <span aria-hidden>📅</span>
                  Needs your diary
                </StatusPill>
              )}
              {draft.status === 'edited' && (
                <StatusPill tone="neutral" uppercase={false}>
                  Edited
                </StatusPill>
              )}
              {isSkipped && (
                <StatusPill tone="cold" uppercase={false}>
                  Skipped
                </StatusPill>
              )}
            </div>
          )}
        </div>
        <span className="jordan-tnum shrink-0 text-[11px] text-ink-faint">
          {formatRelative(draft.generated_at ?? draft.created_at)}
        </span>
      </button>
    )
  },
)
DraftQueueRow.displayName = 'DraftQueueRow'
