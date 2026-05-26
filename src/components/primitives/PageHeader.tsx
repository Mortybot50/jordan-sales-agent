import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * PageHeader — one per page.
 *
 * Title (20px Inter) + optional eyebrow breadcrumb + action slot on the
 * right. Keeps vertical rhythm consistent across every screen.
 */
export interface PageHeaderProps extends Omit<React.HTMLAttributes<HTMLElement>, 'title'> {
  title: React.ReactNode
  /** Small uppercase breadcrumb / section label above the title. */
  eyebrow?: React.ReactNode
  /** Body-weight description beneath the title. */
  description?: React.ReactNode
  /** Right-aligned action slot. Prefer ONE primary action. */
  actions?: React.ReactNode
}

export const PageHeader = React.forwardRef<HTMLElement, PageHeaderProps>(
  ({ title, eyebrow, description, actions, className, ...rest }, ref) => {
    return (
      <header
        ref={ref}
        data-slot="page-header"
        className={cn(
          'flex flex-col gap-3 border-b border-hairline pb-4 sm:flex-row sm:items-start sm:justify-between sm:gap-4',
          className,
        )}
        {...rest}
      >
        <div className="min-w-0">
          {eyebrow && (
            <div className="mb-1 text-[11px] uppercase tracking-[var(--jordan-tracking-label)] text-ink-faint">
              {eyebrow}
            </div>
          )}
          <h1 className="truncate text-[20px] leading-7 font-semibold text-ink">{title}</h1>
          {description && (
            <p className="mt-1 text-[13px] leading-5 text-ink-muted">{description}</p>
          )}
        </div>
        {actions && (
          <div className="flex flex-wrap items-center gap-2 sm:shrink-0">{actions}</div>
        )}
      </header>
    )
  },
)
PageHeader.displayName = 'PageHeader'
