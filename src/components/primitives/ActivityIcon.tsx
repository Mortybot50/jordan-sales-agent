import * as React from 'react'
import { cn } from '@/lib/utils'
import { getActivityMeta, type ActivityTone } from './activity-meta'

/**
 * ActivityIcon — single source of truth for activity-type iconography
 * and tone. Consolidates duplicated mappings previously living in
 * RecentActivity, ContactDetailPage, DealDrawer, and elsewhere.
 *
 * Mapping data lives in `./activity-meta.ts` so both pure functions
 * and the component can be imported without react-refresh complaints.
 */

const toneClass: Record<ActivityTone, string> = {
  neutral: 'bg-[var(--jordan-surface-4)] text-[var(--jordan-ink-muted)]',
  accent:  'bg-[var(--jordan-accent-soft)] text-[var(--jordan-accent-hover)]',
  success: 'bg-[var(--jordan-success-soft)] text-[var(--jordan-success-text)]',
  warning: 'bg-[var(--jordan-warning-soft)] text-[var(--jordan-warning-text)]',
  danger:  'bg-[var(--jordan-danger-soft)] text-[var(--jordan-danger-text)]',
  cold:    'bg-[var(--jordan-cold-soft)] text-[var(--jordan-cold-text)]',
}

export interface ActivityIconProps extends React.HTMLAttributes<HTMLSpanElement> {
  type: string
  size?: 'sm' | 'md'
}

export const ActivityIcon = React.forwardRef<HTMLSpanElement, ActivityIconProps>(
  ({ type, size = 'md', className, ...rest }, ref) => {
    const meta = getActivityMeta(type)
    const Icon = meta.icon
    const iconSize = size === 'sm' ? 12 : 14

    return (
      <span
        ref={ref}
        data-slot="activity-icon"
        aria-label={meta.label}
        className={cn(
          'inline-flex items-center justify-center rounded-full',
          size === 'sm' ? 'size-5' : 'size-6',
          toneClass[meta.tone],
          className,
        )}
        {...rest}
      >
        <Icon size={iconSize} strokeWidth={2} />
      </span>
    )
  },
)
ActivityIcon.displayName = 'ActivityIcon'
