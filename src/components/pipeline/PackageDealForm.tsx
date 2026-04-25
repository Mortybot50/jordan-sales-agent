import { useEffect, useMemo } from 'react'
import { useForm, type FieldErrors } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { CapsLabel, MetricNumber } from '@/components/primitives'
import { useProducts, brandLabel, type Product } from '@/lib/queries/products'
import { useStages } from '@/lib/queries/stages'
import { packageDealSchema, type PackageDealValues } from '@/lib/schemas/deal'
import { cn } from '@/lib/utils'

const TERMS = [12, 24, 36, 48, 60] as const

type SellableBrand = PackageDealValues['brand']

interface PackageDealFormProps {
  defaultTitleSeed?: string                           // e.g. "Jordan × {product.label}"
  initialBrand?: SellableBrand
  onSubmit: (values: PackageDealValues) => Promise<void> | void
  onCancel: () => void
  submitting?: boolean
  submitLabel?: string
}

function computeFinancials(weekly: number, term: number, pct: number) {
  const acv = +(weekly * 52).toFixed(2)
  const tcv = +((acv * term) / 12).toFixed(2)
  const commission = +((tcv * pct) / 100).toFixed(2)
  return { acv, tcv, commission }
}

export function PackageDealForm({
  defaultTitleSeed,
  initialBrand,
  onSubmit,
  onCancel,
  submitting,
  submitLabel = 'Add deal',
}: PackageDealFormProps) {
  const { data: products } = useProducts()
  const { data: stages } = useStages()

  const form = useForm<PackageDealValues>({
    resolver: zodResolver(packageDealSchema),
    defaultValues: {
      brand: initialBrand ?? 'purezza',
      term_months: 48,
      commission_pct: 7,
      weekly_price: 0,
      title: '',
      product_id: '',
      stage_id: '',
    },
  })

  const brand = form.watch('brand')
  const productId = form.watch('product_id')
  const term = form.watch('term_months')
  const weekly = form.watch('weekly_price')
  const pct = form.watch('commission_pct')

  const filteredProducts = useMemo(
    () => (products ?? []).filter((p) => p.brand === brand),
    [products, brand],
  )

  const product: Product | undefined = useMemo(
    () => filteredProducts.find((p) => p.id === productId),
    [filteredProducts, productId],
  )

  // Reset product selection when brand changes
  useEffect(() => {
    if (productId && product?.brand !== brand) {
      form.setValue('product_id', '')
    }
  }, [brand, productId, product, form])

  // When product picked: pre-fill term, weekly price, commission, title.
  useEffect(() => {
    if (!product) return
    form.setValue('term_months', product.default_term_months)
    form.setValue('weekly_price', product.weekly_price_aud)
    form.setValue('commission_pct', product.default_commission_pct)
    if (defaultTitleSeed && !form.getValues('title')) {
      form.setValue('title', `${defaultTitleSeed} × ${product.label}`)
    } else if (!form.getValues('title')) {
      form.setValue('title', product.label)
    }
  }, [product, defaultTitleSeed, form])

  // Pre-fill stage_id with first stage if not set
  useEffect(() => {
    if (!form.getValues('stage_id') && stages && stages.length > 0) {
      form.setValue('stage_id', stages[0].id)
    }
  }, [stages, form])

  const financials = useMemo(() => {
    if (!weekly || !term || pct == null) return null
    return computeFinancials(Number(weekly), Number(term), Number(pct))
  }, [weekly, term, pct])

  const overridePct = product
    ? ((Number(weekly) - product.weekly_price_aud) / product.weekly_price_aud) * 100
    : 0
  const isOverridden = !!product && Math.abs(overridePct) > 0.01
  const overrideTone = overridePct > 0 ? 'mint' : 'amber'

  function onInvalid(errors: FieldErrors<PackageDealValues>) {
    console.error('[PackageDealForm] validation failed:', errors)
  }

  return (
    <form
      onSubmit={form.handleSubmit(onSubmit, onInvalid)}
      className="space-y-3"
    >
      {Object.keys(form.formState.errors).length > 0 && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          Please fix the highlighted fields before saving.
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label>Brand *</Label>
          <Select
            value={brand}
            onValueChange={(v) => form.setValue('brand', v as SellableBrand)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="purezza">Purezza</SelectItem>
              <SelectItem value="culligan">Culligan</SelectItem>
              <SelectItem value="zip">Zip HydroTap</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label>Package *</Label>
          <Select
            value={productId}
            onValueChange={(v) => form.setValue('product_id', v)}
          >
            <SelectTrigger
              className={cn(form.formState.errors.product_id && 'border-destructive')}
            >
              <SelectValue placeholder="Select package" />
            </SelectTrigger>
            <SelectContent>
              {filteredProducts.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.label} · ${p.weekly_price_aud.toFixed(2)}/wk
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {form.formState.errors.product_id && (
            <p className="text-xs text-destructive">{form.formState.errors.product_id.message}</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-1">
          <Label>Term *</Label>
          <Select
            value={String(term)}
            onValueChange={(v) => form.setValue('term_months', Number(v))}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TERMS.map((t) => (
                <SelectItem key={t} value={String(t)}>
                  {t} mo
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label>Weekly $ *</Label>
          <div className="relative">
            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-faint text-sm">$</span>
            <Input
              type="number"
              step="0.01"
              min={0}
              className="pl-5"
              {...form.register('weekly_price', { valueAsNumber: true })}
            />
          </div>
          {isOverridden && product && (
            <p
              className={cn(
                'text-[11px] jordan-tnum',
                overrideTone === 'mint'
                  ? 'text-[color:var(--jordan-accent-mint)]'
                  : 'text-[color:var(--jordan-warm-text)]',
              )}
            >
              {overridePct > 0 ? '+' : ''}
              {overridePct.toFixed(1)}% vs catalogue
            </p>
          )}
        </div>

        <div className="space-y-1">
          <Label>Commission %</Label>
          <Input
            type="number"
            step="0.01"
            min={0}
            max={100}
            {...form.register('commission_pct', { valueAsNumber: true })}
          />
        </div>
      </div>

      {/* Live readouts panel */}
      <div className="rounded-[10px] border border-[color:var(--jordan-accent-mint)]/30 bg-[color:var(--jordan-accent-mint-soft)] p-3">
        <CapsLabel className="text-[color:var(--jordan-success-text)]">
          Deal financials
        </CapsLabel>
        <div className="mt-2 grid grid-cols-3 gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-[var(--jordan-tracking-label)] text-ink-muted">ACV</p>
            <MetricNumber
              value={financials?.acv ?? null}
              format="currency"
              minimumFractionDigits={2}
              maximumFractionDigits={2}
              className="text-[18px] font-semibold text-ink"
            />
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-[var(--jordan-tracking-label)] text-ink-muted">
              TCV ({term ?? '—'} mo)
            </p>
            <MetricNumber
              value={financials?.tcv ?? null}
              format="currency"
              minimumFractionDigits={2}
              maximumFractionDigits={2}
              className="text-[18px] font-semibold text-ink"
            />
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-[var(--jordan-tracking-label)] text-ink-muted">
              Commission ({pct?.toFixed(1) ?? '—'}%)
            </p>
            <MetricNumber
              value={financials?.commission ?? null}
              format="currency"
              minimumFractionDigits={2}
              maximumFractionDigits={2}
              className="text-[18px] font-semibold text-ink"
            />
          </div>
        </div>
      </div>

      <div className="space-y-1">
        <Label>Stage *</Label>
        <Select
          value={form.watch('stage_id') ?? ''}
          onValueChange={(v) => form.setValue('stage_id', v)}
        >
          <SelectTrigger
            className={cn(form.formState.errors.stage_id && 'border-destructive')}
          >
            <SelectValue placeholder="Select stage" />
          </SelectTrigger>
          <SelectContent>
            {stages?.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {form.formState.errors.stage_id && (
          <p className="text-xs text-destructive">{form.formState.errors.stage_id.message}</p>
        )}
      </div>

      <div className="space-y-1">
        <Label>Title *</Label>
        <Input
          {...form.register('title')}
          placeholder={`e.g. The Espy × ${brandLabel(brand)}`}
          className={cn(form.formState.errors.title && 'border-destructive')}
        />
        {form.formState.errors.title && (
          <p className="text-xs text-destructive">{form.formState.errors.title.message}</p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label>Follow-up due</Label>
          <Input type="date" {...form.register('follow_up_due')} />
        </div>
        <div />
      </div>

      <div className="space-y-1">
        <Label>Notes</Label>
        <Textarea {...form.register('notes')} rows={2} />
      </div>

      <div className="flex gap-2 pt-1">
        <Button
          type="button"
          variant="outline"
          className="flex-1"
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button type="submit" className="flex-1" disabled={!!submitting}>
          {submitting ? 'Saving…' : submitLabel}
        </Button>
      </div>
    </form>
  )
}
