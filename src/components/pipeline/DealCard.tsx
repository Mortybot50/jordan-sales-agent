import { BrandChip, MetricNumber, ScoreBadge, TemperatureChip, getActivityMeta } from '@/components/primitives'
import { GroupChip } from '@/components/venue-groups/GroupChip'
import { cn } from '@/lib/utils'
import type { Deal } from '@/lib/queries/deals'
import { useVenueGroupBadges } from '@/lib/queries/venue-groups'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { format, addMonths } from 'date-fns'

interface DealCardProps {
  deal: Deal
  onClick: () => void
}

function isCurrentMonth(iso: string | null): boolean {
  if (!iso) return false
  const d = new Date(iso)
  const now = new Date()
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
}

/** "today" / "3d ago" / "11 Mar" (>90d) — compact relative date for cards. */
export function relDays(iso: string | null | undefined): string | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return null
  const days = Math.floor((Date.now() - t) / 864e5)
  if (days <= 0) return 'today'
  if (days === 1) return '1d ago'
  if (days <= 90) return `${days}d ago`
  return format(new Date(iso), 'd MMM')
}

const EMAILISH = /\S+@\S+/

/**
 * Card title = BUSINESS NAME. Venue name wins; a non-email deal title is
 * trusted (the PST re-triage already rewrote those to business names); a raw
 * email NEVER shows — fall through to the contact's name.
 */
export function dealDisplayName(deal: Deal): string {
  if (deal.venue?.name) return deal.venue.name
  if (deal.title && !EMAILISH.test(deal.title)) return deal.title
  if (deal.contact?.full_name && !EMAILISH.test(deal.contact.full_name)) {
    return deal.contact.full_name
  }
  const email = deal.contact?.email
  if (email && email.includes('@')) return email.split('@')[1]
  return deal.title ?? 'Untitled deal'
}

/**
 * One-line notes summary. PST import blocks are machine notes — surface their
 * Action/Trigger line instead of the tag header. Otherwise: first real line.
 */
export function notesSummary(notes: string | null | undefined): string | null {
  if (!notes) return null
  if (notes.includes('[purezza-pst-promote]')) {
    // [ \t]* not \s* — an empty "Trigger:" line must NOT swallow the newline
    // and surface the next line as a bogus summary.
    const action = /Action:[ \t]*([^\n]+)/.exec(notes)?.[1]?.trim()
    if (action) return action
    const trigger = /Trigger:[ \t]*([^\n]+)/.exec(notes)?.[1]?.trim()
    return trigger || null
  }
  const line = notes.split('\n').map((l) => l.trim()).find((l) => l.length > 0 && !l.startsWith('['))
  return line ?? null
}

