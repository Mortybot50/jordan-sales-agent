import { useState, useMemo, useEffect, useRef, type ReactNode } from 'react'
import {
  DndContext,
  type DragEndEvent,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  useDroppable,
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
import { useStages, type PipelineStage } from '@/lib/queries/stages'
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

// Hybrid column model: 3 virtual temperature columns + the discrete outcome
// stages, left→right. Active leads live in their temperature column; once a
// deal reaches an outcome stage it moves into that outcome column.
const OUTCOME_STAGE_NAMES = ['Site Visit', 'Proposal Sent', 'Closed', 'Installed', 'Lost'] as const
const TEMP_ORDER = ['cold', 'warm', 'hot'] as const
type TempKey = (typeof TEMP_ORDER)[number]
const TEMP_META: Record<TempKey, { label: string; color: string }> = {
  cold: { label: 'Cold', color: '#60a5fa' },
  warm: { label: 'Warm', color: '#f59e0b' },
  hot: { label: 'Hot', color: '#ef4444' },
}
const tempColumnId = (t: TempKey) => `temp:${t}`

type BoardColumn =
  | { id: string; kind: 'temperature'; temp: TempKey; name: string; color: string }
  | { id: string; kind: 'stage'; stage: PipelineStage; name: string; color: string | null }

/** Droppable wrapper so cards can be dropped onto a column (incl. empty ones). */
function DroppableColumn({
  id,
  className,
  isOver,
  children,
}: {
  id: string
  className?: string
  isOver?: (over: boolean) => string
  children: ReactNode
}) {
  const { setNodeRef, isOver: over } = useDroppable({ id })
  return (
    <div ref={setNodeRef} className={cn(className, isOver?.(over))}>
      {children}
    </div>
  )
}

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
  const [quickAddColumn, setQuickAddColumn] = useState<BoardColumn | null>(null)
  const [quickAddProductId, setQuickAddProductId] = useState<string | null>(null)
  const [quickAddProductTouched, setQuickAddProductTouched] = useState(false)
  const [outcomeIntent, setOutcomeIntent] = useState<{
    deal: Deal
    initialOutcome: 'won' | 'lost' | 'installed'
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

  // Build the hybrid column list: 3 temperature columns then the outcome
  // stages in canonical order.
  const columns = useMemo<BoardColumn[]>(() => {
    const tempCols: BoardColumn[] = TEMP_ORDER.map((t) => ({
      id: tempColumnId(t),
      kind: 'temperature',
      temp: t,
      name: TEMP_META[t].label,
      color: TEMP_META[t].color,
    }))
    const outcomeCols: BoardColumn[] = (stages ?? [])
      .filter((s) => (OUTCOME_STAGE_NAMES as readonly string[]).includes(s.name))
      .sort(
        (a, b) =>
          OUTCOME_STAGE_NAMES.indexOf(a.name as (typeof OUTCOME_STAGE_NAMES)[number]) -
          OUTCOME_STAGE_NAMES.indexOf(b.name as (typeof OUTCOME_STAGE_NAMES)[number]),
      )
      .map((s) => ({ id: s.id, kind: 'stage', stage: s, name: s.name, color: s.color }))
    return [...tempCols, ...outcomeCols]
  }, [stages])

  // Set of stage ids that own their own outcome column.
  const outcomeStageIds = useMemo(
    () => new Set(columns.filter((c) => c.kind === 'stage').map((c) => c.id)),
    [columns],
  )

  // A deal sits in its outcome stage column if it has one; otherwise its
  // temperature bucket (NULL temperature → cold).
  const columnIdForDeal = useMemo(() => {
    return (d: Deal): string => {
      if (d.stage_id && outcomeStageIds.has(d.stage_id)) return d.stage_id
      const t = (d.temperature ?? 'cold') as TempKey
      return tempColumnId(TEMP_ORDER.includes(t) ? t : 'cold')
    }
  }, [outcomeStageIds])

  // Deep-link stage filter (a real stage id from Pipeline Health). An
  // outcome-stage id narrows to that single column. A non-outcome stage id
  // (New/Contacted/Replied/Meeting Booked) has no column of its own — those
  // deals live in their temperature columns — so show the temperature columns
  // and let filteredDeals narrow the cards to that stage_id.
  const visibleColumns = useMemo(() => {
    if (!stageFilter) return columns
    const outcomeMatch = columns.filter((c) => c.id === stageFilter)
    if (outcomeMatch.length > 0) return outcomeMatch
    return columns.filter((c) => c.kind === 'temperature')
  }, [columns, stageFilter])

  // Map a stage_id → the natural outreach stage a reopened deal should land in,
  // so it renders in its temperature column again. Replied > Contacted > New.
  function naturalStageId(d: Deal): string | null {
    const want = d.has_replied ? 'Replied' : (d.last_contact_at ? 'Contacted' : 'New')
    return (
      stages?.find((s) => s.name === want)?.id ??
      stages?.find((s) => s.name === 'New')?.id ??
      null
    )
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  )

  // No default deal value — the $800 placeholder polluted every import and
  // KPI. Value stays empty until Jordan actually knows the number.
  const form = useForm<DealFormValues>({
    resolver: zodResolver(dealFormSchema),
  })

  // Board-level filters: outreach status, source. (Heat filter removed —
  // temperature now IS the column axis.)
  const [outreachFilter, setOutreachFilter] = useState<'all' | 'enrolled' | 'replied' | 'not_contacted'>('all')
  const [sourceFilter, setSourceFilter] = useState<'all' | 'pst' | 'other'>('all')
  const filtersActive = outreachFilter !== 'all' || sourceFilter !== 'all'

  const filteredDeals = useMemo(() => {
    return displayDeals.filter((d) => {
      // Deep-link stage filter narrows cards to that stage_id (honours
      // non-outcome stage links that have no column of their own).
      if (stageFilter && d.stage_id !== stageFilter) return false
      if (outreachFilter === 'enrolled' && !(d.enrollment && (d.enrollment.status === 'active' || d.enrollment.status === 'paused'))) return false
      if (outreachFilter === 'replied' && !d.has_replied) return false
      if (outreachFilter === 'not_contacted' && (d.last_contact_at || d.has_replied || d.enrollment)) return false
      const isPst = !!d.notes?.includes('[purezza-pst-promote]')
      if (sourceFilter === 'pst' && !isPst) return false
      if (sourceFilter === 'other' && isPst) return false
      return true
    })
  }, [displayDeals, outreachFilter, sourceFilter, stageFilter])

  const dealsByColumn = useMemo(() => {
    const map: Record<string, Deal[]> = {}
    for (const c of columns) map[c.id] = []
    for (const d of filteredDeals) {
      const cid = columnIdForDeal(d)
      if (!map[cid]) map[cid] = []
      map[cid].push(d)
    }
    if (sortBy === 'stalest') {
      for (const k of Object.keys(map)) {
        map[k].sort(
          (a, b) =>
            (b.days_since_last_activity ?? 0) - (a.days_since_last_activity ?? 0),
        )
      }
    }
    return map
  }, [filteredDeals, columns, columnIdForDeal, sortBy])

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    setActiveDeal(null)

    if (!over || active.id === over.id) return

    const dealId = String(active.id)
    const movedDeal = displayDeals.find((d) => d.id === dealId)
    if (!movedDeal) return

    // Resolve the target column: over.id is either a column id or a deal id.
    let targetColId: string | null = null
    if (columns.find((c) => c.id === String(over.id))) {
      targetColId = String(over.id)
    } else {
      const overDeal = displayDeals.find((d) => d.id === String(over.id))
      if (overDeal) targetColId = columnIdForDeal(overDeal)
    }
    if (!targetColId) return

    const fromColId = columnIdForDeal(movedDeal)
    if (targetColId === fromColId) return

    const targetCol = columns.find((c) => c.id === targetColId)
    if (!targetCol) return

    const fromStage = stages?.find((s) => s.id === movedDeal.stage_id)
    const wasOutcome = !!movedDeal.stage_id && outcomeStageIds.has(movedDeal.stage_id)

    // ── Dropped onto a TEMPERATURE column ───────────────────────────────
    // Changes the deal's temperature (manual, so the classifier won't clobber).
    // If it was in an outcome column, also reopen it: reset to a natural
    // outreach stage and clear any won/lost outcome.
    if (targetCol.kind === 'temperature') {
      const newTemp = targetCol.temp
      const reopenStageId = wasOutcome ? naturalStageId(movedDeal) : movedDeal.stage_id
      const dbUpdates: Partial<Deal> = {
        temperature: newTemp,
        temperature_source: 'manual',
      }
      if (wasOutcome) {
        dbUpdates.stage_id = reopenStageId
        if (movedDeal.outcome) {
          dbUpdates.outcome = null
          dbUpdates.closed_at = null
          dbUpdates.close_won_at = null
        }
      }

      const snapshot = localDeals ?? deals ?? []
      setLocalDeals(
        snapshot.map((d) => (d.id === dealId ? { ...d, ...dbUpdates } : d)),
      )
      updateDeal.mutate(
        { id: dealId, org_id: movedDeal.org_id, ...dbUpdates },
        {
          onError: () => setLocalDeals(snapshot),
          onSuccess: () => setLocalDeals(null),
        },
      )
      return
    }

    // ── Dropped onto an OUTCOME stage column ────────────────────────────
    const toStage = targetCol.stage
    const toName = toStage.name

    // Closed / Lost / Installed all open the outcome dialog so Jordan confirms
    // value + date; the mutation commits the stage_id atomically.
    if (toName === 'Closed' || toName === 'Lost' || toName === 'Installed') {
      setOutcomeIntent({
        deal: movedDeal,
        initialOutcome: toName === 'Lost' ? 'lost' : toName === 'Installed' ? 'installed' : 'won',
        pendingStageId: toStage.id,
      })
      return
    }

    // Site Visit / Proposal Sent — direct stage move. Proposal Sent stamps
    // proposal_sent_at (if unset). Moving off a won/lost outcome clears it.
    const dbUpdates: Partial<Deal> = { stage_id: toStage.id }
    if (toName === 'Proposal Sent' && !movedDeal.proposal_sent_at) {
      dbUpdates.proposal_sent_at = new Date().toISOString()
    }
    if (movedDeal.outcome) {
      dbUpdates.outcome = null
      dbUpdates.closed_at = null
      dbUpdates.close_won_at = null
    }

    const snapshot = localDeals ?? deals ?? []
    setLocalDeals(
      snapshot.map((d) => (d.id === dealId ? { ...d, ...dbUpdates } : d)),
    )
    updateDeal.mutate(
      {
        id: dealId,
        org_id: movedDeal.org_id,
        ...dbUpdates,
        from_stage: fromStage?.name,
        to_stage: toName,
      },
      {
        onError: () => setLocalDeals(snapshot),
        onSuccess: () => setLocalDeals(null),
      },
    )
  }

  async function handleQuickAdd(values: DealFormValues) {
    if (!user || !quickAddColumn) return
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
    const col = quickAddColumn
    // Temperature columns aren't real stages — new leads start in "New" and
    // carry the column's temperature (manual).
    const stageId =
      col.kind === 'stage' ? col.id : (stages?.find((s) => s.name === 'New')?.id ?? null)
    if (!stageId) {
      toast.error('No stage available to add into')
      return
    }
    const created = await createDeal.mutateAsync({
      org_id: user.org_id,
      // SOURCE FIX: strip any suffix patterns from user-typed titles
      // e.g. Jordan might paste "The Espy — Purezza intro" into the quick-add
      title: cleanDealTitle(values.title),
      stage_id: stageId,
      contact_id: values.contact_id,
      contract_value: values.contract_value,
      product_id: quickAddProductId,
    })
    if (col.kind === 'temperature' && created?.id) {
      await updateDeal.mutateAsync({
        id: created.id,
        org_id: user.org_id,
        temperature: col.temp,
        temperature_source: 'manual',
      })
    }
    setQuickAddColumn(null)
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
          {visibleColumns.map((column) => {
            const columnDeals = dealsByColumn[column.id] ?? []
            // NULL-valued deals contribute nothing to the column sum (KPI
            // integrity) — headline basis matches the dashboard (acv fallback).
            const totalValue = columnDeals.reduce(
              (sum, d) => sum + dealHeadlineValue(d as unknown as DealFinancialRow),
              0
            )
            const activeFromCol = activeDeal ? columnIdForDeal(activeDeal) : null
            const isActiveTarget = activeDeal != null && activeFromCol !== column.id
            const dotColor = column.color ?? '#94a3b8'

            return (
              <DroppableColumn
                key={column.id}
                id={column.id}
                isOver={(over) => (over ? 'border-brand bg-brand-soft' : '')}
                className={cn(
                  // Notion-calm columns: soft grey bg, generous gutters, light border
                  'flex flex-col w-[280px] shrink-0 rounded-[10px] border bg-[#f7f7f6] dark:bg-surface-2 transition-colors',
                  isActiveTarget
                    ? 'border-brand bg-brand-soft'
                    : 'border-[#e8e8e8] dark:border-hairline',
                )}
              >
                {/* Column header — neutral, no per-column colour wash.
                 * Column identity lives in the header text + dot only. */}
                <div
                  className="flex items-center justify-between gap-2 px-3.5 pt-3 pb-2.5 rounded-t-[10px] border-b border-hairline"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span
                        className="size-2 rounded-full shrink-0"
                        style={{ backgroundColor: dotColor }}
                      />
                      <span className="text-[11px] uppercase tracking-[var(--jordan-tracking-label)] font-semibold text-ink truncate">
                        {column.name}
                      </span>
                      <span className="ml-auto inline-flex h-[18px] min-w-[22px] items-center justify-center rounded-[4px] bg-surface-4 px-1 text-[10px] font-semibold jordan-tnum text-ink-muted">
                        {columnDeals.length}
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
                    onClick={() => setQuickAddColumn(column)}
                    title="Add deal"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </Button>
                </div>

                {/* Cards — vertical gap 12px (space-y-3) per Notion-calm brief */}
                <div className="flex-1 overflow-y-auto p-3 space-y-3 min-h-[80px]">
                  <SortableContext
                    items={columnDeals.map((d) => d.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    {columnDeals.length === 0 && (
                      <div className="rounded-[6px] border border-dashed border-hairline p-4 text-center">
                        <p className="text-[11px] text-ink-faint">No deals</p>
                      </div>
                    )}
                    {columnDeals.map((deal) => (
                      <DealCard
                        key={deal.id}
                        deal={deal}
                        onClick={() => setSelectedDeal(deal)}
                      />
                    ))}
                  </SortableContext>
                </div>
              </DroppableColumn>
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
        open={!!quickAddColumn}
        onOpenChange={(v) => {
          if (!v) {
            setQuickAddColumn(null)
            setQuickAddProductId(null)
            setQuickAddProductTouched(false)
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              Add deal — {quickAddColumn?.name}
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
                  setQuickAddColumn(null)
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
