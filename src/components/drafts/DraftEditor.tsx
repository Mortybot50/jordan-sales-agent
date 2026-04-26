import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  hasUnresolvedPlaceholder,
  TIMES_PLACEHOLDER,
  useEditDraft,
} from '@/lib/queries/drafts'
import type { Draft } from '@/lib/queries/drafts'
import { cn } from '@/lib/utils'

interface DraftEditorProps {
  draft: Draft
  onClose: () => void
}

export function DraftEditor({ draft, onClose }: DraftEditorProps) {
  const [subject, setSubject] = useState(draft.subject ?? '')
  const [body, setBody] = useState(draft.body ?? '')
  const editDraft = useEditDraft()

  // Diary banner shows whenever the draft was generated as a proposed_meeting
  // OR the body still contains the literal token (Jordan may have pasted it).
  const showDiaryBanner =
    draft.draft_kind === 'proposed_meeting' || hasUnresolvedPlaceholder(body)
  const placeholderPresent = hasUnresolvedPlaceholder(body)

  async function handleSave() {
    // Save works regardless of placeholder state — Jordan can save mid-edit.
    await editDraft.mutateAsync({
      id: draft.id,
      subject,
      body,
      originalBody: draft.body ?? '',
    })
    onClose()
  }

  return (
    <div className="space-y-3">
      {showDiaryBanner && (
        <div
          data-testid="diary-slot-banner"
          className={cn(
            'flex items-start gap-2 rounded-[var(--jordan-radius-sm)] border px-3 py-2 text-[12px] leading-5',
            placeholderPresent
              ? 'border-[color:color-mix(in_oklab,var(--jordan-warm)_32%,transparent)] bg-[var(--jordan-warm-soft)] text-[var(--jordan-warm-text)]'
              : 'border-[color:color-mix(in_oklab,var(--jordan-success)_32%,transparent)] bg-[var(--jordan-success-soft)] text-[var(--jordan-success-text)]',
          )}
        >
          <span aria-hidden className="mt-0.5">
            📅
          </span>
          <span>
            {placeholderPresent ? (
              <>
                <strong className="font-semibold">Diary slot needed.</strong>{' '}
                Replace{' '}
                <code className="rounded bg-black/10 px-1 py-0.5 font-mono text-[11px]">
                  {TIMES_PLACEHOLDER}
                </code>{' '}
                with your proposed times before sending.
              </>
            ) : (
              <>
                <strong className="font-semibold">Times locked in.</strong>{' '}
                Placeholder replaced — ready to approve.
              </>
            )}
          </span>
        </div>
      )}

      <div className="space-y-1">
        <Label>Subject</Label>
        <Input
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="Email subject"
        />
      </div>
      <div className="space-y-1">
        <Label>Body</Label>
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={12}
          className={cn(
            'font-mono text-sm resize-y',
            // Visual nudge when the placeholder is still in the body — amber
            // ring borrows the warm token, no new colours introduced.
            placeholderPresent &&
              'ring-1 ring-[color:color-mix(in_oklab,var(--jordan-warm)_45%,transparent)] focus-visible:ring-[color:var(--jordan-warm)]',
          )}
          placeholder="Email body"
        />
        {placeholderPresent && (
          <p className="text-[11px] text-[var(--jordan-warm-text)]">
            Token{' '}
            <code className="rounded bg-[var(--jordan-warm-soft)] px-1 py-0.5 font-mono">
              {TIMES_PLACEHOLDER}
            </code>{' '}
            still in body — replace before approving.
          </p>
        )}
      </div>
      <div className="flex gap-2">
        <Button variant="outline" className="flex-1" onClick={onClose}>
          Cancel
        </Button>
        <Button
          className="flex-1"
          onClick={handleSave}
          disabled={editDraft.isPending || !subject.trim() || !body.trim()}
        >
          {editDraft.isPending ? 'Saving…' : 'Save edit'}
        </Button>
      </div>
    </div>
  )
}
