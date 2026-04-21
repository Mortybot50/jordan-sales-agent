import * as React from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * SortHeader — column header with sort toggle + aria-sort.
 *
 * Used internally by DataTable, but exported so custom tables can
 * reuse the same visual + a11y semantics.
 */
export type SortDirection = 'asc' | 'desc' | null

export interface SortHeaderProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'onClick'> {
  label: React.ReactNode
  /** Current sort direction for this column. */
  direction?: SortDirection
  /** Called when the user clicks the header to toggle sort. */
  onToggle?: () => void
  /** Right-align for numeric columns. */
  align?: 'left' | 'right'
}

export const SortHeader = React.forwardRef<HTMLButtonElement, SortHeaderProps>(
  ({ label, direction = null, onToggle, align = 'left', className, ...rest }, ref) => {
    const ariaSort: React.AriaAttributes['aria-sort'] =
      direction === 'asc' ? 'ascending' : direction === 'desc' ? 'descending' : 'none'

    const Icon = direction === 'asc' ? ArrowUp : direction === 'desc' ? ArrowDown : ArrowUpDown

    return (
      <button
        ref={ref}
        type="button"
        onClick={onToggle}
        aria-sort={ariaSort}
        data-slot="sort-header"
        data-direction={direction ?? 'none'}
        className={cn(
          'inline-flex h-full items-center gap-1 select-none',
          'text-[11px] uppercase tracking-[var(--jordan-tracking-label)] text-ink-faint',
          'transition-colors hover:text-ink-muted focus-visible:outline-none',
          'focus-visible:text-ink-muted',
          align === 'right' && 'justify-end flex-row-reverse',
          className,
        )}
        {...rest}
      >
        <span>{label}</span>
        <Icon
          size={12}
          strokeWidth={2}
          className={cn(
            'transition-opacity',
            direction ? 'opacity-100 text-[var(--jordan-accent)]' : 'opacity-40',
          )}
        />
      </button>
    )
  },
)
SortHeader.displayName = 'SortHeader'
