import {
  ActivityIcon,
  ErrorAlert,
  EmptyState,
  SkeletonCard,
  getActivityMeta,
} from '@/components/primitives'
import { Activity } from 'lucide-react'
import { Link } from 'react-router-dom'
import { formatRelative } from '@/lib/utils'
import { useRecentActivities } from '@/lib/queries/activities'

/** Resolve the click target for an activity row. Returns null for no-op. */
function activityHref(a: {
  contact_id: string | null
  deal_id: string | null
}): string | null {
  if (a.contact_id) return `/contacts/${a.contact_id}`
  if (a.deal_id) return `/pipeline?deal=${encodeURIComponent(a.deal_id)}`
  return null
}

export function RecentActivity() {
  const { data: activities, isLoading, error, refetch } = useRecentActivities(10)

  return (
    <section className="rounded-[6px] border border-hairline bg-surface-1 overflow-hidden">
      <header className="px-4 py-3 border-b border-hairline">
        <h2 className="text-[13px] font-semibold text-ink">Recent Activity</h2>
        <p className="text-[11px] text-ink-faint mt-0.5">Latest 10 events across your pipeline</p>
      </header>
      <div className="p-4">
        {isLoading && (
          <div className="space-y-2">
            <SkeletonCard lines={1} withAvatar />
            <SkeletonCard lines={1} withAvatar />
            <SkeletonCard lines={1} withAvatar />
          </div>
        )}
        {error && (
          <ErrorAlert
            compact
            title="Failed to load activity"
            error={error}
            onRetry={() => refetch()}
          />
        )}
        {!isLoading && !error && (!activities || activities.length === 0) && (
          <EmptyState
            compact
            icon={Activity}
            title="No activity logged yet"
            body="Outbound emails, replies and notes will show up here as they happen."
          />
        )}
        {!isLoading && !error && activities && activities.length > 0 && (
          <ol className="relative">
            {/* Vertical rail */}
            <div
              aria-hidden
              className="absolute left-[11px] top-3 bottom-3 w-px bg-hairline"
            />
            {activities.map((activity) => {
              const meta = getActivityMeta(activity.activity_type)
              const href = activityHref(activity)
              const inner = (
                <>
                  <div className="relative z-[1] mt-0.5 shrink-0">
                    <ActivityIcon type={activity.activity_type} size="sm" />
                  </div>
                  <div className="min-w-0 flex-1 pt-0.5">
                    <div className="flex items-baseline gap-2">
                      <span className="text-[11px] uppercase tracking-[var(--jordan-tracking-label)] text-ink-faint">
                        {meta.label}
                      </span>
                      {activity.contact?.full_name && (
                        <span className="truncate text-[12px] text-ink">
                          {activity.contact.full_name}
                        </span>
                      )}
                      <span className="ml-auto shrink-0 jordan-tnum text-[11px] text-ink-faint">
                        {formatRelative(activity.occurred_at)}
                      </span>
                    </div>
                    {activity.subject && (
                      <p className="mt-0.5 truncate text-[13px] text-ink">{activity.subject}</p>
                    )}
                  </div>
                </>
              )
              return (
                <li key={activity.id} className="relative pb-3 last:pb-0">
                  {href ? (
                    <Link
                      to={href}
                      aria-label={`Open ${activity.contact?.full_name ?? meta.label}`}
                      title={activity.subject ?? meta.label}
                      className="flex gap-3 -mx-2 px-2 py-1 rounded-[4px] hover:bg-surface-2 focus:outline-none focus-visible:bg-surface-2 transition-colors"
                    >
                      {inner}
                    </Link>
                  ) : (
                    <div className="flex gap-3">{inner}</div>
                  )}
                </li>
              )
            })}
          </ol>
        )}
      </div>
    </section>
  )
}
