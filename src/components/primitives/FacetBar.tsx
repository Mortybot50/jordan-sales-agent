import * as React from 'react'
import { Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * FacetBar — the filter strip above a DataTable.
 *
 * Renders a left-aligned search + filter chips (controlled by parent)
 * and a right-aligned summary ("8 of 24"). No data fetching. No state
 * ownership — the parent owns filter state; this is presentation only.
 */

export interface FacetOption {
  value: string
  label: React.ReactNode
  /** Optional count badge. */
  count?: number
}

export interface FacetDef {
  id: string
  label: string
  options: FacetOption[]
  /** 'single' = radio-ish chips, 'multi' = toggleable. */
  mode?: 'single' | 'multi'
}

export interface FacetBarProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Search string (controlled). */
  search?: string
  onSearchChange?: (value: string) => void
  searchPlaceholder?: string
  /** Filter facet definitions. */
  facets?: FacetDef[]
  /** Current selection keyed by facet id → array of selected values. */
  selection?: Record<string, string[]>
  onSelectionChange?: (facetId: string, values: string[]) => void
  /** Right-aligned summary node, e.g. `<span>8 of 24</span>`. */
  summary?: React.ReactNode
  /** Show a clear-all button when any filter is active. */
  onClear?: () => void
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      data-slot="filter-chip"
      data-active={active}
      onClick={onClick}
      className={cn(
        'inline-flex h-7 items-center gap-1.5 rounded-[var(--jordan-radius-sm)] border px-2 text-[12px] font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--jordan-accent-ring)]',
        active
          ? 'border-[color:var(--jordan-accent)] bg-[var(--jordan-accent-soft)] text-[var(--jordan-accent-hover)]'
          : 'border-hairline bg-surface-1 text-ink-muted hover:bg-surface-3',
      )}
    >
      {children}
    </button>
  )
}

export function FacetBar({
  search,
  onSearchChange,
  searchPlaceholder = 'Search…',
  facets = [],
  selection = {},
  onSelectionChange,
  summary,
  onClear,
  className,
  ...rest
}: FacetBarProps) {
  const anyActive =
    (search && search.length > 0) ||
    Object.values(selection).some((vals) => vals && vals.length > 0)

  const toggle = (facetId: string, value: string, mode: 'single' | 'multi') => {
    if (!onSelectionChange) return
    const current = selection[facetId] ?? []
    if (mode === 'single') {
      onSelectionChange(facetId, current.includes(value) ? [] : [value])
    } else {
      const next = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value]
      onSelectionChange(facetId, next)
    }
  }

  return (
    <div
      data-slot="facet-bar"
      className={cn(
        'flex flex-wrap items-center gap-2 rounded-[var(--jordan-radius-md)] border border-hairline bg-surface-1 px-3 py-2',
        className,
      )}
      {...rest}
    >
      {onSearchChange && (
        <div className="relative flex-1 min-w-[180px] max-w-[280px]">
          <Search
            size={14}
            strokeWidth={2}
            className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-ink-faint"
          />
          <input
            type="search"
            value={search ?? ''}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={searchPlaceholder}
            className={cn(
              'h-7 w-full rounded-[var(--jordan-radius-sm)] border border-hairline bg-surface-2 pr-2 pl-7',
              'text-[13px] text-ink placeholder:text-ink-disabled',
              'focus-visible:outline-none focus-visible:border-[color:var(--jordan-accent)] focus-visible:ring-2 focus-visible:ring-[var(--jordan-accent-ring)]',
            )}
          />
        </div>
      )}

      {facets.map((facet) => (
        <div key={facet.id} className="flex items-center gap-1.5">
          <span className="text-[11px] uppercase tracking-[var(--jordan-tracking-label)] text-ink-faint">
            {facet.label}
          </span>
          <div className="flex flex-wrap items-center gap-1">
            {facet.options.map((opt) => {
              const selected = (selection[facet.id] ?? []).includes(opt.value)
              return (
                <FilterChip
                  key={opt.value}
                  active={selected}
                  onClick={() => toggle(facet.id, opt.value, facet.mode ?? 'multi')}
                >
                  {opt.label}
                  {typeof opt.count === 'number' && (
                    <span className="font-mono text-[11px] text-ink-faint">{opt.count}</span>
                  )}
                </FilterChip>
              )
            })}
          </div>
        </div>
      ))}

      <div className="ml-auto flex items-center gap-2">
        {anyActive && onClear && (
          <button
            type="button"
            onClick={onClear}
            className="inline-flex items-center gap-1 text-[12px] text-ink-faint hover:text-ink-muted"
          >
            <X size={12} /> Clear
          </button>
        )}
        {summary && <div className="text-[12px] text-ink-faint jordan-tnum">{summary}</div>}
      </div>
    </div>
  )
}

FacetBar.displayName = 'FacetBar'
