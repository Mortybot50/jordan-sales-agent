import { useState, useEffect, useCallback } from 'react'
import { useDrafts } from '@/lib/queries/drafts'
import { DraftCard } from '@/components/drafts/DraftCard'
import { Mail } from 'lucide-react'

export function DraftsPage() {
  const { data: drafts, isLoading } = useDrafts()
  const [activeIndex, setActiveIndex] = useState(0)
  const [skippedIds, setSkippedIds] = useState<Set<string>>(new Set())

  // Keyboard shortcuts: a approve, e edit, s skip, r reject, n next
  const handleSkip = useCallback((id: string) => {
    setSkippedIds((prev) => new Set([...prev, id]))
  }, [])

  // Normalise queue: non-skipped first, skipped at end
  const queue = drafts
    ? [
        ...drafts.filter((d) => !skippedIds.has(d.id)),
        ...drafts.filter((d) => skippedIds.has(d.id)),
      ]
    : []

  useEffect(() => {
    if (activeIndex >= queue.length && queue.length > 0) {
      setActiveIndex(queue.length - 1)
    }
  }, [queue.length, activeIndex])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return

      const active = queue[activeIndex]
      if (!active) return

      if (e.key === 'n' || e.key === 'ArrowDown') {
        e.preventDefault()
        setActiveIndex((i) => Math.min(i + 1, queue.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActiveIndex((i) => Math.max(i - 1, 0))
      } else if (e.key === 's') {
        e.preventDefault()
        handleSkip(active.id)
        setActiveIndex((i) => Math.min(i + 1, queue.length - 1))
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [queue, activeIndex, handleSkip])

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-2xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold">Draft Review Queue</h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          Keyboard: <kbd className="font-mono bg-muted px-1 rounded text-[10px]">A</kbd> approve ·{' '}
          <kbd className="font-mono bg-muted px-1 rounded text-[10px]">E</kbd> edit ·{' '}
          <kbd className="font-mono bg-muted px-1 rounded text-[10px]">S</kbd> skip ·{' '}
          <kbd className="font-mono bg-muted px-1 rounded text-[10px]">R</kbd> reject ·{' '}
          <kbd className="font-mono bg-muted px-1 rounded text-[10px]">↑↓</kbd> navigate
        </p>
      </div>

      {isLoading && (
        <div className="space-y-3">
          {[1, 2].map((i) => (
            <div key={i} className="border rounded-xl p-4 space-y-3 animate-pulse">
              <div className="h-4 bg-muted rounded w-1/3" />
              <div className="h-3 bg-muted rounded w-full" />
              <div className="h-3 bg-muted rounded w-5/6" />
              <div className="h-3 bg-muted rounded w-4/6" />
            </div>
          ))}
        </div>
      )}

      {!isLoading && queue.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-14 h-14 rounded-2xl bg-muted flex items-center justify-center mb-3">
            <Mail className="w-7 h-7 text-muted-foreground" />
          </div>
          <p className="text-sm font-medium mb-1">Queue is empty</p>
          <p className="text-xs text-muted-foreground max-w-xs">
            Generate a draft from any contact's page using the "Generate Draft" button.
          </p>
        </div>
      )}

      {!isLoading && queue.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            {queue.filter((d) => !skippedIds.has(d.id)).length} in queue
            {skippedIds.size > 0 && ` · ${skippedIds.size} skipped`}
          </p>
          {queue.map((draft, idx) => (
            <div
              key={draft.id}
              onClick={() => setActiveIndex(idx)}
              className="cursor-pointer"
            >
              <DraftCard
                draft={draft}
                isActive={idx === activeIndex}
                onSkip={() => {
                  handleSkip(draft.id)
                  setActiveIndex((i) => Math.min(i + 1, queue.length - 1))
                }}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
