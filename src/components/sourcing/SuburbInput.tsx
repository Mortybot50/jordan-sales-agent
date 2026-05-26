import { useState, type KeyboardEvent } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface SuburbInputProps {
  value: string[]
  onChange: (next: string[]) => void
  placeholder?: string
  disabled?: boolean
  max?: number
  'aria-invalid'?: boolean
  id?: string
}

/**
 * Tag chip input for suburbs. Press Enter or comma to commit a chip;
 * Backspace on an empty input pops the last chip. Trims whitespace
 * and de-dupes case-insensitively.
 */
export function SuburbInput({
  value,
  onChange,
  placeholder = 'Type a suburb and press Enter',
  disabled,
  max = 20,
  id,
  ...rest
}: SuburbInputProps) {
  const [draft, setDraft] = useState('')

  function commit(raw: string) {
    const trimmed = raw.trim().replace(/,$/, '').trim()
    if (!trimmed) return
    if (value.length >= max) return
    const lower = trimmed.toLowerCase()
    if (value.some((v) => v.toLowerCase() === lower)) {
      setDraft('')
      return
    }
    onChange([...value, trimmed])
    setDraft('')
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      commit(draft)
    } else if (e.key === 'Backspace' && draft === '' && value.length > 0) {
      e.preventDefault()
      onChange(value.slice(0, -1))
    }
  }

  function removeAt(index: number) {
    const next = value.slice()
    next.splice(index, 1)
    onChange(next)
  }

  const invalid = rest['aria-invalid']

  return (
    <div
      className={cn(
        'min-h-9 w-full rounded-md border bg-transparent px-2 py-1.5 text-sm shadow-xs transition-[color,box-shadow] flex flex-wrap items-center gap-1.5',
        invalid
          ? 'border-destructive ring-destructive/20 ring-[3px]'
          : 'border-input focus-within:border-ring focus-within:ring-ring/50 focus-within:ring-[3px]',
        disabled && 'opacity-50 pointer-events-none',
      )}
    >
      {value.map((s, i) => (
        <span
          key={`${s}-${i}`}
          className="inline-flex items-center gap-1 rounded-full bg-[color:var(--jordan-accent-soft)] text-[color:var(--jordan-accent-hover)] px-2 py-0.5 text-[12px] font-medium"
        >
          {s}
          <button
            type="button"
            aria-label={`Remove ${s}`}
            onClick={() => removeAt(i)}
            className="hover:text-ink"
            disabled={disabled}
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <input
        id={id}
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => commit(draft)}
        placeholder={value.length === 0 ? placeholder : ''}
        disabled={disabled}
        className="flex-1 min-w-[120px] bg-transparent outline-none text-sm placeholder:text-ink-faint"
      />
    </div>
  )
}
