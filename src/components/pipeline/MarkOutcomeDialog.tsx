import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { CheckCircle2, XCircle, PackageCheck } from 'lucide-react'
import { format } from 'date-fns'
import { cn } from '@/lib/utils'
import type { Deal } from '@/lib/queries/deals'
import { useMarkDealOutcome } from '@/lib/queries/deals'
import { DEAL_VALUE_MAX } from '@/lib/schemas/deal'

interface MarkOutcomeDialogProps {
  deal: Deal | null
  /**
   * Initial outcome to display (drag-onto-Won prefills "won"). User can still
   * toggle between won/lost inside the dialog. 'installed' is a locked mode
   * (no won/lost toggle) opened by a drag onto the Installed column.
   */
  initialOutcome?: 'won' | 'lost' | 'installed'
  /**
   * If supplied, the mutation will write this stage_id alongside the outcome —
   * used when the dialog is opened by a drag onto a Closed Won/Lost column so
   * the stage move only commits if the user confirms.
   */
  pendingStageId?: string | null
  open: boolean
  onClose: () => void
  /** Called after a successful save (used by the kanban for optimistic cleanup). */
  onSaved?: () => void
}

function todayISO(): string {
  return format(new Date(), 'yyyy-MM-dd')
}

export function MarkOutcomeDialog(props: MarkOutcomeDialogProps) {
  // Remount the body whenever a different deal is opened so internal state
  // initialises from fresh props (avoids cascading setState in effects).
  const { deal, open, onClose } = props
  return (
    <Dialog open={open && !!deal} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        {deal ? <Body key={`${deal.id}-${open}`} {...props} deal={deal} /> : null}
      </DialogContent>
    </Dialog>
  )
}

function Body({
  deal,
  initialOutcome = 'won',
  pendingStageId = null,
  onClose,
  onSaved,
}: Omit<MarkOutcomeDialogProps, 'deal' | 'open'> & { deal: Deal }) {
  const mutate = useMarkDealOutcome()

  const defaultValue = (() => {
    const v = deal.final_value ?? deal.acv ?? deal.contract_value
    return v != null ? String(Number(v)) : ''
  })()

  const [outcome, setOutcome] = useState<'won' | 'lost' | 'installed'>(initialOutcome)
  const isInstalledMode = initialOutcome === 'installed'
  const [finalValue, setFinalValue] = useState<string>(defaultValue)
  const [closeDate, setCloseDate] = useState<string>(todayISO())
  const [lostReason, setLostReason] = useState<string>(deal.lost_reason ?? '')

  const valueNum = finalValue.trim() === '' ? null : Number(finalValue)
  const valueTooHigh = (valueNum ?? 0) > DEAL_VALUE_MAX
  const valueInvalid = finalValue.trim() !== '' && (Number.isNaN(valueNum) || (valueNum ?? 0) < 0 || valueTooHigh)

  async function handleConfirm() {
    if (valueInvalid) return
    await mutate.mutateAsync({
      dealId: deal.id,
      orgId: deal.org_id,
      outcome,
      finalValue: valueNum,
      closeDate,
      lostReason: outcome === 'lost' ? (lostReason.trim() || null) : null,
      stageId: pendingStageId ?? undefined,
      existingClosedAt: deal.closed_at,
      existingCloseWonAt: deal.close_won_at,
    })
    onSaved?.()
    onClose()
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {isInstalledMode
            ? 'Mark as installed'
            : deal.outcome
              ? 'Update outcome'
              : 'Close out deal'}{' '}
          — {deal.title ?? 'Untitled'}
        </DialogTitle>
      </DialogHeader>

      <div className="space-y-4 mt-1">
          {isInstalledMode ? (
            /* Installed — locked mode (recorded as Won + install date stamped) */
            <div className="rounded-[8px] border border-[color:var(--jordan-accent-mint)] bg-[color:var(--jordan-accent-mint-soft)] px-3 py-2.5 text-[color:var(--jordan-success-text)]">
              <div className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[var(--jordan-tracking-label)]">
                <PackageCheck className="w-3.5 h-3.5" />
                Mark as Installed
              </div>
              <p className="text-[11px] text-ink-muted mt-0.5">
                Recorded as Won — install date below is when commission is earned
              </p>
            </div>
          ) : (
          /* Won / Lost toggle */
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setOutcome('won')}
              className={cn(
                'rounded-[8px] border px-3 py-2.5 text-left transition-colors',
                outcome === 'won'
                  ? 'border-[color:var(--jordan-accent-mint)] bg-[color:var(--jordan-accent-mint-soft)] text-[color:var(--jordan-success-text)]'
                  : 'border-hairline bg-surface-1 text-ink hover:border-[color:var(--jordan-accent-mint)]/40',
              )}
            >
              <div className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[var(--jordan-tracking-label)]">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Mark as Won
              </div>
              <p className="text-[11px] text-ink-muted mt-0.5">
                Counts toward this month's gate
              </p>
            </button>
            <button
              type="button"
              onClick={() => setOutcome('lost')}
              className={cn(
                'rounded-[8px] border px-3 py-2.5 text-left transition-colors',
                outcome === 'lost'
                  ? 'border-[color:var(--jordan-danger)]/60 bg-[color:var(--jordan-danger-soft)] text-[color:var(--jordan-danger-text)]'
                  : 'border-hairline bg-surface-1 text-ink hover:border-[color:var(--jordan-danger)]/40',
              )}
            >
              <div className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[var(--jordan-tracking-label)]">
                <XCircle className="w-3.5 h-3.5" />
                Mark as Lost
              </div>
              <p className="text-[11px] text-ink-muted mt-0.5">Excluded from gate</p>
            </button>
          </div>
          )}

          <div className="space-y-1">
            <Label htmlFor="mo-final-value">Final deal value (AUD ACV)</Label>
            <Input
              id="mo-final-value"
              type="number"
              min={0}
              step="0.01"
              value={finalValue}
              onChange={(e) => setFinalValue(e.target.value)}
              className={cn(valueInvalid && 'border-destructive')}
            />
            {valueInvalid ? (
              <p className="text-xs text-destructive">
                {valueTooHigh
                  ? `Value can't exceed $${DEAL_VALUE_MAX.toLocaleString()} — double-check the figure.`
                  : 'Enter a non-negative number.'}
              </p>
            ) : (
              <p className="text-[11px] text-ink-faint">
                Pre-filled from {deal.final_value != null ? 'previous final value' : deal.acv != null ? 'computed ACV' : 'contract value'}.
              </p>
            )}
          </div>

          <div className="space-y-1">
            <Label htmlFor="mo-close-date">{isInstalledMode ? 'Install date' : 'Close date'}</Label>
            <Input
              id="mo-close-date"
              type="date"
              value={closeDate}
              onChange={(e) => setCloseDate(e.target.value)}
            />
          </div>

          {outcome === 'lost' && (
            <div className="space-y-1">
              <Label htmlFor="mo-reason">Lost reason (optional)</Label>
              <Textarea
                id="mo-reason"
                rows={2}
                value={lostReason}
                onChange={(e) => setLostReason(e.target.value)}
                placeholder="e.g. went with competitor, budget cut"
              />
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={onClose}
              disabled={mutate.isPending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              className="flex-1"
              onClick={handleConfirm}
              disabled={mutate.isPending || valueInvalid}
            >
              {mutate.isPending
                ? 'Saving…'
                : outcome === 'installed'
                  ? 'Confirm Installed'
                  : outcome === 'won'
                    ? 'Confirm Won'
                    : 'Confirm Lost'}
            </Button>
          </div>
        </div>
    </>
  )
}
