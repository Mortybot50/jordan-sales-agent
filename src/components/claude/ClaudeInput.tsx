import { useRef } from 'react'
import { Loader2, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

interface ClaudeInputProps {
  value: string
  onChange: (v: string) => void
  onSubmit: () => void
  disabled?: boolean
  isStreaming?: boolean
  /** Quick-action chips that prefill the textarea. */
  quickActions?: { label: string; prompt: string }[]
  placeholder?: string
}

export function ClaudeInput({
  value,
  onChange,
  onSubmit,
  disabled,
  isStreaming,
  quickActions,
  placeholder,
}: ClaudeInputProps) {
  const taRef = useRef<HTMLTextAreaElement>(null)

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      // Mirror the send button's guard — Enter must also be blocked while a
      // previous response is still streaming, otherwise two requests race
      // through the shared useClaudeStream and interleave into one buffer.
      if (!disabled && !isStreaming && value.trim()) onSubmit()
    }
  }

  const canSend = !disabled && !isStreaming && value.trim().length > 0

  return (
    <div className="border-t border-hairline bg-surface-1 px-3 py-2.5 space-y-2">
      {quickActions && quickActions.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {quickActions.map((q) => (
            <button
              key={q.label}
              type="button"
              disabled={disabled || isStreaming}
              onClick={() => {
                onChange(q.prompt)
                taRef.current?.focus()
              }}
              className={cn(
                'rounded-full px-2.5 py-1 text-[11px] border transition-colors',
                'border-hairline text-ink-muted hover:text-ink hover:bg-surface-3',
                'disabled:opacity-50 disabled:cursor-not-allowed',
              )}
            >
              {q.label}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-end gap-2">
        <Textarea
          ref={taRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={2}
          maxLength={8000}
          placeholder={placeholder ?? 'Ask Claude…'}
          disabled={disabled}
          className="flex-1 resize-none text-[13px] min-h-[40px] max-h-[200px]"
        />
        <Button
          type="button"
          size="sm"
          onClick={onSubmit}
          disabled={!canSend}
          className="h-9 shrink-0"
        >
          {isStreaming ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Send className="w-4 h-4" />
          )}
        </Button>
      </div>
    </div>
  )
}