export function DealCard({ deal, onClick }: DealCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: deal.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  const days = deal.days_in_stage ?? 0
  const recentlyReopened = Boolean(deal.contact?.signal_reopening)
  const daysQuiet = deal.days_since_last_activity ?? 0
  const acv = deal.acv != null ? Number(deal.acv) : null
  const finalValue = deal.final_value != null ? Number(deal.final_value) : null
  const headline = finalValue ?? acv ?? deal.contract_value
  const stageName = deal.stage?.name ?? ''
  const isHeld = stageName === 'Hold for Next Month'
  const contributesToGate = !isHeld && isCurrentMonth(deal.close_won_at)
  const isClosedStage = !!deal.stage?.is_closed
  const isWon = deal.outcome === 'won'
  const isLost = deal.outcome === 'lost'
  const needsOutcomeTag = isClosedStage && !deal.outcome
  const wonAwaitingInstall = isWon && !deal.install_completed_at
  const isSnoozed = !!deal.is_snoozed
  const recentlyReturned = !!deal.recently_returned
  const snoozedUntilDate = deal.snoozed_until ? new Date(deal.snoozed_until) : null

  const showAging = !isWon && !isLost && !isSnoozed && !isHeld && !isClosedStage
  const agingTone: 'severe' | 'warn' | 'none' = !showAging
    ? 'none'
    : daysQuiet >= 30
      ? 'severe'
      : daysQuiet >= 14
        ? 'warn'
        : 'none'

  // Next-step pill computation.
  const nextStepDueIso = deal.next_step_due_at ?? null
  const nextStepDue = nextStepDueIso ? new Date(nextStepDueIso) : null
  const nextStepNote = deal.next_step_note ?? null
  const startOfToday = (() => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d
  })()
  const startOfTomorrow = new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000)
  const threeDaysOut = new Date(startOfToday.getTime() + 4 * 24 * 60 * 60 * 1000)
  let nextStepKind: 'overdue' | 'today' | 'soon' | 'future' | null = null
  let nextStepLabel = ''
  if (nextStepDue) {
    if (nextStepDue.getTime() < startOfToday.getTime()) {
      nextStepKind = 'overdue'
      nextStepLabel = 'OVERDUE'
    } else if (nextStepDue.getTime() < startOfTomorrow.getTime()) {
      nextStepKind = 'today'
      nextStepLabel = 'TODAY'
    } else if (nextStepDue.getTime() < threeDaysOut.getTime()) {
      nextStepKind = 'soon'
      nextStepLabel = format(nextStepDue, 'EEE')
    } else {
      nextStepKind = 'future'
      nextStepLabel = format(nextStepDue, 'd MMM')
    }
  }

  const displayName = dealDisplayName(deal)
  const noteLine = notesSummary(deal.notes)
  const lastContact = relDays(deal.last_contact_at)
  const lastAction = deal.last_action
  const lastActionLabel = lastAction ? getActivityMeta(lastAction.type).label : null
  const enr = deal.enrollment
  const enrolledActive = !!enr && (enr.status === 'active' || enr.status === 'paused')
  // PST-imported deals came FROM a mailbox thread — outreach happened even
  // when the import couldn't recover a last-contact date.
  const isPstImport = !!deal.notes?.includes('[purezza-pst-promote]')
  const neverContacted =
    !deal.last_contact_at && !enrolledActive && !deal.has_replied && !isPstImport

  const pillBase =
    'inline-flex items-center gap-1 rounded-[4px] px-1.5 py-[2px] text-[10px] font-semibold uppercase tracking-[var(--jordan-tracking-label)]'

  // ── Pill triage ──────────────────────────────────────────────
  // Build the full set of applicable state pills in PRIORITY ORDER,
  // then the chip row renders only the top 2. Calmer cards, no lost
  // signal: every demoted pill remains visible in the DealDrawer.
  type PriorityPill = {
    key: string
    label: string
    title?: string
    icon?: string
    className: string
  }
  const warmPill =
    'bg-[color:var(--jordan-warm-soft,transparent)] border border-[color:var(--jordan-warm)]/40 text-[color:var(--jordan-warm-text)]'
  const mintPill = 'bg-[color:var(--jordan-accent-mint-soft)] text-[color:var(--jordan-success-text)]'
  const dangerPill =
    'bg-[color:var(--jordan-danger-soft)] border border-[color:var(--jordan-danger)]/40 text-[color:var(--jordan-danger-text)]'
  const subtlePill = 'bg-surface-3 text-ink-faint'
  const priorityPills: PriorityPill[] = []
  // 1. Outcome state (won / lost / needs-outcome)
  if (isWon && wonAwaitingInstall) {
    priorityPills.push({
      key: 'awaiting-install',
      label: 'Awaiting install',
      icon: '⏳',
      className: warmPill,
      title: deal.closed_at ? `Won ${new Date(deal.closed_at).toLocaleDateString('en-AU')} · awaiting install` : 'Won · awaiting install',
    })
  } else if (isWon) {
    priorityPills.push({
      key: 'won',
      label: 'Won',
      icon: '✓',
      className: mintPill,
      title: deal.install_completed_at ? `Won · installed ${new Date(deal.install_completed_at).toLocaleDateString('en-AU')}` : 'Won',
    })
  } else if (isLost) {
    priorityPills.push({ key: 'lost', label: 'Lost', className: subtlePill, title: deal.lost_reason ?? 'Lost' })
  } else if (needsOutcomeTag) {
    priorityPills.push({ key: 'mark-outcome', label: 'Mark outcome', icon: '●', className: warmPill, title: 'Open the deal drawer to mark as Won or Lost' })
  }
  // 2. Next-step urgency (overdue / today / soon)
  if (nextStepKind === 'overdue') {
    priorityPills.push({ key: 'next-overdue', label: nextStepLabel, icon: '⏰', className: dangerPill, title: `Next step was due ${nextStepDue ? nextStepDue.toLocaleDateString('en-AU') : ''}` })
  } else if (nextStepKind === 'today' || nextStepKind === 'soon') {
    priorityPills.push({ key: 'next-soon', label: nextStepLabel, icon: '📌', className: mintPill, title: `Next step due ${nextStepDue ? nextStepDue.toLocaleDateString('en-AU') : ''}` })
  }
  // 3. Severe aging
  if (agingTone === 'severe') {
    priorityPills.push({ key: 'aging-severe', label: `${daysQuiet}d quiet`, icon: '🚨', className: dangerPill, title: `Quiet for ${daysQuiet} days` })
  }
  // 4. Lifecycle context (snooze / held / reopened / back-from-snooze)
  if (isHeld) {
    priorityPills.push({ key: 'held', label: `Held for ${format(addMonths(new Date(), 1), 'MMM')}`, className: mintPill, title: "Held for next month — does not count toward this month's gate" })
  }
  if (recentlyReturned) {
    priorityPills.push({ key: 'back-from-snooze', label: 'Back from snooze', className: warmPill, title: snoozedUntilDate ? `Auto-woke ${snoozedUntilDate.toLocaleDateString('en-AU')}` : 'Returned from snooze' })
  } else if (isSnoozed && snoozedUntilDate) {
    priorityPills.push({ key: 'snoozed', label: format(snoozedUntilDate, 'd MMM'), icon: 'z', className: subtlePill, title: `Snoozed until ${snoozedUntilDate.toLocaleDateString('en-AU')}` })
  }
  if (recentlyReopened) {
    priorityPills.push({ key: 'reopened', label: 'Reopened', className: mintPill, title: 'Venue recently reopened' })
  }
  // 5. Future next-step + warn aging (lowest priority — usually demoted)
  if (nextStepKind === 'future') {
    priorityPills.push({ key: 'next-future', label: nextStepLabel, icon: '📌', className: 'bg-surface-3 text-ink-muted', title: `Next step due ${nextStepDue ? nextStepDue.toLocaleDateString('en-AU') : ''}` })
  }
  if (agingTone === 'warn') {
    priorityPills.push({ key: 'aging-warn', label: `${daysQuiet}d quiet`, icon: '🕐', className: warmPill, title: `Quiet for ${daysQuiet} days` })
  }

  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      <div
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onClick()
          }
        }}
        className={cn(
          'group select-none cursor-pointer rounded-[10px] border bg-surface-1',
          'px-3.5 py-3 transition-all duration-150',
          'hover:shadow-[var(--jordan-shadow-hover)]',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40',
          isWon
            ? 'border-[color:var(--jordan-accent-mint)]/50 hover:border-[color:var(--jordan-accent-mint)]'
            : isLost
              ? 'border-hairline opacity-70 hover:border-[color:var(--jordan-danger)]/40'
              : needsOutcomeTag
                ? 'border-[color:var(--jordan-warm)]/60 hover:border-[color:var(--jordan-warm)]'
                : 'border-hairline hover:border-brand',
        )}
        {...listeners}
      >
        <div className="space-y-1.5">
          {/* Chip row — Notion-calm: temperature anchor + at most TWO
           * triaged state pills (highest priority only). Every other
           * signal stays available in the DealDrawer; nothing is lost
           * from the model — this is visual triage, not deletion.
           * Priority: outcome/needs-outcome > overdue/due next-step >
           * severe aging > snooze/held/reopened > warn aging. */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <TemperatureChip
              temperature={deal.temperature}
              source={deal.temperature_source}
              className="h-[18px] text-[10px]"
            />
            {priorityPills.slice(0, 2).map((pill) => (
              <span key={pill.key} className={cn(pillBase, pill.className)} title={pill.title}>
                {pill.icon && <span aria-hidden>{pill.icon}</span>}
                {pill.label}
              </span>
            ))}
          </div>

          {/* BUSINESS NAME — the title. Product rides along as a chip. */}
          <div className="flex items-start gap-1.5 min-w-0">
            {deal.product?.brand && <BrandChip brand={deal.product.brand} className="mt-px shrink-0" />}
            <p
              className={cn(
                'text-[14px] leading-[20px] font-semibold text-ink truncate min-w-0',
                isLost && 'line-through text-ink-muted',
              )}
              title={deal.title ?? displayName}
            >
              {displayName}
            </p>
            {deal.venue?.id && <DealCardGroupChip venueId={deal.venue.id} />}
          </div>

          {/* Last contact · last action */}
          <p className="truncate text-[11px] text-ink-muted jordan-tnum">
            {lastContact ? (
              <>
                <span className="text-ink-faint">Last contact</span> {lastContact}
              </>
            ) : (
              <span className="text-ink-faint">
                {isPstImport ? 'Last contact unknown' : 'Never contacted'}
              </span>
            )}
            {lastActionLabel && lastAction && (
              <>
                <span className="text-ink-faint"> · </span>
                {lastActionLabel} {relDays(lastAction.at)}
              </>
            )}
          </p>

          {/* Outreach status: sequence chip / replied / nothing yet */}
          <div className="flex items-center gap-1 flex-wrap">
            {enrolledActive && enr && (
              <span
                className={cn(pillBase, 'bg-[color:var(--jordan-accent-soft)] text-[color:var(--jordan-accent-hover)] normal-case tracking-normal font-medium')}
                title={`${enr.sequence_name} — step ${enr.current_step}/${enr.total_steps}${enr.status === 'paused' ? ' (paused)' : ''}`}
              >
                <span aria-hidden>➤</span> {enr.sequence_name} · {enr.current_step}/{enr.total_steps}
                {enr.status === 'paused' && ' ⏸'}
              </span>
            )}
            {deal.has_replied && (
              <span className={cn(pillBase, 'bg-[color:var(--jordan-accent-mint-soft)] text-[color:var(--jordan-success-text)]')}>
                ↩ Replied
              </span>
            )}
            {neverContacted && (
              <span className={cn(pillBase, 'bg-surface-3 text-ink-faint')}>No outreach yet</span>
            )}
            {noteLine && (
              <span className="truncate italic text-[11px] text-ink-muted min-w-0 flex-1" title={noteLine}>
                {noteLine.length > 60 ? `${noteLine.slice(0, 60)}…` : noteLine}
              </span>
            )}
          </div>

          {nextStepNote && (
            <p className="truncate italic text-[11px] text-ink-muted" title={nextStepNote}>
              → {nextStepNote.length > 56 ? `${nextStepNote.slice(0, 56)}…` : nextStepNote}
            </p>
          )}

          {/* Bottom row: value (only when present) · score · days in stage */}
          <div className="flex items-center justify-between gap-1 pt-1 mt-0.5 border-t border-hairline/60">
            <div className="flex items-center gap-1.5 min-w-0">
              {contributesToGate && (
                <span
                  className="size-1.5 rounded-full bg-[color:var(--jordan-accent-mint)] shrink-0"
                  title="Counts toward this month's gate"
                  aria-label="Counts toward this month's gate"
                />
              )}
              {headline != null && Number(headline) > 0 ? (
                <MetricNumber
                  value={headline}
                  format="currency"
                  className="text-[13px] font-semibold text-ink"
                />
              ) : (
                <span className="text-[11px] text-ink-faint">No value set</span>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              {deal.lead_score?.score != null && <ScoreBadge score={deal.lead_score.score} />}
              <span
                className={cn('jordan-tnum text-[11px]', days >= 14 ? 'text-warm' : 'text-ink-faint')}
                title={`${days} days in stage`}
              >
                {days}d
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * Tiny lookup wrapper — shares the cached useVenueGroupBadges query across
 * every DealCard so we make one round-trip per pipeline render, not N.
 */
function DealCardGroupChip({ venueId }: { venueId: string }) {
  const { data } = useVenueGroupBadges()
  const badge = data?.[venueId]
  if (!badge) return null
  return <GroupChip name={badge.group_name} compact />
}
