import { useState } from 'react'
import { toast } from 'sonner'
import { Sparkles } from 'lucide-react'

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  useClaudeConversation,
  useClaudeMessages,
  useInvalidateClaude,
  type ClaudeScope,
} from '@/lib/queries/claude-chat'
import { useClaudeStream } from './useClaudeStream'
import { ClaudeConversation } from './ClaudeConversation'
import { ClaudeInput } from './ClaudeInput'

interface ClaudePanelProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  scope: ClaudeScope
  contactId?: string | null
  /** Eyebrow shown above the title (e.g. contact's name). */
  eyebrow?: string
}

const CONTACT_QUICK_ACTIONS = [
  { label: 'Summarise this lead', prompt: 'Summarise this lead in one sentence.' },
  { label: 'Suggest next step', prompt: 'What should my next step be with this contact?' },
  { label: 'Likely objection?', prompt: "What's the most likely objection from this contact, based on what we know?" },
  { label: 'Draft a follow-up', prompt: 'Draft a short follow-up email to this contact in my voice.' },
]

const GLOBAL_QUICK_ACTIONS = [
  { label: "What's pending today?", prompt: "What's the most important thing I should look at right now?" },
  { label: 'Today summary', prompt: 'Give me a one-line summary of where the pipeline is today.' },
  { label: 'Hot replies?', prompt: 'Are there any positive replies from today I should chase?' },
]

export function ClaudePanel({
  open,
  onOpenChange,
  scope,
  contactId,
  eyebrow,
}: ClaudePanelProps) {
  const convoQ = useClaudeConversation(scope, contactId)
  const conversationId = convoQ.data?.id ?? null
  const messagesQ = useClaudeMessages(conversationId)
  const invalidate = useInvalidateClaude()
  const stream = useClaudeStream()
  const [input, setInput] = useState('')

  async function handleSend() {
    const text = input.trim()
    if (!text) return
    setInput('')
    try {
      const res = await stream.send({
        scope,
        contactId: contactId ?? undefined,
        conversationId: conversationId ?? undefined,
        message: text,
      })
      // Invalidate so the persisted rows replace the in-memory stream view
      invalidate(scope, contactId, res.conversationId)
      stream.reset()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to send'
      toast.error(msg)
    }
  }

  const title = scope === 'contact' ? 'Ask Claude' : 'Claude'
  const description =
    scope === 'contact'
      ? 'Read-only — Claude can summarise, suggest, or draft, but can\'t send or change anything.'
      : 'Ask Claude anything about your pipeline. Read-only — no actions taken on your behalf.'

  const quickActions = scope === 'contact' ? CONTACT_QUICK_ACTIONS : GLOBAL_QUICK_ACTIONS

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex flex-col w-full sm:max-w-md p-0"
      >
        <SheetHeader className="border-b border-hairline">
          {eyebrow && (
            <span className="text-[11px] uppercase tracking-[var(--jordan-tracking-label)] text-ink-faint">
              {eyebrow}
            </span>
          )}
          <SheetTitle className="flex items-center gap-1.5">
            <Sparkles className="w-4 h-4 text-[color:var(--jordan-accent)]" />
            {title}
          </SheetTitle>
          <SheetDescription>{description}</SheetDescription>
        </SheetHeader>

        <ClaudeConversation
          messages={messagesQ.data ?? []}
          streamingText={stream.streamingText}
          isStreaming={stream.isStreaming}
          emptyHint={
            scope === 'contact'
              ? 'Ask about this lead, draft a follow-up, or sanity-check your approach.'
              : 'Ask about your pipeline, your day, or the right next step.'
          }
        />

        <ClaudeInput
          value={input}
          onChange={setInput}
          onSubmit={handleSend}
          isStreaming={stream.isStreaming}
          disabled={messagesQ.isLoading}
          quickActions={quickActions}
          placeholder={scope === 'contact' ? 'Ask about this contact…' : 'Ask Claude…'}
        />
      </SheetContent>
    </Sheet>
  )
}
