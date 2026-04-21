import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { format, formatDistanceToNow, parseISO } from 'date-fns'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(value: number | null | undefined): string {
  if (value == null) return '—'
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value)
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    return format(parseISO(iso), 'd MMM yyyy')
  } catch {
    return '—'
  }
}

export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return 'never'
  try {
    return formatDistanceToNow(parseISO(iso), { addSuffix: true })
  } catch {
    return '—'
  }
}

export function venueTypeLabel(type: string | null | undefined): string {
  const labels: Record<string, string> = {
    restaurant: 'Restaurant',
    cafe: 'Café',
    hotel: 'Hotel',
    event_space: 'Event Space',
    bar: 'Bar',
    club: 'Club',
    pub: 'Pub',
    qsr: 'QSR',
    function_centre: 'Function Centre',
    franchise_chain: 'Franchise Chain',
    other: 'Other',
  }
  return type ? (labels[type] ?? type) : '—'
}

export function roleLabel(role: string | null | undefined): string {
  const labels: Record<string, string> = {
    venue_manager: 'Venue Manager',
    owner: 'Owner',
    f_b_director: 'F&B Director',
    head_chef: 'Head Chef',
    events_manager: 'Events Manager',
  }
  return role ? (labels[role] ?? role) : '—'
}

export function activityTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    email_sent: 'Email Sent',
    email_opened: 'Email Opened',
    email_clicked: 'Email Clicked',
    reply_received: 'Reply Received',
    email_inbound: 'Inbound Email',
    email_outbound: 'Outbound Email',
    call_note: 'Call',
    meeting_note: 'Meeting',
    meeting_booked: 'Meeting Booked',
    task_completed: 'Task Completed',
    stage_change: 'Stage Changed',
    deal_created: 'Deal Created',
    note: 'Note',
    bounce: 'Bounce',
    unsubscribe: 'Unsubscribed',
  }
  return labels[type] ?? type
}
