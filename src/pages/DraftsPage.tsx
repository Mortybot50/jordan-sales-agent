import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Mail } from 'lucide-react'
import {
  EmptyState,
  KbdHint,
  PageHeader,
  SkeletonCard,
} from '@/components/primitives'
import { useInboundActivityIntents } from '@/lib/queries/activities'
import { DraftQueueRow } from '@/components/drafts/DraftQueueRow'
import { DraftPreviewPane } from '@/components/drafts/DraftPreviewPane'
import { LearningBanner } from '@/components/drafts/LearningBanner'
import {
  hasUnresolvedPlaceholder,
  TIMES_PLACEHOLDER,
  useApproveDraft,
  useDrafts,
  useDraftQueueCount,
} from '@/lib/queries/drafts'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

/**
 * Drafts Queue — keyboard-first review pane.
 *
 * Left pane: compact queue rows (non-skipped first, skipped at end).
 * Right pane: PageHeader + preview + action bar for the active draft.
 *
 * Keyboard:
 *   J / ↓       next
 *   K / ↑       prev
 *   A           approve (with 150ms fade+slide-out row transition)
 *   R           reject (confirm dialog)
 *   E           edit inline (Sheet, not stacked Dialog)
 *   S           skip
 *   Esc         close edit sheet / reject dialog (native)
 */
