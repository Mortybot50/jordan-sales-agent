import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'
import type { ClaudeMessage } from '@/lib/queries/claude-chat'

interface ClaudeConversationProps {
  messages: ClaudeMessage[]
  /** Live-streaming assistant text appended after the persisted messages. */
  streamingText?: string
  isStreaming?: boolean
  emptyHint?: string
}

export function ClaudeConversation({
  messages,
  streamingText,
  isStreaming,
  emptyHint,
}: ClaudeConversationProps) {
  const endRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom on new content (including streamed deltas).
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages.length, streamingText, isStreaming])

  const showEmpty = messages.length === 0 && !streamingText && !isStreaming

  return (
    <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
      {showEmpty && emptyHint && (
        <div className="text-[13px] text-ink-faint italic px-1">{emptyHint}</div>
      )}

      {messages.map((m) => (
        <Bubble key={m.id} role={m.role}>
          {m.content}
        </Bubble>
      ))}

      {(streamingText || isStreaming) && (
        <Bubble role="assistant">
          {streamingText || ''}
          {isStreaming && (
            <span className="ml-0.5 inline-block w-1.5 h-3.5 align-middle bg-ink-faint animate-pulse" />
          )}
        </Bubble>
      )}

      <div ref={endRef} />
    </div>
  )
}

function Bubble({
  role,
  children,
}: {
  role: 'user' | 'assistant'
  children: React.ReactNode
}) {
  const isUser = role === 'user'
  return (
    <div className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[85%] rounded-lg px-3 py-2 text-[13px] whitespace-pre-wrap break-words',
          isUser
            ? 'bg-[color:var(--jordan-accent)] text-white'
            : 'bg-surface-2 text-ink border border-hairline',
        )}
      >
        {children}
      </div>
    </div>
  )
}
