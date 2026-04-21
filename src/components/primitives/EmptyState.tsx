import * as React from 'react'
import { type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * EmptyState — centred icon + title + body + optional action row.
 *
 * Replaces inline empty-state reimplementations across 4+ screens.
 * Use inside a DataTable's empty slot or as a standalone pane.
 */
export interface EmptyStateProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  icon?: LucideIcon
  title: React.ReactNode
  body?: React.ReactNode
  /** Action slot — typically a primary button. */
  action?: React.ReactNode
  /** Secondary link/action slot. */
  secondary?: React.ReactNode
  /** Compact variant — tighter padding, smaller icon. */
  compact?: boolean
}

export const EmptyState = React.forwardRef<HTMLDivElement, EmptyStateProps>(
  ({ icon: Icon, title, body, action, secondary, compact = false, className, ...rest }, ref) => {
    return (
      <div
        ref={ref}
        data-slot="empty-state"
        className={cn(
          'flex flex-col items-center justify-center gap-3 text-center',
          compact ? 'py-6' : 'py-12',
          className,
        )}
        {...rest}
      >
        {Icon && (
          <div
            className={cn(
              'flex items-center justify-center rounded-full bg-surface-4 text-ink-faint',
              compact ? 'size-10' : 'size-12',
            )}
          >
            <Icon size={compact ? 18 : 22} strokeWidth={1.75} />
          </div>
        )}
        <div className="max-w-sm space-y-1">
          <h3
            className={cn(
              'font-semibold text-ink',
              compact ? 'text-[15px] leading-6' : 'text-[17px] leading-6',
            )}
          >
            {title}
          </h3>
          {body && <p className="text-[13px] leading-5 text-ink-muted">{body}</p>}
        </div>
        {(action || secondary) && (
          <div className="flex items-center gap-2 pt-1">
            {action}
            {secondary}
          </div>
        )}
      </div>
    )
  },
)
EmptyState.displayName = 'EmptyState'
