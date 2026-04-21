import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Separator } from '@/components/ui/separator'
import { useApproveDraft, useRejectDraft, useEditDraft } from '@/lib/queries/drafts'
import { DraftEditor } from '@/components/drafts/DraftEditor'
import { formatRelative, venueTypeLabel } from '@/lib/utils'
import { Check, X, Pencil, SkipForward, Mail, Building2 } from 'lucide-react'
import type { Draft, DraftType } from '@/lib/queries/drafts'

function draftTypeLabel(t: DraftType): string {
  switch (t) {
    case 'cold_outreach': return 'Cold Outreach'
    case 'follow_up':
    case 'follow_up_soft': return 'Follow-up'
    case 'follow_up_close': return 'Follow-up (close)'
    case 'reply': return 'Reply'
    default: return t
  }
}

function draftTypeBadgeClass(t: DraftType): string {
  switch (t) {
    case 'cold_outreach': return 'bg-blue-100 text-blue-700 border-0'
    case 'follow_up':
    case 'follow_up_soft': return 'bg-amber-100 text-amber-700 border-0'
    case 'follow_up_close': return 'bg-orange-100 text-orange-700 border-0'
    case 'reply': return 'bg-green-100 text-green-700 border-0'
    default: return ''
  }
}

interface DraftCardProps {
  draft: Draft
  isActive: boolean
  onSkip: () => void
}

export function DraftCard({ draft, isActive, onSkip }: DraftCardProps) {
  const [editOpen, setEditOpen] = useState(false)
  const [rejectOpen, setRejectOpen] = useState(false)

  const approveDraft = useApproveDraft()
  const rejectDraft = useRejectDraft()
  const editDraft = useEditDraft()

  const contact = draft.contact
  const venue = contact?.venue
  const ctx = draft.context_json as Record<string, unknown> | null
  const ctxContact = ctx?.contact as Record<string, unknown> | null

  return (
    <>
      <Card className={`transition-all ${isActive ? 'ring-2 ring-primary' : 'opacity-60'}`}>
        <CardContent className="p-4 space-y-3">
          {/* Header */}
          <div className="flex items-start justify-between gap-2 flex-wrap">
            <div className="space-y-0.5">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="font-medium text-sm">{contact?.full_name ?? 'Unknown contact'}</span>
                {venue?.name && (
                  <>
                    <span className="text-muted-foreground text-xs">·</span>
                    <span className="text-xs text-muted-foreground flex items-center gap-0.5">
                      <Building2 className="w-3 h-3" />
                      {venue.name}
                    </span>
                  </>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <Badge className={`text-xs ${draftTypeBadgeClass(draft.draft_type)}`}>
                  {draftTypeLabel(draft.draft_type)}
                </Badge>
                {draft.status === 'edited' && (
                  <Badge variant="outline" className="text-xs">Edited</Badge>
                )}
              </div>
            </div>
            <span className="text-xs text-muted-foreground shrink-0">
              {formatRelative(draft.generated_at ?? draft.created_at)}
            </span>
          </div>

          {/* Context summary */}
          {ctxContact && (() => {
            const venueType = ctxContact.venue_type as string | null | undefined
            const coverCount = ctxContact.cover_count as number | null | undefined
            const suburb = ctxContact.suburb as string | null | undefined
            return (
              <div className="text-xs text-muted-foreground bg-muted/40 rounded-lg px-3 py-2 space-y-0.5">
                {venueType && <span className="mr-2">{venueTypeLabel(venueType)}</span>}
                {coverCount != null && <span className="mr-2">{coverCount} covers</span>}
                {suburb && <span>{suburb}</span>}
              </div>
            )
          })()}

          {/* Email preview */}
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5">
              <Mail className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              <p className="text-sm font-medium truncate">{draft.subject ?? '(no subject)'}</p>
            </div>
            <p className="text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed line-clamp-6 font-mono">
              {draft.body ?? ''}
            </p>
          </div>

          <Separator />

          {/* Action buttons */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <Button
              size="sm"
              className="h-8 px-3 gap-1.5 bg-green-600 hover:bg-green-700 text-white"
              onClick={() => approveDraft.mutate(draft.id)}
              disabled={approveDraft.isPending}
              title="Approve (A)"
            >
              <Check className="w-3.5 h-3.5" />
              Approve
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8 px-3 gap-1.5"
              onClick={() => setEditOpen(true)}
              title="Edit (E)"
            >
              <Pencil className="w-3.5 h-3.5" />
              Edit
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8 px-3 gap-1.5 text-muted-foreground"
              onClick={onSkip}
              title="Skip (S)"
            >
              <SkipForward className="w-3.5 h-3.5" />
              Skip
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 px-3 gap-1.5 text-destructive hover:text-destructive hover:bg-destructive/10"
              onClick={() => setRejectOpen(true)}
              title="Reject (R)"
            >
              <X className="w-3.5 h-3.5" />
              Reject
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Edit dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-2xl" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Edit draft — {contact?.full_name}</DialogTitle>
          </DialogHeader>
          <DraftEditor
            draft={draft}
            onClose={() => setEditOpen(false)}
          />
        </DialogContent>
      </Dialog>

      {/* Reject confirm dialog */}
      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent className="max-w-sm" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Reject this draft?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This draft will be removed from the queue. You can generate a new one from the contact's page.
          </p>
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setRejectOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              className="flex-1"
              onClick={() => {
                rejectDraft.mutate(draft.id)
                setRejectOpen(false)
              }}
              disabled={rejectDraft.isPending || editDraft.isPending}
            >
              Reject
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