export function DraftsPage() {
  const { data: drafts, isLoading } = useDrafts()
  // Single source of truth for the "X pending" headline — same hook the
  // sidebar badge reads from, so the two numbers can't drift apart even
  // when local filters (skipped / intent / diary chip) shrink the visible
  // queue.
  const { data: queueCount } = useDraftQueueCount()
  const approveDraft = useApproveDraft()

  const [searchParams, setSearchParams] = useSearchParams()
  const skippedIds = useMemo<Set<string>>(() => {
    const raw = searchParams.get('skipped') ?? ''
    return new Set(raw.split(',').filter(Boolean))
  }, [searchParams])

  const persistSkipped = useCallback(
    (next: Set<string>) => {
      const arr = Array.from(next)
      setSearchParams(
        (prev) => {
          const p = new URLSearchParams(prev)
          if (arr.length === 0) p.delete('skipped')
          else p.set('skipped', arr.join(','))
          return p
        },
        { replace: true },
      )
    },
    [setSearchParams],
  )

  const [activeIndexRaw, setActiveIndex] = useState(0)
  const [removingIds, setRemovingIds] = useState<Set<string>>(new Set())
  const [editOpen, setEditOpen] = useState(false)
  const [rejectOpen, setRejectOpen] = useState(false)
  const [editSignal, setEditSignal] = useState(0)
  const [rejectSignal, setRejectSignal] = useState(0)

  // Filter chip — when on, queue collapses to proposed-meeting drafts only.
  const onlyDiary = searchParams.get('diary') === '1'
  const setOnlyDiary = useCallback(
    (next: boolean) => {
      setSearchParams(
        (prev) => {
          const p = new URLSearchParams(prev)
          if (next) p.set('diary', '1')
          else p.delete('diary')
          return p
        },
        { replace: true },
      )
    },
    [setSearchParams],
  )

  // Intent filter chip — "all" | "positive" | "objection" | "other"
  type IntentFilter = 'all' | 'positive' | 'objection' | 'other'
  const intentFilter = (searchParams.get('intent') ?? 'all') as IntentFilter
  const setIntentFilter = useCallback(
    (next: IntentFilter) => {
      setSearchParams(
        (prev) => {
          const p = new URLSearchParams(prev)
          if (next === 'all') p.delete('intent')
          else p.set('intent', next)
          return p
        },
        { replace: true },
      )
    },
    [setSearchParams],
  )

  // Draft-type filter chip — "all" | "cold_outreach" | "follow_up" | "reply".
  // The "follow_up" bucket matches all three sequence-stage variants
  // (follow_up, follow_up_soft, follow_up_close) so Jordan sees the whole
  // follow-up funnel in one filter rather than three.
  type TypeFilter = 'all' | 'cold_outreach' | 'follow_up' | 'reply'
  const typeFilter = (searchParams.get('type') ?? 'all') as TypeFilter
  const setTypeFilter = useCallback(
    (next: TypeFilter) => {
      setSearchParams(
        (prev) => {
          const p = new URLSearchParams(prev)
          if (next === 'all') p.delete('type')
          else p.set('type', next)
          return p
        },
        { replace: true },
      )
    },
    [setSearchParams],
  )

  // Collect contact IDs from visible drafts to fetch their intent map
  const allContactIds = useMemo(
    () => [...new Set((drafts ?? []).map((d) => d.contact_id).filter(Boolean))] as string[],
    [drafts],
  )
  const { data: intentMap = {} } = useInboundActivityIntents(allContactIds)

  // Queue ordering:
  //  1. Filter to proposed-meeting only when the chip is on.
  //  2. Within each skipped/non-skipped bucket, proposed-meeting drafts
  //     float to the top so Jordan sees diary-needed work first.
  //  3. Skipped drafts always trail at the end.
  const queue = useMemo(() => {
    if (!drafts) return []
    let source = onlyDiary
      ? drafts.filter((d) => d.draft_kind === 'proposed_meeting')
      : drafts

    // Draft-type filter — column-level, not row-level metadata.
    if (typeFilter !== 'all') {
      source = source.filter((d) => {
        if (typeFilter === 'follow_up') return d.draft_type.startsWith('follow_up')
        return d.draft_type === typeFilter
      })
    }

    // Intent filter — match against the contact's most recent inbound intent
    if (intentFilter !== 'all') {
      source = source.filter((d) => {
        const contactIntent = d.contact_id ? intentMap[d.contact_id] : undefined
        if (intentFilter === 'other') {
          // "Other" bucket = no intent classified, or intent is referral/ooo/spam/other
          return !contactIntent || ['referral', 'ooo', 'spam', 'other'].includes(contactIntent)
        }
        return contactIntent === intentFilter
      })
    }

    const sortKey = (d: { draft_kind: string }) =>
      d.draft_kind === 'proposed_meeting' ? 0 : 1
    const nonSkipped = source
      .filter((d) => !skippedIds.has(d.id))
      .sort((a, b) => sortKey(a) - sortKey(b))
    const skipped = source
      .filter((d) => skippedIds.has(d.id))
      .sort((a, b) => sortKey(a) - sortKey(b))
    return [...nonSkipped, ...skipped]
  }, [drafts, skippedIds, onlyDiary, typeFilter, intentFilter, intentMap])

  const diaryCount = useMemo(
    () => (drafts ?? []).filter((d) => d.draft_kind === 'proposed_meeting').length,
    [drafts],
  )

  // Derive a clamped active index so we never point past the end of
  // the queue (happens after approve/reject shrinks the list).
  const activeIndex = queue.length === 0 ? 0 : Math.min(activeIndexRaw, queue.length - 1)
  const active = queue[activeIndex]

  const handleSkip = useCallback(
    (id: string) => {
      const next = new Set(skippedIds)
      next.add(id)
      persistSkipped(next)
      setActiveIndex((i) => Math.min(i + 1, queue.length - 1))
    },
    [skippedIds, persistSkipped, queue.length],
  )

  const handleApproveWithAnim = useCallback(
    async (id: string) => {
      setRemovingIds((prev) => new Set(prev).add(id))
      // Mutation is fire-and-forget w.r.t. the transition — row animates
      // while the query invalidation re-renders a shorter list.
      await approveDraft
        .mutateAsync(id)
        .catch(() => {
          // rollback removing so the row reappears; toast handled by hook
          setRemovingIds((prev) => {
            const next = new Set(prev)
            next.delete(id)
            return next
          })
        })
      // Clean up after the query refreshes
      setTimeout(() => {
        setRemovingIds((prev) => {
          const next = new Set(prev)
          next.delete(id)
          return next
        })
      }, 200)
    },
    [approveDraft],
  )

  // Keyboard handler — disabled when any overlay is open so Esc etc.
  // flow to Radix.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (editOpen || rejectOpen) return
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (e.metaKey || e.ctrlKey || e.altKey) return

      if (!active) return

      const key = e.key.toLowerCase()
      if (key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault()
        setActiveIndex((i) => Math.min(i + 1, queue.length - 1))
      } else if (key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault()
        setActiveIndex((i) => Math.max(i - 1, 0))
      } else if (key === 'n') {
        e.preventDefault()
        setActiveIndex((i) => Math.min(i + 1, queue.length - 1))
      } else if (key === 's') {
        e.preventDefault()
        handleSkip(active.id)
      } else if (key === 'a') {
        e.preventDefault()
        if (hasUnresolvedPlaceholder(active.body)) {
          toast.error(
            `Replace ${TIMES_PLACEHOLDER} with your proposed times before approving.`,
          )
          return
        }
        void handleApproveWithAnim(active.id)
      } else if (key === 'r') {
        e.preventDefault()
        setRejectSignal((v) => v + 1)
      } else if (key === 'e') {
        e.preventDefault()
        setEditSignal((v) => v + 1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, queue.length, handleSkip, handleApproveWithAnim, editOpen, rejectOpen])

  // Scroll active row into view
  const queueRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!queueRef.current || !active) return
    const el = queueRef.current.querySelector<HTMLButtonElement>(
      `[data-draft-id="${active.id}"]`,
    )
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [active])

  // pendingCount = DB-truth (same as sidebar badge). visibleCount = after
  // local filters/skips. Surface both when they differ so Jordan never sees
  // "0 pending" in the header while the badge still shows 6.
  const pendingCount = queueCount?.total ?? (drafts?.length ?? 0)
  const visibleCount = queue.filter((d) => !skippedIds.has(d.id)).length
  const filteredOut = pendingCount - visibleCount

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 px-4 pt-4 sm:px-6 sm:pt-6">
        <PageHeader
          eyebrow="Review queue"
          title="Draft Review"
          description={
            <span className="flex flex-wrap items-center gap-2 text-ink-muted">
              <span className="jordan-tnum">{pendingCount}</span>
              <span>pending</span>
              {filteredOut > 0 && (
                <>
                  <span className="text-ink-faint">·</span>
                  <span className="jordan-tnum">{visibleCount}</span>
                  <span>shown</span>
                </>
              )}
              {skippedIds.size > 0 && (
                <>
                  <span className="text-ink-faint">·</span>
                  <span className="jordan-tnum">{skippedIds.size}</span>
                  <span>skipped</span>
                </>
              )}
            </span>
          }
          actions={
            <div className="hidden flex-wrap items-center gap-2 md:flex">
              <KbdHint label="Approve">A</KbdHint>
              <KbdHint label="Reject">R</KbdHint>
              <KbdHint label="Edit">E</KbdHint>
              <KbdHint label="Skip">S</KbdHint>
              <KbdHint label="Next">J</KbdHint>
              <KbdHint label="Prev">K</KbdHint>
            </div>
          }
        />
      </div>

      {/* Learning Loop banner — renders only when a pending digest exists */}
      <LearningBanner digestIdFromUrl={searchParams.get('learning')} />

      {/* Mobile kbd summary */}
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 px-4 text-[11px] text-ink-faint md:hidden sm:px-6">
        <KbdHint label="Approve">A</KbdHint>
        <KbdHint label="Reject">R</KbdHint>
        <KbdHint label="Edit">E</KbdHint>
        <KbdHint label="Skip">S</KbdHint>
        <KbdHint label="Next">J</KbdHint>
        <KbdHint label="Prev">K</KbdHint>
      </div>

      {/* Draft-type filter chips — column-level filter (replaces the loud
          per-row DraftTypeBadge stack that Jordan flagged on 09/06/2026). */}
      <div className="mt-3 flex flex-wrap items-center gap-2 px-4 sm:px-6">
        {(
          [
            { value: 'all', label: 'All types' },
            { value: 'cold_outreach', label: 'Cold outreach' },
            { value: 'follow_up', label: 'Follow-up' },
            { value: 'reply', label: 'Reply' },
          ] as const
        ).map((chip) => (
          <button
            key={chip.value}
            type="button"
            data-testid={`type-filter-${chip.value}`}
            data-active={typeFilter === chip.value || undefined}
            onClick={() => setTypeFilter(chip.value)}
            className={cn(
              'inline-flex items-center h-7 rounded-full border px-2.5 text-[11px] font-medium uppercase tracking-[var(--jordan-tracking-label)] transition-colors',
              typeFilter === chip.value
                ? 'border-[color:color-mix(in_oklab,var(--jordan-accent)_40%,transparent)] bg-[var(--jordan-accent-soft)] text-[var(--jordan-accent-hover)]'
                : 'border-hairline bg-surface-2 text-ink-muted hover:bg-surface-3 hover:text-ink',
            )}
            aria-pressed={typeFilter === chip.value}
          >
            {chip.label}
          </button>
        ))}
      </div>

      {/* Diary-needed filter chip — only renders when there's at least one
          proposed-meeting draft, so the queue header stays clean otherwise. */}
      {diaryCount > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 px-4 sm:px-6">
          <button
            type="button"
            data-testid="diary-filter-chip"
            data-active={onlyDiary || undefined}
            onClick={() => setOnlyDiary(!onlyDiary)}
            className={cn(
              'inline-flex items-center gap-1.5 h-7 rounded-full border px-2.5 text-[11px] font-medium uppercase tracking-[var(--jordan-tracking-label)] transition-colors',
              onlyDiary
                ? 'border-[color:color-mix(in_oklab,var(--jordan-warm)_40%,transparent)] bg-[var(--jordan-warm-soft)] text-[var(--jordan-warm-text)]'
                : 'border-hairline bg-surface-2 text-ink-muted hover:bg-surface-3 hover:text-ink',
            )}
            aria-pressed={onlyDiary}
          >
            <span aria-hidden>📅</span>
            <span>Diary needed</span>
            <span className="jordan-tnum tabular-nums opacity-80">({diaryCount})</span>
          </button>
        </div>
      )}

      {/* Intent filter chips — All | Positive | Objection | Other */}
      <div className="mt-2 flex flex-wrap items-center gap-2 px-4 sm:px-6">
        {(
          [
            { value: 'all', label: 'All' },
            { value: 'positive', label: 'Positive' },
            { value: 'objection', label: 'Objection' },
            { value: 'other', label: 'Other' },
          ] as const
        ).map((chip) => (
          <button
            key={chip.value}
            type="button"
            data-testid={`intent-filter-${chip.value}`}
            data-active={intentFilter === chip.value || undefined}
            onClick={() => setIntentFilter(chip.value)}
            className={cn(
              'inline-flex items-center h-7 rounded-full border px-2.5 text-[11px] font-medium uppercase tracking-[var(--jordan-tracking-label)] transition-colors',
              intentFilter === chip.value
                ? 'border-[color:color-mix(in_oklab,var(--jordan-accent)_40%,transparent)] bg-[var(--jordan-accent-soft)] text-[var(--jordan-accent-hover)]'
                : 'border-hairline bg-surface-2 text-ink-muted hover:bg-surface-3 hover:text-ink',
            )}
            aria-pressed={intentFilter === chip.value}
          >
            {chip.label}
          </button>
        ))}
      </div>

      <div className="mt-4 flex-1 overflow-hidden px-4 pb-6 sm:px-6">
        <div className="grid h-full grid-cols-1 overflow-hidden rounded-[var(--jordan-radius-md)] border border-hairline bg-surface-1 lg:grid-cols-[minmax(280px,360px)_1fr]">
          {/* Left pane — queue */}
          <div
            ref={queueRef}
            className="min-h-0 overflow-y-auto border-hairline lg:border-r"
          >
            {isLoading && (
              <div className="space-y-2 p-3">
                {[0, 1, 2].map((i) => (
                  <SkeletonCard key={i} lines={2} />
                ))}
              </div>
            )}

            {!isLoading && queue.length === 0 && (
              <EmptyState
                icon={Mail}
                title="No drafts pending"
                body="Briefing email will trigger more overnight."
              />
            )}

            {!isLoading && queue.length > 0 && (
              <div role="list" aria-label="Draft queue">
                {queue.map((draft, idx) => (
                  <DraftQueueRow
                    key={draft.id}
                    data-draft-id={draft.id}
                    draft={draft}
                    isActive={idx === activeIndex}
                    isSkipped={skippedIds.has(draft.id)}
                    isRemoving={removingIds.has(draft.id)}
                    intent={draft.contact_id ? intentMap[draft.contact_id] : null}
                    onSelect={() => setActiveIndex(idx)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Right pane — preview */}
          <div className="hidden min-h-0 lg:block">
            {isLoading ? (
              <div className="p-6">
                <SkeletonCard lines={5} />
              </div>
            ) : (
              <DraftPreviewPane
                draft={active ?? null}
                editOpenSignal={editSignal}
                rejectOpenSignal={rejectSignal}
                onEditOpenChange={setEditOpen}
                onRejectOpenChange={setRejectOpen}
                onApproved={() => {
                  // Row animation kicked off via handleApproveWithAnim;
                  // nothing else to do here because the query invalidates.
                }}
                onRejected={() => {
                  /* handled by mutation onSuccess */
                }}
                onSkip={handleSkip}
              />
            )}
          </div>

          {/* Mobile preview — full-width below list */}
          <div className="block border-t border-hairline lg:hidden">
            {!isLoading && active && (
              <DraftPreviewPane
                draft={active}
                editOpenSignal={editSignal}
                rejectOpenSignal={rejectSignal}
                onEditOpenChange={setEditOpen}
                onRejectOpenChange={setRejectOpen}
                onSkip={handleSkip}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
