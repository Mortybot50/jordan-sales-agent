import * as React from 'react'
import { type LucideIcon } from 'lucide-react'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { StatusPill, type PillTone } from '@/components/primitives'
import { cn } from '@/lib/utils'

/**
 * BriefingSection — one section of the Morning Briefing page.
 *
 * Hairline-bordered card with a collapsible header: icon + title + count
 * pill + optional action slot. Body is either a skeleton stack, an
 * `EmptyState`, or the consumer's rows.
 *
 * This wraps shadcn Accordion so sections share the same rhythm but each
 * can own its own open state via the enclosing <Accordion multiple>.
 */
export interface BriefingSectionProps {
  id: string
  title: React.ReactNode
  icon: LucideIcon
  tone?: PillTone
  count?: number
  headerAction?: React.ReactNode
  children: React.ReactNode
  className?: string
}

const toneBadge: Record<PillTone, string> = {
  hot: 'bg-[var(--jordan-hot-soft)] text-[var(--jordan-hot-text)]',
  warm: 'bg-[var(--jordan-warm-soft)] text-[var(--jordan-warm-text)]',
  cold: 'bg-[var(--jordan-cold-soft)] text-[var(--jordan-cold-text)]',
  success: 'bg-[var(--jordan-success-soft)] text-[var(--jordan-success-text)]',
  warning: 'bg-[var(--jordan-warning-soft)] text-[var(--jordan-warning-text)]',
  danger: 'bg-[var(--jordan-danger-soft)] text-[var(--jordan-danger-text)]',
  accent: 'bg-[var(--jordan-accent-soft)] text-[var(--jordan-accent-hover)]',
  neutral: 'bg-surface-4 text-ink-muted',
}

export function BriefingSection({
  id,
  title,
  icon: Icon,
  tone = 'neutral',
  count,
  headerAction,
  children,
  className,
}: BriefingSectionProps) {
  return (
    <AccordionItem
      value={id}
      className={cn(
        'overflow-hidden rounded-[var(--jordan-radius-md)] border border-hairline bg-surface-1',
        className,
      )}
    >
      <div className="flex items-center gap-2 pr-3">
        <AccordionTrigger className="flex-1 rounded-none px-4 py-3 hover:no-underline hover:bg-surface-3">
          <div className="flex items-center gap-2.5 text-left">
            <span
              className={cn(
                'flex size-7 shrink-0 items-center justify-center rounded-[var(--jordan-radius-sm)]',
                toneBadge[tone],
              )}
            >
              <Icon size={14} strokeWidth={2} />
            </span>
            <span className="text-[13px] font-semibold text-ink">{title}</span>
            {typeof count === 'number' && (
              <StatusPill tone={count > 0 ? tone : 'neutral'} className="jordan-tnum">
                {count}
              </StatusPill>
            )}
          </div>
        </AccordionTrigger>
        {headerAction && (
          <div
            className="flex shrink-0 items-center"
            onClick={(e) => e.stopPropagation()}
          >
            {headerAction}
          </div>
        )}
      </div>
      <AccordionContent className="border-t border-hairline bg-surface-1 px-0 pb-0">
        {children}
      </AccordionContent>
    </AccordionItem>
  )
}

export { Accordion }
