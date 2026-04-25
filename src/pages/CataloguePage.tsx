import { useMemo } from 'react'
import { CapsLabel, DataTable, type ColumnDef, PageHeader, MetricNumber } from '@/components/primitives'
import { useProducts, brandLabel, type Product, type ProductBrand } from '@/lib/queries/products'
import { CheckCircle2, XCircle } from 'lucide-react'

const BRAND_ORDER: ProductBrand[] = ['purezza', 'culligan', 'zip']

const COLUMNS: ColumnDef<Product>[] = [
  {
    id: 'sku',
    header: 'SKU',
    cell: (row) => (
      <span className="text-[11px] uppercase tracking-[var(--jordan-tracking-label)] text-ink-faint jordan-tnum">
        {row.sku}
      </span>
    ),
    width: '140px',
  },
  {
    id: 'label',
    header: 'Label',
    cell: (row) => <span className="text-ink font-medium">{row.label}</span>,
  },
  {
    id: 'category',
    header: 'Category',
    cell: (row) => <span className="text-ink-muted capitalize">{row.category}</span>,
    width: '120px',
  },
  {
    id: 'price',
    header: 'Weekly $ ex-GST',
    numeric: true,
    align: 'right',
    cell: (row) => (
      <MetricNumber
        value={row.weekly_price_aud}
        format="currency"
        minimumFractionDigits={2}
        maximumFractionDigits={2}
        className="text-ink"
      />
    ),
    width: '140px',
  },
  {
    id: 'term',
    header: 'Default term',
    numeric: true,
    align: 'right',
    cell: (row) => <span className="jordan-tnum">{row.default_term_months} mo</span>,
    width: '110px',
  },
  {
    id: 'commission',
    header: 'Default comm.',
    numeric: true,
    align: 'right',
    cell: (row) => (
      <span className="jordan-tnum">{row.default_commission_pct.toFixed(2)}%</span>
    ),
    width: '120px',
  },
  {
    id: 'water',
    header: 'Water types',
    cell: (row) => (
      <div className="flex flex-wrap gap-1">
        {row.water_types.map((w) => (
          <span
            key={w}
            className="inline-flex items-center rounded-[3px] border border-hairline bg-surface-2 px-1.5 py-[1px] text-[10px] text-ink-muted capitalize"
          >
            {w}
          </span>
        ))}
      </div>
    ),
  },
  {
    id: 'active',
    header: 'Active',
    align: 'center',
    cell: (row) =>
      row.active ? (
        <CheckCircle2 className="w-4 h-4 text-[color:var(--jordan-accent-mint)] inline" aria-label="Active" />
      ) : (
        <XCircle className="w-4 h-4 text-ink-faint inline" aria-label="Inactive" />
      ),
    width: '70px',
  },
]

export function CataloguePage() {
  const { data: products, isLoading, error } = useProducts()

  const grouped = useMemo(() => {
    const map = new Map<ProductBrand, Product[]>()
    for (const b of BRAND_ORDER) map.set(b, [])
    for (const p of products ?? []) {
      const list = map.get(p.brand) ?? []
      list.push(p)
      map.set(p.brand, list)
    }
    return map
  }, [products])

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-[1280px]">
      <PageHeader
        eyebrow="Workspace"
        title="Catalogue"
        description="Sales packages — Purezza, Culligan and Zip HydroTap. Read-only for now."
      />

      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          Failed to load catalogue: {(error as Error).message}
        </div>
      )}

      {BRAND_ORDER.map((brand) => {
        const items = grouped.get(brand) ?? []
        return (
          <section key={brand} className="space-y-2">
            <div className="flex items-baseline justify-between">
              <CapsLabel>{brandLabel(brand)}</CapsLabel>
              <span className="text-[11px] text-ink-faint jordan-tnum">
                {items.length} package{items.length === 1 ? '' : 's'}
              </span>
            </div>
            <DataTable
              rows={items}
              columns={COLUMNS}
              rowKey={(r) => r.id}
              loading={isLoading}
              ariaLabel={`${brandLabel(brand)} catalogue`}
              empty={{ title: `No ${brandLabel(brand)} packages` }}
            />
          </section>
        )
      })}
    </div>
  )
}
