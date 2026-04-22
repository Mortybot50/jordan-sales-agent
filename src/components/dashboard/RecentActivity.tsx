import {
  ActivityIcon,
  ErrorAlert,
  EmptyState,
  SkeletonCard,
  getActivityMeta,
} from '@/components/primitives'
import { Activity } from 'lucide-react'
import { formatRelative } from '@/lib/utils'
import { useRecentActivities } from '@/lib/queries/activities'

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
              return (
                <li
                  key={activity.id}
                  className="relative flex gap-3 pb-3 last:pb-0"
                >
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
                </li>
              )
            })}
          </ol>
        )}
      </div>
    </section>
  )
}
