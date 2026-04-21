/**
 * Activity metadata map — extracted from ActivityIcon so both can live
 * next to each other without tripping react-refresh/only-export-components.
 *
 * Consumers typically want either:
 *   - <ActivityIcon type="email_sent" /> for the styled icon chip
 *   - getActivityMeta(type).label for prose / aria labels
 */
import {
  Mail,
  MailOpen,
  MousePointerClick,
  MessageCircleReply,
  PhoneCall,
  Users,
  CalendarCheck,
  CheckCircle2,
  MoveRight,
  Briefcase,
  StickyNote,
  AlertTriangle,
  MailX,
  type LucideIcon,
} from 'lucide-react'

export type ActivityTone =
  | 'neutral'
  | 'accent'
  | 'success'
  | 'warning'
  | 'danger'
  | 'cold'

export interface ActivityMeta {
  icon: LucideIcon
  tone: ActivityTone
  label: string
}

export const ACTIVITY_MAP: Record<string, ActivityMeta> = {
  email_sent:     { icon: Mail,                tone: 'accent',  label: 'Email Sent' },
  email_outbound: { icon: Mail,                tone: 'accent',  label: 'Outbound Email' },
  email_opened:   { icon: MailOpen,            tone: 'success', label: 'Email Opened' },
  email_clicked:  { icon: MousePointerClick,   tone: 'success', label: 'Email Clicked' },
  email_inbound:  { icon: MessageCircleReply,  tone: 'success', label: 'Inbound Email' },
  reply_received: { icon: MessageCircleReply,  tone: 'success', label: 'Reply Received' },
  call_note:      { icon: PhoneCall,           tone: 'neutral', label: 'Call' },
  meeting_note:   { icon: Users,               tone: 'neutral', label: 'Meeting' },
  meeting_booked: { icon: CalendarCheck,       tone: 'success', label: 'Meeting Booked' },
  task_completed: { icon: CheckCircle2,        tone: 'success', label: 'Task Completed' },
  stage_change:   { icon: MoveRight,           tone: 'accent',  label: 'Stage Changed' },
  deal_created:   { icon: Briefcase,           tone: 'accent',  label: 'Deal Created' },
  note:           { icon: StickyNote,          tone: 'cold',    label: 'Note' },
  bounce:         { icon: AlertTriangle,       tone: 'danger',  label: 'Bounce' },
  unsubscribe:    { icon: MailX,               tone: 'danger',  label: 'Unsubscribed' },
}

export function getActivityMeta(type: string): ActivityMeta {
  return ACTIVITY_MAP[type] ?? { icon: StickyNote, tone: 'neutral', label: type }
}
