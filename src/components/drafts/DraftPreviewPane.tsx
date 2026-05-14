import * as React from 'react'
import { Mail, Check, X, Pencil, SkipForward, Building2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DraftTypeBadge,
  KbdHint,
  PageHeader,
  StatusPill,
} from '@/components/primitives'
import { DraftEditor } from '@/components/drafts/DraftEditor'
import { formatRelative, venueTypeLabel } from '@/lib/utils'
import {
  getDraftVariantLabel,
  hasUnresolvedPlaceholder,
  TIMES_PLACEHOLDER,
  useApproveDraft,
  useRejectDraft,
  type Draft,
} from '@/lib/queries/drafts'

/**
 * DraftPreviewPane — right-pane full preview + actions for the active
 * draft. Hairline divider from queue. All buttons also keyboard-driven
 * from the parent page (A / R / E).
 */
export interface DraftPreviewPaneProps {
  draft: Draft | null
  editOpenSignal: number
  onEditOpenChange?: (open: boolean) => void
  rejectOpenSignal: number
  onRejectOpenChange?: (open: boolean) => void
  onApproved?: (id: string) => void
  onRejected?: (id: string) => void
  onSkip?: (id: string) => void
}

/**
 * Splits a draft body around occurrences of [YOUR_TIMES_HERE] and renders
 * the token as an amber inline pill so Jordan visually can't miss it.
 */
function renderBodyWithPlaceholder(body: string): React.ReactNode {
  if (!body.includes(TIMES_PLACEHOLDER)) return body
  const parts = body.split(TIMES_PLACEHOLDER)
  const out: React.ReactNode[] = []
  parts.forEach((part, i) => {
    out.push(<React.Fragment key={`t-${i}`}>{part}</React.Fragment>)
    if (i < parts.length - 1) {
      out.push(
        <span
          key={`p-${i}`}
          data-testid="placeholder-token"
          className="inline-flex items-center rounded-[var(--jordan-radius-sm)] bg-[var(--jordan-warm-soft)] px-1.5 py-0.5 font-mono text-[12px] font-semibold text-[var(--jordan-warm-text)] ring-1 ring-[color:color-mix(in_oklab,var(--jordan-warm)_45%,transparent)]"
          title="Replace with your proposed times before approving"
        >
          {TIMES_PLACEHOLDER}
        </span>,
      )
    }
  })
  return out
}

