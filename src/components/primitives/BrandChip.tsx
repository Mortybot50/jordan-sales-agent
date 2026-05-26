import { cn } from '@/lib/utils'

export type BrandKey = 'purezza' | 'culligan' | 'zip' | 'other'

interface BrandChipProps {
  brand: string | null | undefined
  className?: string
  title?: string
}

const BRAND_LABELS: Record<BrandKey, string> = {
  purezza: 'Purezza',
  culligan: 'Culligan',
  zip: 'Zip',
  other: 'Other',
}

/**
 * Small uppercase brand pill rendered next to a product label so Jordan can
 * read brand-product at a glance. Reuses existing Jordan colour tokens:
 *   Purezza → warm/amber  (Jordan's primary work)
 *   Culligan → accent blue
 *   Zip      → mint/green
 */
export function BrandChip({ brand, className, title }: BrandChipProps) {
  const key = normaliseBrand(brand)
  if (!key) return null

  const tone =
    key === 'purezza'
      ? 'bg-[color:var(--jordan-warm-soft,transparent)] border-[color:var(--jordan-warm)]/40 text-[color:var(--jordan-warm-text)]'
      : key === 'culligan'
        ? 'bg-[color:var(--jordan-accent-soft)] border-[color:var(--jordan-accent)]/30 text-[color:var(--jordan-accent-hover)]'
        : key === 'zip'
          ? 'bg-[color:var(--jordan-accent-mint-soft)] border-[color:var(--jordan-accent-mint)]/40 text-[color:var(--jordan-success-text)]'
          : 'bg-surface-3 border-hairline text-ink-muted'

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-[3px] border px-1.5 py-[1px]',
        'text-[11px] font-semibold uppercase tracking-[var(--jordan-tracking-label)]',
        tone,
        className,
      )}
      title={title ?? BRAND_LABELS[key]}
    >
      {BRAND_LABELS[key]}
    </span>
  )
}

function normaliseBrand(brand: string | null | undefined): BrandKey | null {
  if (!brand) return null
  const b = brand.toLowerCase()
  if (b === 'purezza' || b === 'culligan' || b === 'zip') return b
  if (b === 'other') return 'other'
  return 'other'
}
