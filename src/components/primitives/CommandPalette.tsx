import * as React from 'react'
import { Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { KbdHint } from './KbdHint'

/**
 * CommandPalette — shell ONLY for Phase A.
 *
 * Per plan §4.2, the real ⌘K palette ships in Phase E. This shell:
 *   - demonstrates the visual language (hairline border, 10px radius,
 *     sheet shadow, accent-highlighted active row)
 *   - provides the prop contract for future wiring
 *   - supports presentational demo on /__primitives
 *
 * Behaviour is intentionally minimal: filter items by `query`,
 * up/down arrow navigation, Enter selects, Escape calls onOpenChange.
 * No routing, no network calls, no global hotkey wiring yet.
 */

export interface CommandItem {
  id: string
  label: React.ReactNode
  /** Optional secondary line (subtitle, match highlight, etc). */
  hint?: React.ReactNode
  /** Leading icon / avatar. */
  leading?: React.ReactNode
  /** Trailing content (e.g. keyboard shortcut). */
  trailing?: React.ReactNode
  /** Group heading — items with the same group render under one heading. */
  group?: string
  /** Keyword haystack for client-side filtering. */
  keywords?: string[]
}

export interface CommandPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  items: CommandItem[]
  /** Fire when the user selects an item via Enter or click. */
  onSelect?: (item: CommandItem) => void
  placeholder?: string
  /** Optional footer slot (e.g. keyboard shortcuts legend). */
  footer?: React.ReactNode
}

function matches(item: CommandItem, q: string): boolean {
  if (!q) return true
  const needle = q.toLowerCase()
  const hay = [
    typeof item.label === 'string' ? item.label : '',
    typeof item.hint === 'string' ? item.hint : '',
    ...(item.keywords ?? []),
  ]
    .join(' ')
    .toLowerCase()
  return hay.includes(needle)
}

export function CommandPalette({
  open,
  onOpenChange,
  items,
  onSelect,
  placeholder = 'Search for contacts, deals, pages…',
  footer,
}: CommandPaletteProps) {
  const [query, setQuery] = React.useState('')
  const [activeIndex, setActiveIndexState] = React.useState(0)
  const inputRef = React.useRef<HTMLInputElement | null>(null)

  const filtered = React.useMemo(() => items.filter((i) => matches(i, query)), [items, query])

  // Group items in order of first appearance
  const groups = React.useMemo(() => {
    const map = new Map<string, CommandItem[]>()
    for (const item of filtered) {
      const g = item.group ?? ''
      const bucket = map.get(g) ?? []
      bucket.push(item)
      map.set(g, bucket)
    }
    return Array.from(map.entries())
  }, [filtered])

  // Clamp activeIndex during render when filtered list shrinks —
  // avoids a setState-in-effect. Active index also resets via the
  // input onChange handler below when query changes.
  const clampedActiveIndex = Math.min(activeIndex, Math.max(0, filtered.length - 1))
  const setActiveIndex = setActiveIndexState

  React.useEffect(() => {
    if (open) {
      const t = setTimeout(() => inputRef.current?.focus(), 0)
      return () => clearTimeout(t)
    }
  }, [open])

  if (!open) return null

  const flatIds = filtered.map((i) => i.id)

  const onKey: React.KeyboardEventHandler<HTMLDivElement> = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onOpenChange(false)
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => Math.min(i + 1, Math.max(0, flatIds.length - 1)))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => Math.max(0, i - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const target = filtered[clampedActiveIndex]
      if (target) {
        onSelect?.(target)
        onOpenChange(false)
      }
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      data-slot="command-palette"
      onKeyDown={onKey}
      className="fixed inset-0 z-50 flex items-start justify-center bg-[rgba(15,23,42,0.32)] px-4 pt-[12vh]"
      onClick={(e) => {
        if (e.target === e.currentTarget) onOpenChange(false)
      }}
    >
      <div
        className={cn(
          'w-full max-w-[560px] overflow-hidden rounded-[var(--jordan-radius-lg)] border border-hairline bg-surface-1',
          'shadow-sheet',
        )}
      >
        <div className="flex items-center gap-2 border-b border-hairline px-3">
          <Search size={14} strokeWidth={2} className="text-ink-faint" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setActiveIndex(0)
            }}
            placeholder={placeholder}
            className="h-10 w-full bg-transparent text-[14px] text-ink placeholder:text-ink-disabled focus:outline-none"
          />
          <KbdHint>ESC</KbdHint>
        </div>

        <div role="listbox" className="max-h-[360px] overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <div className="px-3 py-6 text-center text-[13px] text-ink-faint">
              No matches for <span className="text-ink-muted">"{query}"</span>
            </div>
          ) : (
            groups.map(([group, groupItems]) => (
              <div key={group || 'default'}>
                {group && (
                  <div className="mt-1 px-3 py-1 text-[10px] uppercase tracking-[var(--jordan-tracking-section)] text-ink-faint">
                    {group}
                  </div>
                )}
                {groupItems.map((item) => {
                  const globalIndex = flatIds.indexOf(item.id)
                  const active = globalIndex === clampedActiveIndex
                  return (
                    <button
                      key={item.id}
                      type="button"
                      role="option"
                      aria-selected={active}
                      onMouseEnter={() => setActiveIndex(globalIndex)}
                      onClick={() => {
                        onSelect?.(item)
                        onOpenChange(false)
                      }}
                      className={cn(
                        'flex w-full items-center gap-3 px-3 py-2 text-left transition-colors',
                        active ? 'bg-[var(--jordan-accent-soft)]' : 'hover:bg-surface-3',
                      )}
                    >
                      {item.leading && <span className="shrink-0">{item.leading}</span>}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] text-ink">{item.label}</span>
                        {item.hint && (
                          <span className="block truncate text-[12px] text-ink-faint">
                            {item.hint}
                          </span>
                        )}
                      </span>
                      {item.trailing && <span className="shrink-0">{item.trailing}</span>}
                    </button>
                  )
                })}
              </div>
            ))
          )}
        </div>

        {footer && (
          <div className="flex items-center gap-3 border-t border-hairline bg-surface-2 px-3 py-2 text-[11px] text-ink-faint">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}

CommandPalette.displayName = 'CommandPalette'
