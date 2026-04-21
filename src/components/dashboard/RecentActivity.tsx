import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { activityTypeLabel, formatRelative } from '@/lib/utils'
import { useRecentActivities } from '@/lib/queries/activities'
import type { ActivityType } from '@/lib/queries/activities'
import {
  Mail,
  MailOpen,
  MousePointerClick,
  Reply,
  Phone,
  CalendarCheck,
  CheckSquare,
  ArrowRight,
  AlertCircle,
  UserMinus,

  PlusCircle,
  StickyNote,
  Calendar,
  Activity,
} from 'lucide-react'

function ActivityIcon({ type }: { type: ActivityType }) {
  const cls = 'w-4 h-4 shrink-0'
  switch (type) {
    case 'email_sent':
    case 'email_outbound':
      return <Mail className={cls} />
    case 'email_opened':
      return <MailOpen className={cls} />
    case 'email_clicked':
      return <MousePointerClick className={cls} />
    case 'reply_received':
    case 'email_inbound':
      return <Reply className={cls} />
    case 'call_note':
      return <Phone className={cls} />
    case 'meeting_note':
      return <CalendarCheck className={cls} />
    case 'meeting_booked':
      return <Calendar className={cls} />
    case 'task_completed':
      return <CheckSquare className={cls} />
    case 'stage_change':
      return <ArrowRight className={cls} />
    case 'bounce':
      return <AlertCircle className={cls} />
    case 'unsubscribe':
      return <UserMinus className={cls} />
    case 'deal_created':
      return <PlusCircle className={cls} />
    case 'note':
      return <StickyNote className={cls} />
    default:
      return <Activity className={cls} />
  }
}

function iconColor(type: ActivityType): string {
  switch (type) {
    case 'reply_received':
    case 'email_inbound':
      return 'text-green-600'
    case 'meeting_note':
    case 'meeting_booked':
      return 'text-blue-600'
    case 'call_note':
      return 'text-purple-600'
    case 'bounce':
    case 'unsubscribe':
      return 'text-destructive'
    case 'deal_created':
      return 'text-primary'
    case 'email_opened':
    case 'email_clicked':
      return 'text-amber-600'
    default:
      return 'text-muted-foreground'
  }
}

export function RecentActivity() {
  const { data: activities, isLoading, error } = useRecentActivities(10)

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Recent Activity</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading && (
          <div className="px-4 py-6 text-sm text-muted-foreground">Loading…</div>
        )}
        {error && (
          <div className="text-destructive text-sm p-4">
            Failed to load: {error.message}
          </div>
        )}
        {!isLoading && !error && (!activities || activities.length === 0) && (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            No activity logged yet.
          </div>
        )}
        {!isLoading && activities && activities.length > 0 && (
          <div className="divide-y">
            {activities.map((activity) => (
              <div key={activity.id} className="flex items-start gap-3 px-4 py-3">
                <div className={`mt-0.5 ${iconColor(activity.activity_type)}`}>
                  <ActivityIcon type={activity.activity_type} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-xs font-medium text-muted-foreground">
                      {activityTypeLabel(activity.activity_type)}
                    </span>
                    {activity.contact?.full_name && (
                      <>
                        <span className="text-xs text-muted-foreground">·</span>
                        <span className="text-xs text-foreground">
                          {activity.contact.full_name}
                        </span>
                      </>
                    )}
                  </div>
                  {activity.subject && (
                    <p className="text-sm truncate mt-0.5">{activity.subject}</p>
                  )}
                </div>
                <span className="text-xs text-muted-foreground shrink-0 pt-0.5">
                  {formatRelative(activity.occurred_at)}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
