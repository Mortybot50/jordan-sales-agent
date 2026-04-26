import { useEffect, useRef, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import { Loader2, MapPin } from 'lucide-react'

interface Prediction {
  description: string
  place_id: string
  structured_formatting?: {
    main_text: string
    secondary_text: string
  }
}

interface PlaceDetails {
  suburb: string
  state: string
  postcode: string
}

interface Props {
  /** Current suburb text — controlled by react-hook-form */
  value: string
  /** Called on every keystroke — keeps RHF in sync */
  onChange: (suburb: string) => void
  /** Called when a prediction is selected — populate suburb + state + postcode in one go */
  onSelect: (details: PlaceDetails) => void
  label?: string
  placeholder?: string
  error?: string
  id?: string
}

const DEBOUNCE_MS = 250

export function SuburbAutocomplete({
  value,
  onChange,
  onSelect,
  label = 'Suburb',
  placeholder = 'Start typing — e.g. St Kilda',
  error,
  id = 'suburb',
}: Props) {
  const [predictions, setPredictions] = useState<Prediction[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [degraded, setDegraded] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const sessionTokenRef = useRef<string | null>(null)
  const skipNextFetchRef = useRef(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // Refresh session token on focus — Google's session billing model.
  function ensureSessionToken() {
    if (!sessionTokenRef.current) {
      sessionTokenRef.current =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`
    }
    return sessionTokenRef.current
  }

  // Debounced fetch
  useEffect(() => {
    if (degraded) return
    if (skipNextFetchRef.current) {
      skipNextFetchRef.current = false
      return
    }
    const q = value.trim()
    if (q.length < 2) {
      setPredictions([])
      setLoading(false)
      return
    }
    setLoading(true)
    const handle = setTimeout(async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        const token = session?.access_token
        if (!token) {
          setLoading(false)
          return
        }
        const sessionToken = ensureSessionToken()
        const r = await fetch(
          `/api/places/autocomplete?q=${encodeURIComponent(q)}&sessionToken=${encodeURIComponent(sessionToken)}`,
          { headers: { Authorization: `Bearer ${token}` } },
        )
        if (!r.ok) {
          // 5xx or 503 (key missing) → degrade to plain input.
          if (r.status >= 500) setDegraded(true)
          setPredictions([])
          setLoading(false)
          return
        }
        const json = (await r.json()) as { predictions: Prediction[] }
        const list = json.predictions ?? []
        // Empty response with no key configured → degrade.
        if (list.length === 0 && q.length >= 3 && r.headers.get('content-type')?.includes('json')) {
          // Don't auto-degrade on legitimate empty results — only degrade when the
          // API explicitly returns an error status. This is a no-op branch kept
          // for clarity.
        }
        setPredictions(list)
        setActiveIndex(list.length > 0 ? 0 : -1)
      } catch (e) {
        console.error('[SuburbAutocomplete] fetch failed:', e)
        setDegraded(true)
        setPredictions([])
      } finally {
        setLoading(false)
      }
    }, DEBOUNCE_MS)
    return () => clearTimeout(handle)
  }, [value, degraded])

  // Close dropdown on outside click
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!containerRef.current) return
      if (!containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  async function selectPrediction(pred: Prediction) {
    const main = pred.structured_formatting?.main_text || pred.description.split(',')[0]
    // Optimistic: fill suburb text now, refine with details next.
    skipNextFetchRef.current = true
    onChange(main)
    setOpen(false)
    setPredictions([])

    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) return
      const sessionToken = sessionTokenRef.current ?? ensureSessionToken()
      const r = await fetch(
        `/api/places/details?place_id=${encodeURIComponent(pred.place_id)}&sessionToken=${encodeURIComponent(sessionToken)}`,
        { headers: { Authorization: `Bearer ${token}` } },
      )
      // End the Places session — next focus generates a fresh token.
      sessionTokenRef.current = null
      if (!r.ok) return
      const details = (await r.json()) as PlaceDetails
      onSelect({
        suburb: details.suburb || main,
        state: details.state ?? '',
        postcode: details.postcode ?? '',
      })
    } catch (e) {
      console.error('[SuburbAutocomplete] details failed:', e)
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || predictions.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => (i + 1) % predictions.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => (i <= 0 ? predictions.length - 1 : i - 1))
    } else if (e.key === 'Enter' && activeIndex >= 0) {
      e.preventDefault()
      void selectPrediction(predictions[activeIndex])
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  const showDropdown =
    open && !degraded && (loading || predictions.length > 0) && value.trim().length >= 2

  return (
    <div className="space-y-1" ref={containerRef}>
      <Label
        htmlFor={id}
        className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground font-medium"
      >
        {label}
      </Label>
      <div className="relative">
        <Input
          id={id}
          role="combobox"
          aria-expanded={showDropdown}
          aria-autocomplete="list"
          aria-controls={`${id}-listbox`}
          aria-activedescendant={
            activeIndex >= 0 ? `${id}-option-${activeIndex}` : undefined
          }
          autoComplete="off"
          value={value}
          onChange={(e) => {
            onChange(e.target.value)
            setOpen(true)
          }}
          onFocus={() => {
            ensureSessionToken()
            setOpen(true)
          }}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          className={cn(error && 'border-destructive')}
        />
        {loading && !degraded && (
          <Loader2 className="w-4 h-4 absolute right-2.5 top-1/2 -translate-y-1/2 animate-spin text-muted-foreground" />
        )}
        {showDropdown && (
          <ul
            id={`${id}-listbox`}
            role="listbox"
            className="absolute z-20 mt-1 w-full max-h-60 overflow-y-auto rounded-lg border bg-popover shadow-md ring-1 ring-foreground/10"
          >
            {loading && predictions.length === 0 && (
              <li className="px-3 py-2 text-xs text-muted-foreground">Searching…</li>
            )}
            {predictions.map((p, idx) => {
              const main = p.structured_formatting?.main_text || p.description
              const secondary = p.structured_formatting?.secondary_text
              return (
                <li
                  id={`${id}-option-${idx}`}
                  key={p.place_id}
                  role="option"
                  aria-selected={idx === activeIndex}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    void selectPrediction(p)
                  }}
                  onMouseEnter={() => setActiveIndex(idx)}
                  className={cn(
                    'flex items-start gap-2 px-3 py-2 text-sm cursor-pointer',
                    idx === activeIndex && 'bg-accent',
                  )}
                >
                  <MapPin className="w-3.5 h-3.5 mt-0.5 text-muted-foreground shrink-0" />
                  <div className="min-w-0">
                    <p className="truncate">{main}</p>
                    {secondary && (
                      <p className="text-xs text-muted-foreground truncate">{secondary}</p>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
      {degraded && (
        <p className="text-[11px] text-muted-foreground">
          Autocomplete unavailable — type the suburb manually.
        </p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
