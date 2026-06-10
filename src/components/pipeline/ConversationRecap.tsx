import { CapsLabel } from '@/components/primitives'
import { formatDistanceToNowStrict, parseISO, isValid } from 'date-fns'
import { Mail, AlertTriangle, Clock } from 'lucide-react'
import type { ThreadExcerpt } from '@/lib/leadScoring'

interface ConversationRecapProps {
  excerpt: ThreadExcerpt | null | undefined
}

/**
 * Top-of-drawer panel showing the most recent message context for a deal —
 * subject, body excerpt, message counts, last-contact age, and a status line
 * that flags "they reached out N times, no reply" when inbound > outbound.
 *
 * Placeholder ("No conversation history yet") renders when excerpt is null —
 * typically a manually created deal or one whose contact email didn't appear
 * in the PST import.
 */
export function ConversationRecap({ excerpt }: ConversationRecapProps) {
  if (!excerpt) {
    return (
      <div className="mb-4 rounded-[10px] border border-dashed border-hairline bg-surface-2/50 p-3">
        <CapsLabel>Conversation recap</CapsLabel>
        <p className="text-[12px] text-ink-faint mt-1">
          No conversation history yet — open a thread or send the first email
          to populate this panel.
        </p>
      </div>
    )
  }

  const subject = excerpt.subject?.trim() || '(no subject)'
  const lastFrom = excerpt.last_from?.trim() ?? null
  const lastBody = excerpt.last_body?.trim() ?? ''
  const lastDate = excerpt.last_date ?? null
  const inbound = excerpt.msg_count_inbound ?? 0
  const outbound = excerpt.msg_count_outbound ?? 0

  let lastDateLabel: string | null = null
  if (lastDate) {
    const parsed = parseISO(lastDate)
    if (isValid(parsed)) {
      lastDateLabel = formatDistanceToNowStrict(parsed, { addSuffix: true })
    }
  }

  const inboundExceedsOutbound = inbound > outbound && inbound > 0
  const noOutbound = outbound === 0 && inbound > 0

  let statusNode: React.ReactNode = null
  if (noOutbound) {
    statusNode = (
      <div className="flex items-start gap-1.5 rounded-[6px] border border-[color:var(--jordan-warm)]/40 bg-[color:var(--jordan-warm-soft,transparent)] px-2 py-1.5 text-[11px] text-[color:var(--jordan-warm-text)]">
        <AlertTriangle className="w-3.5 h-3.5 mt-px shrink-0" />
        <span>
          Urgent — they reached out {inbound === 1 ? 'once' : `${inbound} times`}, no reply.
        </span>
      </div>
    )
  } else if (inboundExceedsOutbound) {
    statusNode = (
      <div className="flex items-start gap-1.5 rounded-[6px] border border-hairline bg-surface-3 px-2 py-1.5 text-[11px] text-ink-muted">
        <Clock className="w-3.5 h-3.5 mt-px shrink-0" />
        <span>
          Reply pending — they're {inbound - outbound} message
          {inbound - outbound === 1 ? '' : 's'} ahead.
        </span>
      </div>
    )
  }

  return (
    <div className="mb-4 rounded-[10px] border border-hairline bg-surface-2 p-3 space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <CapsLabel>Conversation recap</CapsLabel>
        {lastDateLabel && (
          <span className="text-[11px] text-ink-faint">{lastDateLabel}</span>
        )}
      </div>

      <p
        className="text-[13px] font-medium text-ink truncate"
        title={subject}
      >
        {subject}
      </p>

      {lastFrom && (
        <p className="text-[11px] text-ink-faint flex items-center gap-1">
          <Mail className="w-3 h-3 shrink-0" />
          <span className="truncate">From {lastFrom}</span>
        </p>
      )}

      {lastBody && (
        <p className="text-[12px] text-ink-muted leading-snug whitespace-pre-line">
          {lastBody.length > 280 ? `${lastBody.slice(0, 280)}…` : lastBody}
        </p>
      )}

      <p className="text-[11px] text-ink-faint">
        Thread: {inbound} from them · {outbound} from you
      </p>

      {statusNode}
    </div>
  )
}
