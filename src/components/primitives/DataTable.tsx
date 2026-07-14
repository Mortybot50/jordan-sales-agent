import * as React from 'react'
import { cn } from '@/lib/utils'
import { SortHeader, type SortDirection } from './SortHeader'
import { SkeletonRow } from './Skeleton'
import { EmptyState, type EmptyStateProps } from './EmptyState'
import { ErrorAlert } from './ErrorAlert'

/**
 * DataTable — composable hairline-bordered table.
 *
 * - Sticky header
 * - Sortable columns (controlled by parent)
 * - Optional row selection
 * - Tabular numerals automatic on numeric columns
 * - Built-in loading / empty / error states
 * - Default 32px row height (Morty-locked for Phase A)
 * - Headless: consumer passes a typed `ColumnDef<T>[]` and rows are
 *   rendered via column `cell(row)` functions.
 */

export interface ColumnDef<T> {
  id: string
  header: React.ReactNode
  /** Render cell content. */
  cell: (row: T, index: number) => React.ReactNode
  /** Column width (CSS length). If omitted, column is flexible. */
  width?: string
  /** Right-align for numeric columns; also applies tabular numerals. */
  align?: 'left' | 'right' | 'center'
  /** Mark numeric column (applies `jordan-tnum` + mono by convention). */
  numeric?: boolean
  /** Enable sort UI on this column. */
  sortable?: boolean
  /** Accessible label if header is non-textual. */
  ariaLabel?: string
}

export type RowDensity = 'compact' | 'default' | 'cozy'

const rowHeightVar: Record<RowDensity, string> = {
  compact: 'var(--jordan-row-compact)',
  default: 'var(--jordan-row)',
  cozy:    'var(--jordan-row-cozy)',
}

export interface DataTableProps<T> extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onSelect'> {
  rows: T[] | undefined
  columns: ColumnDef<T>[]
  /** Stable key extractor. Defaults to index — prefer a real id. */
  rowKey?: (row: T, index: number) => string | number
  /** 32px rows by default (Morty-locked for Phase A). */
  density?: RowDensity
  /** Loading state — renders skeleton rows. */
  loading?: boolean
  /** Number of skeleton rows when loading. */
  skeletonRows?: number
  /** Error state — renders ErrorAlert and no rows. */
  error?: Error | string | null
  onRetry?: () => void
  /** Empty state config when `rows.length === 0`. */
  empty?: Partial<EmptyStateProps> & { title: React.ReactNode }
  /** Current sort state, if any. */
  sort?: { columnId: string; direction: SortDirection } | null
  /** Sort toggle callback. */
  onSortChange?: (columnId: string) => void
  /** Row click → a subtle hover + pointer. */
  onRowClick?: (row: T, index: number) => void
  /** aria-label for the <table>. */
  ariaLabel?: string
}

