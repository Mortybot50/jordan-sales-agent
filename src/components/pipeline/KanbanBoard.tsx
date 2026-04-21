import { useState, useMemo } from 'react'
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
import { formatCurrency, cn } from '@/lib/utils'
import { DealCard } from './DealCard'
import { DealDrawer } from './DealDrawer'
import { Plus } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { dealFormSchema, type DealFormValues } from '@/lib/schemas/deal'

export function KanbanBoard() {
  const { user } = useAuth()
  const { data: stages } = useStages()
  const { data: deals, isLoading, error } = useDeals()
  const { data: contacts } = useContacts()
  const updateDeal = useUpdateDeal()
  const createDeal = useCreateDeal()

  const [localDeals, setLocalDeals] = useState<Deal[] | null>(null)
  const [activeDeal, setActiveDeal] = useState<Deal | null>(null)
  const [selectedDeal, setSelectedDeal] = useState<Deal | null>(null)
  const [quickAddStageId, setQuickAddStageId] = useState<string | null>(null)

  const displayDeals = localDeals ?? deals ?? []

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  )

  const form = useForm<DealFormValues>({
    resolver: zodResolver(dealFormSchema),
    defaultValues: { contract_value: 800 },
  })

  const dealsByStage = useMemo(() => {
    const map: Record<string, Deal[]> = {}
    for (const stage of stages ?? []) {
      map[stage.id] = displayDeals.filter((d) => d.stage_id === stage.id)
    }
    return map
  }, [displayDeals, stages])

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
    await createDeal.mutateAsync({
      org_id: user.org_id,
      title: values.title,
      stage_id: quickAddStageId,
      contact_id: values.contact_id,
      contract_value: values.contract_value,
    })
    setQuickAddStageId(null)
    form.reset({ contract_value: 800 })
  }

  if (isLoading) {
    return (
      <div className="flex gap-4 p-4 overflow-x-auto">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="w-64 shrink-0 rounded-xl border bg-muted/30 animate-pulse">
            <div className="p-3 border-b">
              <div className="h-4 w-24 rounded bg-muted" />
            </div>
            <div className="p-2 space-y-2">
              {Array.from({ length: 2 + (i % 3) }).map((__, j) => (
                <div key={j} className="rounded-lg border bg-card p-3 space-y-1.5">
                  <div className="h-3.5 w-full rounded bg-muted" />
                  <div className="h-3 w-2/3 rounded bg-muted" />
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
      <div className="text-destructive text-sm p-4">
        Failed to load: {error.message}
      </div>
    )
  }

  return (
    <>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={({ active }) => {
          const deal = displayDeals.find((d) => d.id === String(active.id))
          setActiveDeal(deal ?? null)
        }}
        onDragEnd={handleDragEnd}
      >
        <div className="flex gap-3 overflow-x-auto pb-4 px-4 sm:px-6 h-full min-h-0">
          {(stages ?? []).map((stage) => {
            const stageDeals = dealsByStage[stage.id] ?? []
            const totalValue = stageDeals.reduce(
              (sum, d) => sum + (d.contract_value ?? 0),
              0
            )

            return (
              <div
                key={stage.id}
                className="flex flex-col w-64 shrink-0 bg-muted/40 rounded-xl border"
              >
                {/* Column header */}
                <div className="flex items-center justify-between px-3 pt-3 pb-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      {stage.color && (
                        <div
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: stage.color }}
                        />
                      )}
                      <span className="text-sm font-semibold truncate">
                        {stage.name}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {stageDeals.length}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {formatCurrency(totalValue)}
                    </p>
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
                <div className="flex-1 overflow-y-auto px-2 pb-3 space-y-2 min-h-[80px]">
                  <SortableContext
                    items={stageDeals.map((d) => d.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    {stageDeals.length === 0 && (
                      <div className="rounded-lg border border-dashed p-4 text-center">
                        <p className="text-xs text-muted-foreground">
                          No deals
                        </p>
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

      {/* Quick-add dialog */}
      <Dialog
        open={!!quickAddStageId}
        onOpenChange={(v) => !v && setQuickAddStageId(null)}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              Add deal — {stages?.find((s) => s.id === quickAddStageId)?.name}
            </DialogTitle>
          </DialogHeader>
          <form
            onSubmit={form.handleSubmit(handleQuickAdd)}
            className="space-y-3 mt-2"
          >
            <div className="space-y-1">
              <Label>Title *</Label>
              <Input
                {...form.register('title')}
                placeholder="e.g. Purezza x The Espy"
                className={cn(form.formState.errors.title && 'border-destructive')}
              />
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
                onClick={() => setQuickAddStageId(null)}
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
