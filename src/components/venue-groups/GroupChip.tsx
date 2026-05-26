import { Building2 } from 'lucide-react'
import { cn } from '@/lib/utils'

interface GroupChipProps {
  name: string | null | undefined
  className?: string
  /** Use the tiny pipeline-card variant (single-line, faint). */
  compact?: boolean
}

/**
 * Small "— Solotel" group subtitle shown below a venue name on pipeline
 * cards and contact rows so Jordan can read venue → group at a glance.
 * Render nothing if the venue has no group.
 */
export function GroupChip({ name, className, compact = false }: GroupChipProps) {
  if (!name) return null
  if (compact) {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1 text-[11px] text-ink-faint truncate',
          className,
        )}
        title={`Group: ${name}`}
      >
        <Building2 className="h-3 w-3 shrink-0" />
        <span className="truncate">{name}</span>
      </span>
    )
  }
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-[3px] border border-hairline bg-surface-3 px-1.5 py-[1px]',
        'text-[11px] text-ink-muted',
        className,
      )}
      title={`Group: ${name}`}
    >
      <Building2 className="h-3 w-3 shrink-0" />
      <span className="truncate">{name}</span>
    </span>
  )
}
