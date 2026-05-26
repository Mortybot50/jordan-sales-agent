import { useCallback, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { ClaudeScope } from '@/lib/queries/claude-chat'

interface SendArgs {
  scope: ClaudeScope
  contactId?: string | null
  conversationId?: string | null
  message: string
}

interface MetaEvent {
  type: 'leadflow_meta'
  conversation_id: string
  user_message_id: string
  assistant_message_id: string | null
  tokens_in: number
  tokens_out: number
  cost_usd: number
  model: string
}

interface StreamResult {
  conversationId: string
  userMessageId: string
  assistantMessageId: string | null
  assistantText: string
  tokensIn: number
  tokensOut: number
  costUsd: number
}

interface UseClaudeStreamReturn {
  /** Tokens as they arrive — components subscribe via the `onDelta` callback
   *  in send(), so this is just exposed for completeness when needed. */
  streamingText: string
  isStreaming: boolean
  error: Error | null
  /** Returns the final result on success. Rejects on transport / API error. */
  send: (
    args: SendArgs,
    onDelta?: (chunk: string) => void,
  ) => Promise<StreamResult>
  cancel: () => void
  reset: () => void
}

/**
 * Streaming wrapper around the `claude-chat` Edge Function. Parses Anthropic's
 * native SSE (forwarded by the Edge Fn) and emits text deltas via `onDelta`.
 *
 * SSE event types we care about:
 *   - content_block_delta with delta.type=text_delta → append delta.text
 *   - leadflow_meta (synthesised by our Edge Fn) → final ids + token counts
 */
export function useClaudeStream(): UseClaudeStreamReturn {
  const [streamingText, setStreamingText] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const reset = useCallback(() => {
    setStreamingText('')
    setError(null)
  }, [])

  const cancel = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setIsStreaming(false)
  }, [])

  const send = useCallback(
    async (args: SendArgs, onDelta?: (chunk: string) => void): Promise<StreamResult> => {
      setError(null)
      setStreamingText('')
      setIsStreaming(true)

      const ac = new AbortController()
      abortRef.current = ac

      try {
        const { data: sessionData } = await supabase.auth.getSession()
        const token = sessionData.session?.access_token
        if (!token) throw new Error('Not signed in')

        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
        const url = `${supabaseUrl}/functions/v1/claude-chat`

        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
            apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({
            conversation_id: args.conversationId ?? undefined,
            scope: args.scope,
            contact_id: args.contactId ?? undefined,
            message: args.message,
          }),
          signal: ac.signal,
        })

        if (!res.ok || !res.body) {
          let errMsg = `claude-chat returned ${res.status}`
          try {
            const errBody = await res.json()
            if (errBody?.error) errMsg = errBody.error
          } catch {
            /* not JSON */
          }
          throw new Error(errMsg)
        }

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        let assistantText = ''
        let meta: MetaEvent | null = null

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })

          let idx
          while ((idx = buffer.indexOf('\n\n')) !== -1) {
            const block = buffer.slice(0, idx)
            buffer = buffer.slice(idx + 2)
            const lines = block.split('\n')
            const dataLine = lines.find((l) => l.startsWith('data: '))
            if (!dataLine) continue
            const payload = dataLine.slice(6).trim()
            if (!payload || payload === '[DONE]') continue
            try {
              const evt = JSON.parse(payload)
              if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
                const chunk = String(evt.delta.text ?? '')
                assistantText += chunk
                setStreamingText((prev) => prev + chunk)
                onDelta?.(chunk)
              } else if (evt.type === 'leadflow_meta') {
                meta = evt as MetaEvent
              }
            } catch {
              /* malformed event — skip */
            }
          }
        }

        if (!meta) {
          throw new Error('Stream ended without metadata — try again')
        }

        return {
          conversationId: meta.conversation_id,
          userMessageId: meta.user_message_id,
          assistantMessageId: meta.assistant_message_id,
          assistantText,
          tokensIn: meta.tokens_in,
          tokensOut: meta.tokens_out,
          costUsd: meta.cost_usd,
        }
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err))
        if (e.name !== 'AbortError') setError(e)
        throw e
      } finally {
        setIsStreaming(false)
        abortRef.current = null
      }
    },
    [],
  )

  return { streamingText, isStreaming, error, send, cancel, reset }
}