export function DraftPreviewPane({
  draft,
  editOpenSignal,
  onEditOpenChange,
  rejectOpenSignal,
  onRejectOpenChange,
  onApproved,
  onRejected,
  onSkip,
}: DraftPreviewPaneProps) {
  const [editOpen, setEditOpen] = React.useState(false)
  const [rejectOpen, setRejectOpen] = React.useState(false)

  const approveDraft = useApproveDraft()
  const rejectDraft = useRejectDraft()

  // Let parent open the Sheet/Dialog via signal counters (E / R keys).
  const lastEdit = React.useRef(editOpenSignal)
  const lastReject = React.useRef(rejectOpenSignal)
  React.useEffect(() => {
    if (editOpenSignal !== lastEdit.current) {
      lastEdit.current = editOpenSignal
      if (draft) setEditOpen(true)
    }
  }, [editOpenSignal, draft])
  React.useEffect(() => {
    if (rejectOpenSignal !== lastReject.current) {
      lastReject.current = rejectOpenSignal
      if (draft) setRejectOpen(true)
    }
  }, [rejectOpenSignal, draft])

  React.useEffect(() => {
    onEditOpenChange?.(editOpen)
  }, [editOpen, onEditOpenChange])
  React.useEffect(() => {
    onRejectOpenChange?.(rejectOpen)
  }, [rejectOpen, onRejectOpenChange])

  if (!draft) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="max-w-xs text-center">
          <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-full bg-surface-4 text-ink-faint">
            <Mail size={18} strokeWidth={1.75} />
          </div>
          <p className="text-[15px] font-semibold text-ink">Pick a draft to review</p>
          <p className="mt-1 text-[13px] text-ink-muted">
            Use <kbd className="font-mono">J</kbd> / <kbd className="font-mono">K</kbd> to navigate the queue.
          </p>
        </div>
      </div>
    )
  }

  const contact = draft.contact
  const venue = contact?.venue
  const ctx = draft.context_json as Record<string, unknown> | null
  const ctxContact = ctx?.contact as Record<string, unknown> | null
  const venueType = (ctxContact?.venue_type as string | null | undefined) ?? null
  const coverCount = (ctxContact?.cover_count as number | null | undefined) ?? null
  const suburb = (ctxContact?.suburb as string | null | undefined) ?? null

  // Hard guard for proposed-meeting drafts. Approve == Send in this app
  // today, so the same rule applies to both: must replace the token first.
  const placeholderPresent = hasUnresolvedPlaceholder(draft.body)
  const approveDisabled = approveDraft.isPending || placeholderPresent
  const approveTooltip = placeholderPresent
    ? `Replace ${TIMES_PLACEHOLDER} with your proposed times before sending.`
    : undefined

  async function handleApprove() {
    if (!draft || placeholderPresent) return
    await approveDraft.mutateAsync(draft.id)
    onApproved?.(draft.id)
  }

  function confirmReject() {
    if (!draft) return
    rejectDraft.mutate(draft.id, {
      onSuccess: () => {
        setRejectOpen(false)
        onRejected?.(draft.id)
      },
    })
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader
        className="px-4 py-4 sm:px-5"
        eyebrow={
          <span className="flex items-center gap-2">
            <DraftTypeBadge type={draft.draft_type} />
            {(() => {
              const variantLabel = getDraftVariantLabel(draft)
              return variantLabel ? (
                <StatusPill
                  tone="neutral"
                  uppercase
                  data-testid="variant-pill"
                  title={`Rendered from template variant: ${variantLabel}`}
                >
                  Variant · {variantLabel}
                </StatusPill>
              ) : null
            })()}
            {draft.status === 'edited' && (
              <StatusPill tone="neutral" uppercase>
                Edited
              </StatusPill>
            )}
          </span>
        }
        title={draft.subject ?? '(no subject)'}
        description={
          <span className="flex flex-wrap items-center gap-1.5 text-ink-muted">
            <span className="font-medium text-ink">{contact?.full_name ?? 'Unknown'}</span>
            {venue?.name && (
              <>
                <span className="text-ink-faint">·</span>
                <Building2 className="size-3.5 text-ink-faint" />
                <span>{venue.name}</span>
              </>
            )}
            <span className="text-ink-faint">·</span>
            <span className="jordan-tnum text-ink-faint">
              {formatRelative(draft.generated_at ?? draft.created_at)}
            </span>
          </span>
        }
      />

      <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-5">
        {(venueType || coverCount != null || suburb) && (
          <div className="mb-4 flex flex-wrap items-center gap-3 rounded-[var(--jordan-radius-md)] border border-hairline bg-surface-2 px-3 py-2 text-[12px] text-ink-muted">
            {venueType && <span>{venueTypeLabel(venueType)}</span>}
            {coverCount != null && (
              <span className="jordan-tnum font-mono">{coverCount} covers</span>
            )}
            {suburb && <span>{suburb}</span>}
          </div>
        )}

        {placeholderPresent && (
          <div
            data-testid="diary-slot-banner"
            className="mb-4 flex items-start gap-2 rounded-[var(--jordan-radius-md)] border border-[color:color-mix(in_oklab,var(--jordan-warm)_32%,transparent)] bg-[var(--jordan-warm-soft)] px-3 py-2 text-[12px] leading-5 text-[var(--jordan-warm-text)]"
          >
            <span aria-hidden className="mt-0.5">📅</span>
            <span>
              <strong className="font-semibold uppercase tracking-[var(--jordan-tracking-label)]">
                Diary slot needed
              </strong>{' '}
              — open Edit and replace{' '}
              <code className="rounded bg-black/10 px-1 py-0.5 font-mono text-[11px]">
                {TIMES_PLACEHOLDER}
              </code>{' '}
              with your proposed times before approving.
            </span>
          </div>
        )}

        <div className="space-y-3">
          <div className="flex items-center gap-1.5 border-b border-hairline pb-2">
            <Mail className="size-3.5 shrink-0 text-ink-faint" />
            <p className="truncate text-[13px] font-medium text-ink">
              {draft.subject ?? '(no subject)'}
            </p>
          </div>
          <pre className="whitespace-pre-wrap break-words font-sans text-[13px] leading-6 text-ink">
            {renderBodyWithPlaceholder(draft.body ?? '')}
          </pre>
        </div>
      </div>

      <div className="shrink-0 border-t border-hairline bg-surface-1 px-4 py-3 sm:px-5">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            className="h-8 gap-1.5 bg-[var(--jordan-accent)] text-white hover:bg-[var(--jordan-accent-hover)]"
            onClick={handleApprove}
            disabled={approveDisabled}
            title={approveTooltip}
            aria-disabled={approveDisabled}
            data-testid="approve-button"
          >
            <Check className="size-3.5" />
            Approve
            <KbdHint className="ml-1 text-white/80">A</KbdHint>
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5"
            onClick={() => setEditOpen(true)}
          >
            <Pencil className="size-3.5" />
            Edit
            <KbdHint className="ml-1">E</KbdHint>
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 text-ink-muted"
            onClick={() => onSkip?.(draft.id)}
          >
            <SkipForward className="size-3.5" />
            Skip
            <KbdHint className="ml-1">S</KbdHint>
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto h-8 gap-1.5 text-[var(--jordan-danger-text)] hover:bg-[var(--jordan-danger-soft)] hover:text-[var(--jordan-danger-text)]"
            onClick={() => setRejectOpen(true)}
          >
            <X className="size-3.5" />
            Reject
            <KbdHint className="ml-1">R</KbdHint>
          </Button>
        </div>
      </div>

      {/* Inline edit via Sheet (not stacked dialog) */}
      <Sheet open={editOpen} onOpenChange={setEditOpen}>
        <SheetContent side="right" className="w-full bg-surface-1 p-0 sm:max-w-xl">
          <SheetHeader className="border-b border-hairline px-4 py-3">
            <SheetTitle className="text-[15px] font-semibold text-ink">
              Edit draft — {contact?.full_name}
            </SheetTitle>
          </SheetHeader>
          <div className="px-4 py-4">
            <DraftEditor draft={draft} onClose={() => setEditOpen(false)} />
          </div>
        </SheetContent>
      </Sheet>

      {/* Reject confirm */}
      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent className="max-w-sm" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Reject this draft?</DialogTitle>
          </DialogHeader>
          <p className="text-[13px] text-ink-muted">
            This draft will be removed from the queue. You can generate a new one from the contact's page.
          </p>
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setRejectOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              className="flex-1"
              onClick={confirmReject}
              disabled={rejectDraft.isPending}
            >
              Reject
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
