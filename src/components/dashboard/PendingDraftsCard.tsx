import { Link } from 'react-router-dom'
import { Mail, ArrowRight } from 'lucide-react'
import { useDraftQueueCount } from '@/lib/queries/drafts'

/**
 * PendingDraftsCard — the loud "approve to start sending" nudge.
 * Nothing leaves LeadFlow until Jordan approves a draft (settled decision:
 * no auto-send), so a stocked queue with zero approvals IS the bottleneck.
 * Renders nothing when the queue is empty.
 */
export function PendingDraftsCard() {
  const { data } = useDraftQueueCount()
  const total = data?.total ?? 0
  if (total === 0) return null

  return (
    <Link
      to="/drafts"
      data-testid="pending-drafts-card"
      className="flex items-center gap-3 rounded-[var(--jordan-radius-md)] border-2 border-[color:var(--jordan-accent)]/50 bg-[color:var(--jordan-accent-soft)] px-4 py-3 transition-colors hover:border-[color:var(--jordan-accent)]"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[color:var(--jordan-accent)]/15">
        <Mail className="w-4.5 h-4.5 text-[color:var(--jordan-accent-hover)]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-semibold text-ink">
          {total} draft{total === 1 ? '' : 's'} waiting for your approval
        </span>
        <span className="block text-[12px] text-ink-muted">
          Nothing sends until you approve — each approved email goes out within minutes.
          {data?.needsDiary ? ` ${data.needsDiary} need your diary first.` : ''}
        </span>
      </span>
      <ArrowRight className="w-4 h-4 shrink-0 text-[color:var(--jordan-accent-hover)]" />
    </Link>
  )
}
