import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Sparkles } from 'lucide-react'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  useClaudeConversation,
  useClaudeMessages,
  useInvalidateClaude,
} from '@/lib/queries/claude-chat'
import { useClaudeStream } from './useClaudeStream'
import { ClaudeConversation } from './ClaudeConversation'
import { ClaudeInput } from './ClaudeInput'

const GLOBAL_QUICK_ACTIONS = [
  { label: "What's pending today?", prompt: "What's the most important thing I should look at right now?" },
  { label: 'Today summary', prompt: 'Give me a one-line summary of where the pipeline is today.' },
  { label: 'Hot replies?', prompt: 'Are there any positive replies from today I should chase?' },
]

/**
 * Global Cmd+K Claude command bar. Mounted at app root from AppShell; only
 * renders when the user is authenticated (App.tsx mounts AppShell behind
 * RequireAuth, so by the time this is on screen we have a session).
 */
export function ClaudeCommandBar() {
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')

  const convoQ = useClaudeConversation('global')
  const conversationId = convoQ.data?.id ?? null
  const messagesQ = useClaudeMessages(conversationId)
  const invalidate = useInvalidateClaude()
  const stream = useClaudeStream()

  // Cmd+K / Ctrl+K to toggle
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        // Don't hijack the shortcut while typing into a text field on a Mac
        // unless the user clearly meant the global hotkey. We only check
        // for the modifier — text inputs don't capture Cmd/Ctrl combos
        // for plain letter keys, so this is safe.
        e.preventDefault()
        setOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  async function handleSend() {
    const text = input.trim()
    if (!text) return
    setInput('')
    try {
      const res = await stream.send({
        scope: 'global',
        conversationId: conversationId ?? undefined,
        message: text,
      })
      invalidate('global', null, res.conversationId)
      stream.reset()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to send'
      toast.error(msg)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        className="max-w-2xl p-0 flex flex-col h-[70vh] gap-0"
        aria-describedby={undefined}
      >
        <DialogHeader className="px-4 py-3 border-b border-hairline">
          <DialogTitle className="flex items-center gap-1.5">
            <Sparkles className="w-4 h-4 text-[color:var(--jordan-accent)]" />
            Ask Claude
            <span className="ml-auto text-[11px] font-normal text-ink-faint">
              <kbd className="px-1.5 py-0.5 rounded border border-hairline text-[10px] font-mono">⌘K</kbd>
            </span>
          </DialogTitle>
          <DialogDescription>
            Read-only assistant — knows today's pipeline, your recent contacts, and your voice rules.
          </DialogDescription>
        </DialogHeader>

        <ClaudeConversation
          messages={messagesQ.data ?? []}
          streamingText={stream.streamingText}
          isStreaming={stream.isStreaming}
          emptyHint="Ask anything about your pipeline. Try the chips below."
        />

        <ClaudeInput
          value={input}
          onChange={setInput}
          onSubmit={handleSend}
          isStreaming={stream.isStreaming}
          disabled={messagesQ.isLoading}
          quickActions={GLOBAL_QUICK_ACTIONS}
          placeholder="Ask Claude…"
        />
      </DialogContent>
    </Dialog>
  )
}
