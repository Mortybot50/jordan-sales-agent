import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Mail } from 'lucide-react'
import {
  EmptyState,
  KbdHint,
  PageHeader,
  SkeletonCard,
} from '@/components/primitives'
import { DraftQueueRow } from '@/components/drafts/DraftQueueRow'
import { DraftPreviewPane } from '@/components/drafts/DraftPreviewPane'
import { useDrafts, useApproveDraft } from '@/lib/queries/drafts'

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

  // Queue ordering: non-skipped first, skipped at end.
  const queue = useMemo(() => {
    if (!drafts) return []
    return [
      ...drafts.filter((d) => !skippedIds.has(d.id)),
      ...drafts.filter((d) => skippedIds.has(d.id)),
    ]
  }, [drafts, skippedIds])

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

  const pendingCount = queue.filter((d) => !skippedIds.has(d.id)).length

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

      {/* Mobile kbd summary */}
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 px-4 text-[11px] text-ink-faint md:hidden sm:px-6">
        <KbdHint label="Approve">A</KbdHint>
        <KbdHint label="Reject">R</KbdHint>
        <KbdHint label="Edit">E</KbdHint>
        <KbdHint label="Skip">S</KbdHint>
        <KbdHint label="Next">J</KbdHint>
        <KbdHint label="Prev">K</KbdHint>
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
