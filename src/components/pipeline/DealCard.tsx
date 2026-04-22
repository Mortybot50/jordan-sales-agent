import { MetricNumber, ScoreBadge } from '@/components/primitives'
import { cn } from '@/lib/utils'
import type { Deal } from '@/lib/queries/deals'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

interface DealCardProps {
  deal: Deal
  onClick: () => void
}

export function DealCard({ deal, onClick }: DealCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: deal.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  const days = deal.days_in_stage ?? 0
  const stale = days >= 14

  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      <div
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onClick()
          }
        }}
        className={cn(
          'group select-none cursor-pointer rounded-[6px] border border-hairline bg-surface-1',
          'px-3 py-2 transition-all duration-150',
          'hover:border-brand hover:shadow-[var(--jordan-shadow-hover)]',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40',
        )}
        {...listeners}
      >
        <div className="space-y-1.5">
          <p className="text-[13px] leading-[18px] font-medium text-ink line-clamp-2">
            {deal.title ?? 'Untitled deal'}
          </p>

          {(deal.contact?.full_name || deal.venue?.name) && (
            <p className="truncate text-[11px] text-ink-faint">
              {deal.venue?.name ?? deal.contact?.full_name}
            </p>
          )}

          <div className="flex items-center justify-between gap-1 pt-0.5">
            <MetricNumber
              value={deal.contract_value}
              format="currency"
              className="text-[13px] font-semibold text-ink"
            />
            <div className="flex items-center gap-1.5">
              {deal.lead_score?.score != null && <ScoreBadge score={deal.lead_score.score} />}
              <span
                className={cn(
                  'jordan-tnum text-[11px]',
                  stale ? 'text-warm' : 'text-ink-faint',
                )}
                title={`${days} days in stage`}
              >
                {days}d
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
