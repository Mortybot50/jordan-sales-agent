import * as React from 'react'
import { AlertTriangle, RotateCcw } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * ErrorAlert — red-tinted pane with optional retry button.
 *
 * Replaces `destructive/10` inline red boxes scattered across screens.
 * Accepts an Error or string; if an onRetry handler is provided the
 * retry button renders inline.
 */
export interface ErrorAlertProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  title?: React.ReactNode
  error?: Error | string | null
  onRetry?: () => void
  retryLabel?: string
  /** Compact inline variant (no icon box, single line). */
  compact?: boolean
}

function errorMessage(err: Error | string | null | undefined): string {
  if (!err) return 'Something went wrong.'
  if (typeof err === 'string') return err
  return err.message || 'Something went wrong.'
}

export const ErrorAlert = React.forwardRef<HTMLDivElement, ErrorAlertProps>(
  ({ title, error, onRetry, retryLabel = 'Retry', compact = false, className, children, ...rest }, ref) => {
    const message = errorMessage(error)

    return (
      <div
        ref={ref}
        role="alert"
        data-slot="error-alert"
        className={cn(
          'rounded-[var(--jordan-radius-md)] border bg-[var(--jordan-danger-soft)]',
          'border-[color:color-mix(in_oklab,var(--jordan-danger)_24%,transparent)]',
          compact ? 'flex items-center gap-2 px-3 py-2' : 'flex items-start gap-3 p-4',
          className,
        )}
        {...rest}
      >
        {!compact && (
          <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[var(--jordan-danger-text)]">
            <AlertTriangle size={16} strokeWidth={2} />
          </span>
        )}
        <div className="min-w-0 flex-1">
          {title && (
            <div className="text-[13px] font-semibold text-[var(--jordan-danger-text)]">{title}</div>
          )}
          <div
            className={cn(
              'text-[13px] leading-5 text-[var(--jordan-danger-text)]/90',
              title && 'mt-0.5',
            )}
          >
            {message}
          </div>
          {children && <div className="mt-2 text-[13px] text-ink-muted">{children}</div>}
        </div>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-[var(--jordan-radius-sm)]',
              'border border-[color:color-mix(in_oklab,var(--jordan-danger)_32%,transparent)]',
              'px-2 py-1 text-[11px] font-medium uppercase tracking-[var(--jordan-tracking-label)]',
              'text-[var(--jordan-danger-text)] transition-colors',
              'hover:bg-[color:color-mix(in_oklab,var(--jordan-danger)_12%,transparent)]',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--jordan-accent-ring)]',
            )}
          >
            <RotateCcw size={12} strokeWidth={2.25} />
            {retryLabel}
          </button>
        )}
      </div>
    )
  },
)
ErrorAlert.displayName = 'ErrorAlert'
