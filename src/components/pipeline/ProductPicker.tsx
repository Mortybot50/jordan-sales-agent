import { useMemo, useState } from 'react'
import { Check, ChevronsUpDown, Search } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Input } from '@/components/ui/input'
import { BrandChip } from '@/components/primitives'
import { useProducts, brandLabel, type Product, type ProductBrand } from '@/lib/queries/products'
import { cn } from '@/lib/utils'

interface ProductPickerProps {
  value: string | null
  onChange: (productId: string, product: Product) => void
  placeholder?: string
  disabled?: boolean
  invalid?: boolean
  id?: string
}

const BRAND_ORDER: ProductBrand[] = ['purezza', 'culligan', 'zip', 'other']

/**
 * Single-select product picker grouped by brand. Search filters by SKU,
 * label and brand. Selecting a product fires `onChange` with the full
 * Product so the caller can pre-fill title / price / commission etc.
 */
export function ProductPicker({
  value,
  onChange,
  placeholder = 'Select a product…',
  disabled,
  invalid,
  id,
}: ProductPickerProps) {
  const { data: products, isLoading } = useProducts()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  const selected = useMemo(
    () => (products ?? []).find((p) => p.id === value) ?? null,
    [products, value],
  )

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = (products ?? []).filter((p) => {
      if (!q) return true
      return (
        p.label.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        p.brand.toLowerCase().includes(q)
      )
    })
    const map: Record<ProductBrand, Product[]> = {
      purezza: [],
      culligan: [],
      zip: [],
      other: [],
    }
    for (const p of filtered) {
      map[p.brand].push(p)
    }
    return map
  }, [products, query])

  const hasResults = BRAND_ORDER.some((b) => grouped[b].length > 0)

  function handleSelect(p: Product) {
    onChange(p.id, p)
    setOpen(false)
    setQuery('')
  }

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQuery('') }}>
      <PopoverTrigger asChild>
        <button
          type="button"
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-invalid={invalid || undefined}
          disabled={disabled || isLoading}
          className={cn(
            'flex h-9 w-full items-center justify-between rounded-md border bg-transparent px-3 py-1.5 text-sm shadow-xs transition-[color,box-shadow]',
            'focus:outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]',
            invalid
              ? 'border-destructive ring-destructive/20 ring-[3px]'
              : 'border-input',
            disabled && 'opacity-50 cursor-not-allowed',
          )}
        >
          <span className="flex items-center gap-2 min-w-0">
            {selected ? (
              <>
                <BrandChip brand={selected.brand} />
                <span className="truncate text-ink">{selected.label}</span>
              </>
            ) : (
              <span className="text-ink-faint">
                {isLoading ? 'Loading products…' : placeholder}
              </span>
            )}
          </span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 text-ink-faint" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[min(420px,calc(100vw-2rem))] p-0 gap-0"
      >
        <div className="border-b border-hairline p-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink-faint" />
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search products…"
              className="h-8 pl-7 text-[13px]"
            />
          </div>
        </div>
        <div className="max-h-[280px] overflow-y-auto p-1">
          {!hasResults && (
            <p className="px-3 py-6 text-center text-[12px] text-ink-faint">
              No products match "{query}"
            </p>
          )}
          {BRAND_ORDER.map((b) => {
            const items = grouped[b]
            if (items.length === 0) return null
            return (
              <div key={b} className="py-1">
                <div className="px-2 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-[var(--jordan-tracking-label)] text-ink-faint">
                  {brandLabel(b)}
                </div>
                {items.map((p) => {
                  const isActive = p.id === value
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => handleSelect(p)}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-[4px] px-2 py-1.5 text-left text-[13px]',
                        'hover:bg-surface-3 focus:bg-surface-3 focus:outline-none',
                        isActive && 'bg-surface-3',
                      )}
                    >
                      <Check
                        className={cn(
                          'h-3.5 w-3.5 shrink-0',
                          isActive ? 'text-[color:var(--jordan-accent)]' : 'text-transparent',
                        )}
                      />
                      <span className="flex-1 min-w-0 truncate text-ink">
                        {p.label}
                      </span>
                      <span className="jordan-tnum shrink-0 text-[11px] text-ink-faint">
                        ${p.weekly_price_aud.toFixed(2)}/wk
                      </span>
                    </button>
                  )
                })}
              </div>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}
