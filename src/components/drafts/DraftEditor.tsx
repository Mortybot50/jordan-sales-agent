import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useEditDraft } from '@/lib/queries/drafts'
import type { Draft } from '@/lib/queries/drafts'

interface DraftEditorProps {
  draft: Draft
  onClose: () => void
}

export function DraftEditor({ draft, onClose }: DraftEditorProps) {
  const [subject, setSubject] = useState(draft.subject ?? '')
  const [body, setBody] = useState(draft.body ?? '')
  const editDraft = useEditDraft()

  async function handleSave() {
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
          className="font-mono text-sm resize-y"
          placeholder="Email body"
        />
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
