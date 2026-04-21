import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { formatCurrency } from '@/lib/utils'
import type { Deal } from '@/lib/queries/deals'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

interface DealCardProps {
  deal: Deal
  onClick: () => void
}

function scoreBadge(score: number | null | undefined) {
  if (score == null) return null
  if (score >= 80)
    return (
      <Badge className="bg-red-100 text-red-700 border-0 text-xs">
        Hot
      </Badge>
    )
  if (score >= 50)
    return (
      <Badge className="bg-amber-100 text-amber-700 border-0 text-xs">
        Warm
      </Badge>
    )
  return (
    <Badge className="bg-slate-100 text-slate-600 border-0 text-xs">
      Cold
    </Badge>
  )
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

  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      <Card
        className="p-3 cursor-pointer hover:shadow-md transition-shadow select-none"
        onClick={onClick}
        {...listeners}
      >
        <div className="space-y-1.5">
          <p className="text-sm font-medium leading-tight line-clamp-2">
            {deal.title ?? 'Untitled deal'}
          </p>

          {(deal.contact?.full_name || deal.venue?.name) && (
            <div className="text-xs text-muted-foreground space-y-0.5">
              {deal.contact?.full_name && (
                <p className="truncate">{deal.contact.full_name}</p>
              )}
              {deal.venue?.name && (
                <p className="truncate">{deal.venue.name}</p>
              )}
            </div>
          )}

          <div className="flex items-center justify-between gap-1 pt-0.5">
            <span className="text-sm font-semibold">
              {formatCurrency(deal.contract_value)}
            </span>
            <div className="flex items-center gap-1">
              {deal.lead_score?.score != null &&
                scoreBadge(deal.lead_score.score)}
              <span className="text-xs text-muted-foreground">
                {deal.days_in_stage ?? 0}d
              </span>
            </div>
          </div>
        </div>
      </Card>
    </div>
  )
}
