import { useState, useMemo, useEffect, useRef } from 'react'
import {
  DndContext,
  type DragEndEvent,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
} from '@dnd-kit/core'
import {
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useDeals, useUpdateDeal, useCreateDeal, type Deal } from '@/lib/queries/deals'
import { useStages } from '@/lib/queries/stages'
import { useContacts } from '@/lib/queries/contacts'
import { useAuth } from '@/hooks/useAuth'
import { cn } from '@/lib/utils'
import { DealCard } from './DealCard'
import { DealDrawer } from './DealDrawer'
import { MarkOutcomeDialog } from './MarkOutcomeDialog'
import { ProductPicker } from './ProductPicker'
import type { Product } from '@/lib/queries/products'
import { MetricNumber, ErrorAlert } from '@/components/primitives'
import { Plus } from 'lucide-react'
import { useForm, type FieldErrors } from 'react-hook-form'
import { toast } from 'sonner'
import { zodResolver } from '@hookform/resolvers/zod'
import { dealFormSchema, DEAL_VALUE_WARN, type DealFormValues } from '@/lib/schemas/deal'
import { dealHeadlineValue, type DealFinancialRow } from '@/lib/queries/pipelineFinancials'
import { cleanDealTitle } from '@/lib/dealTitle'

export interface KanbanBoardProps {
  /** Filter kanban to a single stage column (deep-link from Pipeline Health). */
  stageFilter?: string | null
  /**
   * Restrict deals to a set of ids (deep-link from "Qualified meetings ·
   * this week" KPI). Match is OR-applied with `contactIdAllowlist`.
   */
  dealIdAllowlist?: Set<string> | null
  contactIdAllowlist?: Set<string> | null
  /** Auto-open DealDrawer for this deal id (deep-link from /pipeline?deal=<id>). */
  focusDealId?: string | null
  /** When true, include currently-snoozed deals (otherwise hidden by default). */
  includeSnoozed?: boolean
  /** Optional ordering — 'stalest' sorts each column by days_since_last_activity desc. */
  sortBy?: 'default' | 'stalest'
}