export function DataTable<T>({
  rows,
  columns,
  rowKey,
  density = 'default',
  loading = false,
  skeletonRows = 6,
  error = null,
  onRetry,
  empty,
  sort,
  onSortChange,
  onRowClick,
  ariaLabel,
  className,
  ...rest
}: DataTableProps<T>) {
  // The header row and each body row are SEPARATE grid containers that must
  // resolve to identical column tracks. A content-sized track (`1fr` or
  // `minmax(min, 1fr)`) resolves its `max-content` contribution from ITS OWN
  // content, so under the table's `min-width: max-content` overflow the header
  // (short label) and body (longer cell) size a flexible track differently —
  // shifting every value one column right of its header on narrow viewports.
  // Fix: flexible columns get an explicit fixed width so every track is
  // deterministic and identical across both grids. Content truncates within.
  // Header and body are SEPARATE grid containers, so their column tracks must
  // resolve to the exact same widths. A content-flexible track (`1fr` or
  // `minmax(min, Nfr)`) resolves partly from its OWN content, so under the
  // table's `min-width: max-content` overflow the header (short label) and body
  // (longer cell) size that track differently — shifting every value one column
  // right of its header on narrow viewports (the reported bug). Only
  // deterministic (fr-free) tracks are guaranteed identical in both grids.
  //
  // normalizeTrack strips flexibility so alignment is bulletproof for every
  // consumer, without each page having to remember to avoid `fr`:
  //   - no width           -> fixed 220px
  //   - 'minmax(min, Nfr)'  -> fixed `min` (the floor becomes the width)
  //   - any 'Nfr'           -> fixed 200px fallback
  //   - explicit fixed len  -> unchanged (e.g. '110px', '64px')
  const normalizeTrack = (w: string | undefined): string => {
    if (!w) return '220px'
    const mm = w.match(/minmax\(\s*([^,]+?)\s*,\s*[^)]*fr\s*\)/i)
    if (mm) return mm[1].trim()
    if (/\bfr\b/i.test(w)) return '200px'
    return w
  }
  const gridCols = columns.map((c) => normalizeTrack(c.width)).join(' ')
  const rowHeight = rowHeightVar[density]

  return (
    <div
      data-slot="data-table"
      className={cn(
        'overflow-hidden rounded-[var(--jordan-radius-md)] border border-hairline bg-surface-1',
        className,
      )}
      {...rest}
    >
      {/*
        Horizontal-scroll wrapper. iOS Safari needs both
        -webkit-overflow-scrolling: touch and touch-action: pan-x pan-y
        to honour a horizontal swipe inside a vertically-scrollable
        page (Bug 1: warm-leads stuck swipe on iPhone).
      */}
      <div
        className="overflow-x-auto overflow-y-hidden"
        style={{
          WebkitOverflowScrolling: 'touch',
          touchAction: 'pan-x pan-y',
        }}
      >
      {/* Sticky header */}
      <div
        role="row"
        className="sticky top-0 z-[1] grid items-center gap-3 border-b border-hairline bg-surface-2 px-3"
        style={{ gridTemplateColumns: gridCols, height: rowHeight, minWidth: 'max-content' }}
      >
        {columns.map((col) => {
          const dir: SortDirection = sort?.columnId === col.id ? sort.direction : null
          const alignCls = col.align === 'right' ? 'justify-end text-right' : col.align === 'center' ? 'justify-center text-center' : 'justify-start text-left'
          return (
            <div
              key={col.id}
              role="columnheader"
              aria-sort={dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : 'none'}
              className={cn('flex items-center min-w-0', alignCls)}
            >
              {col.sortable && onSortChange ? (
                <SortHeader
                  label={col.header}
                  direction={dir}
                  onToggle={() => onSortChange(col.id)}
                  align={col.align === 'right' ? 'right' : 'left'}
                  aria-label={col.ariaLabel}
                />
              ) : (
                <span className="text-[11px] uppercase tracking-[var(--jordan-tracking-label)] text-ink-faint">
                  {col.header}
                </span>
              )}
            </div>
          )
        })}
      </div>

      {/* Body */}
      <div role="rowgroup" aria-label={ariaLabel} aria-busy={loading} style={{ minWidth: 'max-content' }}>
        {error ? (
          <div className="p-3">
            <ErrorAlert error={error} onRetry={onRetry ?? undefined} title="Couldn't load" />
          </div>
        ) : loading ? (
          Array.from({ length: skeletonRows }).map((_, i) => (
            <SkeletonRow key={i} columns={columns.length} height={parseInt(rowHeight) || 32} />
          ))
        ) : !rows || rows.length === 0 ? (
          <EmptyState
            compact
            className="border-t border-hairline"
            title={empty?.title ?? 'Nothing here yet'}
            body={empty?.body}
            icon={empty?.icon}
            action={empty?.action}
            secondary={empty?.secondary}
          />
        ) : (
          rows.map((row, i) => {
            const key = rowKey ? rowKey(row, i) : i
            return (
              <div
                key={key}
                role="row"
                onClick={onRowClick ? () => onRowClick(row, i) : undefined}
                className={cn(
                  'grid items-center gap-3 border-b border-hairline px-3 text-[13px] leading-5 text-ink transition-colors',
                  'last:border-b-0',
                  onRowClick && 'cursor-pointer hover:bg-surface-3 focus-within:bg-surface-3',
                )}
                style={{ gridTemplateColumns: gridCols, minHeight: rowHeight, minWidth: 'max-content' }}
              >
                {columns.map((col) => {
                  const alignCls =
                    col.align === 'right'
                      ? 'justify-end text-right'
                      : col.align === 'center'
                      ? 'justify-center text-center'
                      : 'justify-start text-left'
                  return (
                    <div
                      key={col.id}
                      role="cell"
                      className={cn(
                        'flex min-w-0 items-center',
                        alignCls,
                        col.numeric && 'jordan-tnum font-mono',
                      )}
                    >
                      <span className="min-w-0 truncate">{col.cell(row, i)}</span>
                    </div>
                  )
                })}
              </div>
            )
          })
        )}
      </div>
      </div>
    </div>
  )
}

DataTable.displayName = 'DataTable'
