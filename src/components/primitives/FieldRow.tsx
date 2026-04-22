import * as React from 'react'
import { Pencil, Check, X } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * FieldRow — Atlas-style inline edit row.
 *
 * Layout: fixed-width label (default 120px) + flexible value column.
 * Hover reveals an edit pencil; clicking (or pressing Enter on the
 * row) swaps the value for an editor slot supplied by the caller.
 *
 * Usage:
 *   <FieldRow label="Tier" value={tierPill}>
 *     {({ close }) => <TierEditor onSave={(t) => { save(t); close() }} />}
 *   </FieldRow>
 *
 * Keeps behaviour entirely controlled by the consumer — FieldRow is
 * a layout + affordance primitive, not a form widget.
 */
export interface FieldRowRenderContext {
  close: () => void
  commit: () => void
}

export interface FieldRowProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'children'> {
  label: React.ReactNode
  /** Display value when NOT editing. */
  value: React.ReactNode
  /**
   * Editor render prop. If omitted, the row is read-only and no edit
   * affordance is shown.
   */
  children?: (ctx: FieldRowRenderContext) => React.ReactNode
  /** Width of the label column. Default 120px. */
  labelWidth?: number
  /** Controlled editing state. If omitted, internal state is used. */
  editing?: boolean
  onEditingChange?: (editing: boolean) => void
  /** Called when user confirms (Enter or check icon). */
  onCommit?: () => void
  /** Show the save/cancel action buttons in-row when editing. Default true. */
  showActions?: boolean
}

export const FieldRow = React.forwardRef<HTMLDivElement, FieldRowProps>(
  (
    {
      label,
      value,
      children,
      labelWidth = 120,
      editing,
      onEditingChange,
      onCommit,
      showActions = true,
      className,
      ...rest
    },
    ref,
  ) => {
    const [internalEditing, setInternalEditing] = React.useState(false)
    const isEditing = editing ?? internalEditing
    const readOnly = !children

    const setEditing = (next: boolean) => {
      onEditingChange?.(next)
      if (editing === undefined) setInternalEditing(next)
    }

    const close = () => setEditing(false)
    const commit = () => {
      onCommit?.()
      setEditing(false)
    }

    const open = () => {
      if (readOnly) return
      setEditing(true)
    }

    return (
      <div
        ref={ref}
        data-slot="field-row"
        data-editing={isEditing}
        className={cn(
          'group grid items-start gap-3 border-b border-hairline py-2 text-[13px] transition-colors',
          'last:border-b-0',
          !readOnly && 'cursor-text hover:bg-surface-3',
          className,
        )}
        style={{ gridTemplateColumns: `${labelWidth}px 1fr auto` }}
        onKeyDown={(e) => {
          if (readOnly || isEditing) return
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            open()
          }
        }}
        tabIndex={readOnly ? -1 : 0}
        role={readOnly ? undefined : 'button'}
        aria-label={readOnly ? undefined : `Edit ${typeof label === 'string' ? label : 'field'}`}
        {...rest}
      >
        <div className="pt-0.5 text-[11px] uppercase tracking-[var(--jordan-tracking-label)] text-ink-faint">
          {label}
        </div>

        <div className="min-w-0" onClick={open}>
          {isEditing && children ? (
            children({ close, commit })
          ) : (
            <div className="truncate text-ink">{value}</div>
          )}
        </div>

        <div className="flex items-center gap-1 self-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 data-[visible=true]:opacity-100">
          {!readOnly && !isEditing && (
            <button
              type="button"
              onClick={open}
              aria-label={`Edit ${typeof label === 'string' ? label : 'field'}`}
              className="inline-flex size-6 items-center justify-center rounded-[var(--jordan-radius-sm)] text-ink-faint hover:bg-surface-4 hover:text-ink-muted"
            >
              <Pencil size={12} strokeWidth={2} />
            </button>
          )}
          {isEditing && showActions && (
            <>
              <button
                type="button"
                onClick={commit}
                aria-label="Save"
                className="inline-flex size-6 items-center justify-center rounded-[var(--jordan-radius-sm)] text-[var(--jordan-success-text)] hover:bg-[var(--jordan-success-soft)]"
              >
                <Check size={14} strokeWidth={2.25} />
              </button>
              <button
                type="button"
                onClick={close}
                aria-label="Cancel"
                className="inline-flex size-6 items-center justify-center rounded-[var(--jordan-radius-sm)] text-ink-faint hover:bg-surface-4 hover:text-ink-muted"
              >
                <X size={14} strokeWidth={2.25} />
              </button>
            </>
          )}
        </div>
      </div>
    )
  },
)
FieldRow.displayName = 'FieldRow'
