import { BrandChip, MetricNumber, ScoreBadge } from '@/components/primitives'
import { cn } from '@/lib/utils'
import type { Deal } from '@/lib/queries/deals'
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
  const stale = days >= 14
  const recentlyReopened = Boolean(deal.contact?.signal_reopening)
  const daysQuiet = deal.days_since_last_activity ?? 0
  const lastTouchedIso = deal.last_activity_at ?? deal.updated_at ?? null
  const acv = deal.acv != null ? Number(deal.acv) : null
  const tcv = deal.tcv != null ? Number(deal.tcv) : null
  const commission = deal.commission_amount != null ? Number(deal.commission_amount) : null
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

  // Aging visibility — closed/won/lost/snoozed/held deals don't show aging.
  // Held-for-next-month is also irrelevant to aging.
  const showAging =
    !isWon && !isLost && !isSnoozed && !isHeld && !isClosedStage
  const agingTone: 'severe' | 'warn' | 'whisper' | 'none' = !showAging
    ? 'none'
    : daysQuiet >= 30
      ? 'severe'
      : daysQuiet >= 14
        ? 'warn'
        : daysQuiet >= 8
          ? 'whisper'
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
          'group select-none cursor-pointer rounded-[6px] border bg-surface-1',
          'px-3 py-2 transition-all duration-150',
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
          <div className="flex items-center gap-1 flex-wrap">
            {isWon && wonAwaitingInstall && (
              <span
                className="inline-flex items-center gap-1 rounded-[3px] bg-[color:var(--jordan-warm-soft,transparent)] border border-[color:var(--jordan-warm)]/40 text-[color:var(--jordan-warm-text)] px-1.5 py-[1px] text-[10px] font-semibold uppercase tracking-[var(--jordan-tracking-label)]"
                title={
                  deal.closed_at
                    ? `Won ${new Date(deal.closed_at).toLocaleDateString('en-AU')} · awaiting install`
                    : 'Won · awaiting install'
                }
              >
                <span aria-hidden>⏳</span> Awaiting install
              </span>
            )}
            {isWon && !wonAwaitingInstall && (
              <span
                className="inline-flex items-center gap-1 rounded-[3px] bg-[color:var(--jordan-accent-mint-soft)] text-[color:var(--jordan-success-text)] px-1.5 py-[1px] text-[10px] font-semibold uppercase tracking-[var(--jordan-tracking-label)]"
                title={
                  deal.install_completed_at
                    ? `Won · installed ${new Date(deal.install_completed_at).toLocaleDateString('en-AU')}`
                    : 'Won'
                }
              >
                <span aria-hidden>✓</span> Won
              </span>
            )}
            {isLost && (
              <span
                className="inline-flex items-center rounded-[3px] bg-surface-3 text-ink-faint px-1.5 py-[1px] text-[10px] font-semibold uppercase tracking-[var(--jordan-tracking-label)]"
                title={deal.lost_reason ?? 'Lost'}
              >
                Lost
              </span>
            )}
            {needsOutcomeTag && (
              <span
                className="inline-flex items-center gap-1 rounded-[3px] bg-[color:var(--jordan-warm-soft,transparent)] border border-[color:var(--jordan-warm)]/40 text-[color:var(--jordan-warm-text)] px-1.5 py-[1px] text-[10px] font-semibold uppercase tracking-[var(--jordan-tracking-label)]"
                title="Open the deal drawer to mark as Won or Lost"
              >
                <span className="size-1.5 rounded-full bg-[color:var(--jordan-warm)]" aria-hidden />
                Mark outcome
              </span>
            )}
            {recentlyReopened && (
              <span
                className="inline-flex items-center rounded-[3px] bg-[color:var(--jordan-accent-mint-soft)] text-[color:var(--jordan-success-text)] px-1.5 py-[1px] text-[10px] font-semibold uppercase tracking-[var(--jordan-tracking-label)]"
                title="Venue recently reopened"
              >
                Recently reopened
              </span>
            )}
            {recentlyReturned && (
              <span
                className="inline-flex items-center rounded-[3px] bg-[color:var(--jordan-warm-soft,transparent)] border border-[color:var(--jordan-warm)]/40 text-[color:var(--jordan-warm-text)] px-1.5 py-[1px] text-[10px] font-semibold uppercase tracking-[var(--jordan-tracking-label)]"
                title={
                  snoozedUntilDate
                    ? `Auto-woke ${snoozedUntilDate.toLocaleDateString('en-AU')}`
                    : 'Returned from snooze'
                }
              >
                Returned from snooze
              </span>
            )}
            {isSnoozed && snoozedUntilDate && (
              <span
                className="inline-flex items-center gap-1 rounded-[3px] bg-surface-3 text-ink-faint px-1.5 py-[1px] text-[10px] font-semibold uppercase tracking-[var(--jordan-tracking-label)]"
                title={`Snoozed until ${snoozedUntilDate.toLocaleDateString('en-AU')}`}
              >
                <span aria-hidden>z</span>
                {format(snoozedUntilDate, 'd MMM')}
              </span>
            )}
            {isHeld && (
              <span
                className="inline-flex items-center rounded-[3px] bg-[color:var(--jordan-accent-mint-soft)] text-[color:var(--jordan-success-text)] px-1.5 py-[1px] text-[10px] font-semibold uppercase tracking-[var(--jordan-tracking-label)]"
                title="Held for next month — does not count toward this month's gate"
              >
                Held for {format(addMonths(new Date(), 1), 'MMM')}
              </span>
            )}
            {/* Next-step due pill */}
            {nextStepKind === 'overdue' && (
              <span
                className="inline-flex items-center gap-1 rounded-[3px] bg-[color:var(--jordan-warm-soft,transparent)] border border-[color:var(--jordan-warm)]/40 text-[color:var(--jordan-warm-text)] px-1.5 py-[1px] text-[10px] font-semibold uppercase tracking-[var(--jordan-tracking-label)]"
                title={`Next step was due ${nextStepDue ? nextStepDue.toLocaleDateString('en-AU') : ''}`}
              >
                <span aria-hidden>⏰</span> {nextStepLabel}
              </span>
            )}
            {nextStepKind === 'today' && (
              <span
                className="inline-flex items-center gap-1 rounded-[3px] bg-[color:var(--jordan-accent-mint-soft)] text-[color:var(--jordan-success-text)] px-1.5 py-[1px] text-[10px] font-semibold uppercase tracking-[var(--jordan-tracking-label)]"
                title="Next step due today"
              >
                <span aria-hidden>📌</span> {nextStepLabel}
              </span>
            )}
            {nextStepKind === 'soon' && (
              <span
                className="inline-flex items-center gap-1 rounded-[3px] bg-[color:var(--jordan-accent-mint-soft)] text-[color:var(--jordan-success-text)] px-1.5 py-[1px] text-[10px] font-semibold uppercase tracking-[var(--jordan-tracking-label)]"
                title={`Next step due ${nextStepDue ? nextStepDue.toLocaleDateString('en-AU') : ''}`}
              >
                <span aria-hidden>📌</span> {nextStepLabel}
              </span>
            )}
            {nextStepKind === 'future' && (
              <span
                className="inline-flex items-center gap-1 rounded-[3px] bg-surface-3 text-ink-muted px-1.5 py-[1px] text-[10px] font-semibold uppercase tracking-[var(--jordan-tracking-label)]"
                title={`Next step due ${nextStepDue ? nextStepDue.toLocaleDateString('en-AU') : ''}`}
              >
                <span aria-hidden>📌</span> {nextStepLabel}
              </span>
            )}
            {/* Aging pill — only shown when deal is open and quiet for ≥14 days */}
            {agingTone === 'warn' && (
              <span
                className="inline-flex items-center gap-1 rounded-[3px] bg-[color:var(--jordan-warm-soft,transparent)] border border-[color:var(--jordan-warm)]/40 text-[color:var(--jordan-warm-text)] px-1.5 py-[1px] text-[10px] font-semibold uppercase tracking-[var(--jordan-tracking-label)]"
                title={
                  lastTouchedIso
                    ? `Last touched: ${new Date(lastTouchedIso).toLocaleDateString('en-AU')} (${daysQuiet} days ago)`
                    : `Quiet for ${daysQuiet} days`
                }
              >
                <span aria-hidden>🕐</span> {daysQuiet}d quiet
              </span>
            )}
            {agingTone === 'severe' && (
              <span
                className="inline-flex items-center gap-1 rounded-[3px] bg-[color:var(--jordan-danger-soft)] border border-[color:var(--jordan-danger)]/40 text-[color:var(--jordan-danger-text)] px-1.5 py-[1px] text-[10px] font-semibold uppercase tracking-[var(--jordan-tracking-label)]"
                title={
                  lastTouchedIso
                    ? `Last touched: ${new Date(lastTouchedIso).toLocaleDateString('en-AU')} (${daysQuiet} days ago)`
                    : `Quiet for ${daysQuiet} days`
                }
              >
                <span aria-hidden>🚨</span> 30d+ quiet
              </span>
            )}
            {agingTone === 'whisper' && (
              <span
                className="inline-flex size-1.5 rounded-full bg-ink-faint shrink-0"
                title={
                  lastTouchedIso
                    ? `Last touched: ${new Date(lastTouchedIso).toLocaleDateString('en-AU')} (${daysQuiet} days ago)`
                    : `Quiet for ${daysQuiet} days`
                }
                aria-label={`Quiet for ${daysQuiet} days`}
              />
            )}
          </div>
          {deal.product?.label ? (
            <div className="flex items-start gap-1.5 min-w-0">
              <BrandChip brand={deal.product.brand} className="mt-px shrink-0" />
              <p
                className={cn(
                  'text-[13px] leading-[18px] font-medium text-ink line-clamp-2 min-w-0',
                  isLost && 'line-through text-ink-muted',
                )}
                title={deal.title ?? deal.product.label}
              >
                {deal.product.label}
              </p>
            </div>
          ) : (
            <p
              className={cn(
                'text-[13px] leading-[18px] font-medium text-ink line-clamp-2',
                isLost && 'line-through text-ink-muted',
              )}
            >
              {deal.title ?? 'Untitled deal'}
            </p>
          )}

          {nextStepNote && (
            <p
              className="truncate italic text-[11px] text-ink-muted"
              title={nextStepNote}
            >
              {nextStepNote.length > 50 ? `${nextStepNote.slice(0, 50)}…` : nextStepNote}
            </p>
          )}

          {(deal.contact?.full_name || deal.venue?.name) && (
            <p className="truncate text-[11px] text-ink-faint">
              {deal.venue?.name ?? deal.contact?.full_name}
            </p>
          )}

          <div className="flex items-center justify-between gap-1 pt-0.5">
            <div className="flex items-center gap-1.5 min-w-0">
              {contributesToGate && (
                <span
                  className="size-1.5 rounded-full bg-[color:var(--jordan-accent-mint)] shrink-0"
                  title="Counts toward this month's gate"
                  aria-label="Counts toward this month's gate"
                />
              )}
              <MetricNumber
                value={headline}
                format="currency"
                className="text-[13px] font-semibold text-ink"
              />
            </div>
            <div className="flex items-center gap-1.5">
              {deal.lead_score?.score != null && <ScoreBadge score={deal.lead_score.score} />}
              <span
                className={cn(
                  'jordan-tnum text-[11px]',
                  stale ? 'text-warm' : 'text-ink-faint',
                )}
                title={`${days} days in stage`}
              >
                {days}d
              </span>
            </div>
          </div>
          {(tcv != null || commission != null) && (
            <p className="text-[10px] text-ink-faint jordan-tnum truncate">
              {tcv != null && (
                <>
                  TCV ${tcv.toLocaleString('en-AU', { maximumFractionDigits: 0 })}
                </>
              )}
              {tcv != null && commission != null && <> · </>}
              {commission != null && (
                <>
                  Comm ${commission.toLocaleString('en-AU', { maximumFractionDigits: 0 })}
                </>
              )}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