export function KanbanBoard({
  stageFilter = null,
  dealIdAllowlist = null,
  contactIdAllowlist = null,
  focusDealId = null,
  includeSnoozed = false,
  sortBy = 'default',
}: KanbanBoardProps = {}) {
  const { user } = useAuth()
  const { data: stages } = useStages()
  const { data: deals, isLoading, error } = useDeals({ includeSnoozed })
  const { data: contacts } = useContacts()
  const updateDeal = useUpdateDeal()
  const createDeal = useCreateDeal()

  const [localDeals, setLocalDeals] = useState<Deal[] | null>(null)
  const [activeDeal, setActiveDeal] = useState<Deal | null>(null)
  const [selectedDeal, setSelectedDeal] = useState<Deal | null>(null)
  const [quickAddStageId, setQuickAddStageId] = useState<string | null>(null)
  const [quickAddProductId, setQuickAddProductId] = useState<string | null>(null)
  const [quickAddProductTouched, setQuickAddProductTouched] = useState(false)
  const [outcomeIntent, setOutcomeIntent] = useState<{
    deal: Deal
    initialOutcome: 'won' | 'lost'
    pendingStageId: string | null
  } | null>(null)

  const allDeals = localDeals ?? deals ?? []
  const displayDeals = useMemo(() => {
    let rows = allDeals
    if (dealIdAllowlist || contactIdAllowlist) {
      rows = rows.filter(
        (d) =>
          (dealIdAllowlist && dealIdAllowlist.has(d.id)) ||
          (contactIdAllowlist && d.contact_id && contactIdAllowlist.has(d.contact_id)),
      )
    }
    return rows
  }, [allDeals, dealIdAllowlist, contactIdAllowlist])

  const visibleStages = useMemo(() => {
    if (!stages) return []
    if (!stageFilter) return stages
    return stages.filter((s) => s.id === stageFilter)
  }, [stages, stageFilter])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  )

  // No default deal value — the $800 placeholder polluted every import and
  // KPI. Value stays empty until Jordan actually knows the number.
  const form = useForm<DealFormValues>({
    resolver: zodResolver(dealFormSchema),
  })

  // Board-level filters: temperature, outreach status, source.
  const [tempFilter, setTempFilter] = useState<'all' | 'hot' | 'warm' | 'cold'>('all')
  const [outreachFilter, setOutreachFilter] = useState<'all' | 'enrolled' | 'replied' | 'not_contacted'>('all')
  const [sourceFilter, setSourceFilter] = useState<'all' | 'pst' | 'other'>('all')
  const filtersActive = tempFilter !== 'all' || outreachFilter !== 'all' || sourceFilter !== 'all'

  const filteredDeals = useMemo(() => {
    return displayDeals.filter((d) => {
      if (tempFilter !== 'all' && d.temperature !== tempFilter) return false
      if (outreachFilter === 'enrolled' && !(d.enrollment && (d.enrollment.status === 'active' || d.enrollment.status === 'paused'))) return false
      if (outreachFilter === 'replied' && !d.has_replied) return false
      if (outreachFilter === 'not_contacted' && (d.last_contact_at || d.has_replied || d.enrollment)) return false
      const isPst = !!d.notes?.includes('[purezza-pst-promote]')
      if (sourceFilter === 'pst' && !isPst) return false
      if (sourceFilter === 'other' && isPst) return false
      return true
    })
  }, [displayDeals, tempFilter, outreachFilter, sourceFilter])

  const dealsByStage = useMemo(() => {
    const map: Record<string, Deal[]> = {}
    for (const stage of stages ?? []) {
      const cards = filteredDeals.filter((d) => d.stage_id === stage.id)
      if (sortBy === 'stalest') {
        cards.sort(
          (a, b) =>
            (b.days_since_last_activity ?? 0) - (a.days_since_last_activity ?? 0),
        )
      }
      map[stage.id] = cards
    }
    return map
  }, [filteredDeals, stages, sortBy])

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    setActiveDeal(null)

    if (!over || active.id === over.id) return

    const dealId = String(active.id)
    const movedDeal = displayDeals.find((d) => d.id === dealId)
    if (!movedDeal) return

    // Determine target stage: over could be a stage id or deal id
    let targetStageId: string | null = null

    // Check if over.id is a stage id
    if (stages?.find((s) => s.id === String(over.id))) {
      targetStageId = String(over.id)
    } else {
      // over.id is a deal id — use its stage
      const overDeal = displayDeals.find((d) => d.id === String(over.id))
      if (overDeal) targetStageId = overDeal.stage_id
    }

    if (!targetStageId || targetStageId === movedDeal.stage_id) return

    const fromStage = stages?.find((s) => s.id === movedDeal.stage_id)
    const toStage = stages?.find((s) => s.id === targetStageId)
    const toName = toStage?.name ?? ''
    // Post-consolidation there are exactly two closed stages: Closed (won)
    // and Lost — so "closed and not lost" IS the won column.
    const isLostTarget = !!toStage?.is_closed && /lost/i.test(toName)
    const isWonTarget = !!toStage?.is_closed && !isLostTarget

    // Drop onto a Closed/Lost column: defer the stage move and open the
    // outcome dialog so Jordan confirms final value + close date. The mutation
    // commits the stage_id atomically with the outcome.
    if (isWonTarget || isLostTarget) {
      setOutcomeIntent({
        deal: movedDeal,
        initialOutcome: isWonTarget ? 'won' : 'lost',
        pendingStageId: targetStageId,
      })
      return
    }

    // Optimistic update
    const snapshot = localDeals ?? deals ?? []
    setLocalDeals(
      snapshot.map((d) =>
        d.id === dealId ? { ...d, stage_id: targetStageId } : d
      )
    )

    updateDeal.mutate(
      {
        id: dealId,
        org_id: movedDeal.org_id,
        stage_id: targetStageId,
        from_stage: fromStage?.name,
        to_stage: toStage?.name,
      },
      {
        onError: () => {
          // Rollback
          setLocalDeals(snapshot)
        },
        onSuccess: () => {
          setLocalDeals(null)
        },
      }
    )
  }

  async function handleQuickAdd(values: DealFormValues) {
    if (!user || !quickAddStageId) return
    if (!quickAddProductId) {
      setQuickAddProductTouched(true)
      toast.error('Pick a product to add the deal')
      return
    }
    if (
      values.contract_value != null &&
      values.contract_value > DEAL_VALUE_WARN &&
      !window.confirm(
        `${values.contract_value.toLocaleString('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 })} — that's a big number. Sure?`,
      )
    ) {
      return
    }
    await createDeal.mutateAsync({
      org_id: user.org_id,
      // SOURCE FIX: strip any suffix patterns from user-typed titles
      // e.g. Jordan might paste "The Espy — Purezza intro" into the quick-add
      title: cleanDealTitle(values.title),
      stage_id: quickAddStageId,
      contact_id: values.contact_id,
      contract_value: values.contract_value,
      product_id: quickAddProductId,
    })
    setQuickAddStageId(null)
    setQuickAddProductId(null)
    setQuickAddProductTouched(false)
    form.reset({})
  }

  function handleQuickAddProduct(productId: string, product: Product) {
    setQuickAddProductId(productId)
    setQuickAddProductTouched(true)
    const t = (form.getValues('title') ?? '').trim()
    if (t === '' || t === 'Purezza filtration') {
      form.setValue('title', product.label, { shouldValidate: true })
    }
  }

  function onQuickAddInvalid(errors: FieldErrors<DealFormValues>) {
    console.error('[KanbanBoard.handleQuickAdd] validation failed:', errors)
    const first = Object.entries(errors)[0]
    if (first) {
      const [field, err] = first
      const message = (err as { message?: string })?.message ?? 'Invalid value'
      toast.error('Cannot add deal — check the form', {
        description: `${field}: ${message}`,
      })
    }
  }

  // Auto-open DealDrawer when ?deal=<id> deep-link is provided.
  // Track which id we've already auto-opened to avoid re-opening after close.
  const autoOpenedDealRef = useRef<string | null>(null)
  useEffect(() => {
    if (!focusDealId || !deals) return
    if (autoOpenedDealRef.current === focusDealId) return
    const target = deals.find((d) => d.id === focusDealId)
    if (target) {
      autoOpenedDealRef.current = focusDealId
      setSelectedDeal(target)
    }
  }, [focusDealId, deals])

  if (isLoading) {
    return (
      <div className="flex gap-4 p-4 overflow-x-auto">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="w-[300px] shrink-0 rounded-[10px] border border-hairline bg-surface-2 animate-pulse"
          >
            <div className="p-3 border-b border-hairline">
              <div className="h-3 w-24 rounded-[2px] bg-surface-4" />
            </div>
            <div className="p-2 space-y-2">
              {Array.from({ length: 2 + (i % 3) }).map((__, j) => (
                <div
                  key={j}
                  className="rounded-[6px] border border-hairline bg-surface-1 p-3 space-y-1.5"
                >
                  <div className="h-3 w-full rounded-[2px] bg-surface-4" />
                  <div className="h-2.5 w-2/3 rounded-[2px] bg-surface-4" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    )
  }
  if (error) {
    return (
      <div className="p-4">
        <ErrorAlert title="Couldn't load pipeline" error={error} />
      </div>
    )
  }

  return (
    <>
      {/* Board-level filter row */}
      <div className="flex items-center gap-2 flex-wrap px-4 sm:px-6 pb-2">
        <FilterChipGroup
          label="Heat"
          value={tempFilter}
          onChange={(v) => setTempFilter(v as typeof tempFilter)}
          options={[
            { value: 'all', label: 'All' },
            { value: 'hot', label: '🔥 Hot' },
            { value: 'warm', label: 'Warm' },
            { value: 'cold', label: 'Cold' },
          ]}
        />
        <FilterChipGroup
          label="Outreach"
          value={outreachFilter}
          onChange={(v) => setOutreachFilter(v as typeof outreachFilter)}
          options={[
            { value: 'all', label: 'All' },
            { value: 'enrolled', label: 'In sequence' },
            { value: 'replied', label: 'Replied' },
            { value: 'not_contacted', label: 'Not contacted' },
          ]}
        />
        <FilterChipGroup
          label="Source"
          value={sourceFilter}
          onChange={(v) => setSourceFilter(v as typeof sourceFilter)}
          options={[
            { value: 'all', label: 'All' },
            { value: 'pst', label: 'Mailbox import' },
            { value: 'other', label: 'Other' },
          ]}
        />
        {filtersActive && (
          <button
            type="button"
            className="text-[11px] text-ink-muted underline hover:text-ink"
            onClick={() => {
              setTempFilter('all')
              setOutreachFilter('all')
              setSourceFilter('all')
            }}
          >
            Clear ({filteredDeals.length}/{displayDeals.length} shown)
          </button>
        )}
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={({ active }) => {
          const deal = displayDeals.find((d) => d.id === String(active.id))
          setActiveDeal(deal ?? null)
        }}
        onDragEnd={handleDragEnd}
      >
        <div className="flex gap-4 overflow-x-auto pb-4 px-4 sm:px-6 h-full min-h-0">
          {visibleStages.map((stage) => {
            const stageDeals = dealsByStage[stage.id] ?? []
            // NULL-valued deals contribute nothing to the column sum (KPI
            // integrity) — headline basis matches the dashboard (acv fallback).
            const totalValue = stageDeals.reduce(
              (sum, d) => sum + dealHeadlineValue(d as unknown as DealFinancialRow),
              0
            )
            const isActiveTarget = activeDeal != null && activeDeal.stage_id !== stage.id
            // "Hold for Next Month" is a utility column, not a pipeline stage —
            // visually de-emphasised so the 8 real stages carry the eye.
            const isUtilityColumn = stage.name === 'Hold for Next Month'

            return (
              <div
                key={stage.id}
                className={cn(
                  // Notion-calm columns: soft grey bg, generous gutters, light border
                  'flex flex-col w-[280px] shrink-0 rounded-[10px] border bg-[#f7f7f6] dark:bg-surface-2 transition-colors',
                  isActiveTarget
                    ? 'border-brand bg-brand-soft'
                    : 'border-[#e8e8e8] dark:border-hairline',
                  isUtilityColumn && !isActiveTarget && 'border-dashed opacity-65 hover:opacity-100',
                )}
              >
                {/* Column header — neutral, no per-stage colour wash.
                 * Stage identity lives in the header text + dot only. */}
                <div
                  className="flex items-center justify-between gap-2 px-3.5 pt-3 pb-2.5 rounded-t-[10px] border-b border-hairline"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      {stage.color && (
                        <span
                          className="size-2 rounded-full shrink-0"
                          style={{ backgroundColor: stage.color }}
                        />
                      )}
                      <span className="text-[11px] uppercase tracking-[var(--jordan-tracking-label)] font-semibold text-ink truncate">
                        {stage.name}
                      </span>
                      <span className="ml-auto inline-flex h-[18px] min-w-[22px] items-center justify-center rounded-[4px] bg-surface-4 px-1 text-[10px] font-semibold jordan-tnum text-ink-muted">
                        {stageDeals.length}
                      </span>
                    </div>
                    <div className="mt-1 text-[11px] text-ink-faint">
                      <MetricNumber value={totalValue} format="currency" className="text-[11px]" />
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 shrink-0"
                    onClick={() => {
                      setQuickAddStageId(stage.id)
                      form.setValue('stage_id', stage.id)
                    }}
                    title="Add deal"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </Button>
                </div>

                {/* Cards */}
                {/* Cards — vertical gap 12px (space-y-3) per Notion-calm brief */}
                <div className="flex-1 overflow-y-auto p-3 space-y-3 min-h-[80px]">
                  <SortableContext
                    items={stageDeals.map((d) => d.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    {stageDeals.length === 0 && (
                      <div className="rounded-[6px] border border-dashed border-hairline p-4 text-center">
                        <p className="text-[11px] text-ink-faint">No deals</p>
                      </div>
                    )}
                    {stageDeals.map((deal) => (
                      <DealCard
                        key={deal.id}
                        deal={deal}
                        onClick={() => setSelectedDeal(deal)}
                      />
                    ))}
                  </SortableContext>
                </div>
              </div>
            )
          })}
        </div>

        <DragOverlay>
          {activeDeal && (
            <div className="opacity-90 rotate-2">
              <DealCard
                deal={activeDeal}
                onClick={() => {}}
              />
            </div>
          )}
        </DragOverlay>
      </DndContext>

      {/* Deal detail drawer */}
      {selectedDeal && (
        <DealDrawer
          deal={selectedDeal}
          open={!!selectedDeal}
          onClose={() => setSelectedDeal(null)}
        />
      )}

      {/* Mark Won / Lost — opened by drag-onto-closed or drawer button */}
      <MarkOutcomeDialog
        deal={outcomeIntent?.deal ?? null}
        initialOutcome={outcomeIntent?.initialOutcome ?? 'won'}
        pendingStageId={outcomeIntent?.pendingStageId ?? null}
        open={!!outcomeIntent}
        onClose={() => setOutcomeIntent(null)}
      />

      {/* Quick-add dialog */}
      <Dialog
        open={!!quickAddStageId}
        onOpenChange={(v) => {
          if (!v) {
            setQuickAddStageId(null)
            setQuickAddProductId(null)
            setQuickAddProductTouched(false)
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              Add deal — {stages?.find((s) => s.id === quickAddStageId)?.name}
            </DialogTitle>
          </DialogHeader>
          <form
            onSubmit={form.handleSubmit(handleQuickAdd, onQuickAddInvalid)}
            className="space-y-3 mt-2"
          >
            {Object.keys(form.formState.errors).length > 0 && (
              <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                Please fix the highlighted fields before saving.
              </div>
            )}
            <div className="space-y-1">
              <Label htmlFor="quick-add-product">Product *</Label>
              <ProductPicker
                id="quick-add-product"
                value={quickAddProductId}
                onChange={handleQuickAddProduct}
                invalid={quickAddProductTouched && !quickAddProductId}
              />
              {quickAddProductTouched && !quickAddProductId && (
                <p className="text-xs text-destructive">Pick a product.</p>
              )}
            </div>
            <div className="space-y-1">
              <Label>Title *</Label>
              <Input
                {...form.register('title')}
                placeholder="e.g. Purezza x The Espy"
                className={cn(form.formState.errors.title && 'border-destructive')}
              />
              <p className="text-[11px] text-ink-faint">
                Title auto-fills from product when blank.
              </p>
              {form.formState.errors.title && (
                <p className="text-xs text-destructive">
                  {form.formState.errors.title.message}
                </p>
              )}
            </div>
            <div className="space-y-1">
              <Label>Contact</Label>
              <Select
                value={form.watch('contact_id') ?? ''}
                onValueChange={(v) => form.setValue('contact_id', v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="— optional —" />
                </SelectTrigger>
                <SelectContent>
                  {contacts?.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.full_name}
                      {c.venue?.name ? ` — ${c.venue.name}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Contract value (AUD)</Label>
              <Input
                type="number"
                min={0}
                {...form.register('contract_value')}
              />
            </div>
            <div className="flex gap-2 pt-1">
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                onClick={() => {
                  setQuickAddStageId(null)
                  setQuickAddProductId(null)
                  setQuickAddProductTouched(false)
                }}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                className="flex-1"
                disabled={createDeal.isPending}
              >
                {createDeal.isPending ? 'Adding…' : 'Add deal'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

/**
 * Compact labelled chip-toggle group for the board filter row. Single-select;
 * "All" clears. Kept local — Pipeline is the only board-density surface.
 */
function FilterChipGroup({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: Array<{ value: string; label: string }>
}) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-[10px] uppercase tracking-[var(--jordan-tracking-label)] text-ink-faint">
        {label}
      </span>
      <div className="inline-flex rounded-[6px] border border-hairline bg-surface-1 p-0.5">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={cn(
              'h-6 rounded-[4px] px-2 text-[11px] font-medium transition-colors',
              value === o.value
                ? 'bg-[color:var(--jordan-accent-soft)] text-[color:var(--jordan-accent-hover)]'
                : 'text-ink-muted hover:text-ink hover:bg-surface-3',
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}
