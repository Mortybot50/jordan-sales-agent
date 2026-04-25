/**
 * ContactVoiceNoteDialog
 *
 * Modal that lets Jordan record a voice note from the Contacts page.
 * After transcription:
 *   - Logs a `voice_note` activity row (with transcript in body, audio
 *     path in metadata) against the matched contact (fuzzy by venue
 *     name) or null if no match.
 *   - Offers a "Create new contact" path when a venue_name was extracted
 *     and no fuzzy match exists.
 */

import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Mic, UserPlus, Save, Loader2 } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { VoiceNoteRecorder, type VoiceTranscriptionResult } from './VoiceNoteRecorder'
import { useContacts } from '@/lib/queries/contacts'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase'
import { toast } from 'sonner'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ContactVoiceNoteDialog({ open, onOpenChange }: Props) {
  const { user } = useAuth()
  const { data: contacts } = useContacts()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [result, setResult] = useState<VoiceTranscriptionResult | null>(null)
  const [saving, setSaving] = useState(false)

  const fuzzyMatch = useMemo(() => {
    if (!result?.extracted?.venue_name || !contacts) return null
    const needle = result.extracted.venue_name.toLowerCase()
    return contacts.find((c) => {
      const venueName = c.venue?.name?.toLowerCase() ?? ''
      const contactName = c.full_name.toLowerCase()
      return venueName.includes(needle) || needle.includes(venueName) || contactName.includes(needle)
    }) ?? null
  }, [result, contacts])

  function reset() {
    setResult(null)
    setSaving(false)
  }

  async function logActivity(contactId: string | null) {
    if (!user || !result) return
    setSaving(true)
    try {
      const { error } = await supabase.from('activities').insert({
        org_id: user.org_id,
        contact_id: contactId,
        activity_type: 'voice_note',
        subject: 'Voice note',
        body: result.transcript ?? '(audio only — no transcript)',
        metadata: {
          audio_path: result.audio_path,
          extracted: result.extracted,
        },
      })
      if (error) throw error
      qc.invalidateQueries({ queryKey: ['activities'] })
      toast.success(contactId ? 'Voice note logged on contact' : 'Voice note logged')
      onOpenChange(false)
      reset()
    } catch (err) {
      toast.error(`Failed to log: ${(err as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  function handleCreateNewContact() {
    if (!result?.extracted) return
    // Hand the extracted data off to the new-contact route as initial values.
    const params = new URLSearchParams()
    if (result.extracted.venue_name) params.set('venue_hint', result.extracted.venue_name)
    if (result.extracted.address) params.set('address', result.extracted.address)
    if (result.extracted.suburb) params.set('suburb', result.extracted.suburb)
    if (result.transcript) params.set('notes', result.transcript)
    navigate(`/contacts/new?${params.toString()}`)
    onOpenChange(false)
    reset()
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) reset() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mic className="size-4" />
            Voice note
          </DialogTitle>
        </DialogHeader>

        {!result ? (
          <div className="py-6 flex flex-col items-center gap-3">
            <p className="text-[13px] text-ink-muted text-center">
              Tap and hold to record. We'll transcribe and try to match to an existing contact, or offer to create a new one.
            </p>
            <VoiceNoteRecorder onResult={setResult} variant="full" />
          </div>
        ) : (
          <div className="space-y-3">
            {result.error && (
              <div className="rounded-md border border-hairline bg-[var(--jordan-warning-soft)] text-[var(--jordan-warning-text)] p-2 text-[12px]">
                {result.error}
              </div>
            )}

            {result.transcript && (
              <div className="space-y-1">
                <div className="text-[10px] uppercase tracking-[0.12em] text-ink-faint">Transcript</div>
                <div className="rounded-md bg-surface-2 border border-hairline p-2 text-[13px] text-ink whitespace-pre-wrap max-h-48 overflow-y-auto">
                  {result.transcript}
                </div>
              </div>
            )}

            {result.extracted && (
              <div className="space-y-1">
                <div className="text-[10px] uppercase tracking-[0.12em] text-ink-faint">Extracted</div>
                <dl className="text-[12.5px] grid grid-cols-[80px_1fr] gap-y-0.5 gap-x-2">
                  {(['venue_name', 'address', 'suburb', 'outcome_hint'] as const).map((k) => (
                    <FragmentRow key={k} label={k.replace('_', ' ')} value={result.extracted?.[k]} />
                  ))}
                </dl>
              </div>
            )}

            {fuzzyMatch && (
              <div className="rounded-md border border-[color:var(--jordan-accent-mint)] bg-[var(--jordan-accent-mint-soft)] p-2 text-[12.5px]">
                Matched existing contact: <span className="font-medium">{fuzzyMatch.full_name}</span>
                {fuzzyMatch.venue?.name ? <span className="text-ink-muted"> · {fuzzyMatch.venue.name}</span> : null}
              </div>
            )}

            <DialogFooter className="gap-2 sm:gap-2">
              {fuzzyMatch ? (
                <Button onClick={() => logActivity(fuzzyMatch.id)} disabled={saving} className="gap-2">
                  {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                  Log on {fuzzyMatch.full_name}
                </Button>
              ) : result.extracted?.venue_name ? (
                <>
                  <Button variant="outline" onClick={() => logActivity(null)} disabled={saving} className="gap-2">
                    <Save className="size-4" /> Just log it
                  </Button>
                  <Button onClick={handleCreateNewContact} className="gap-2">
                    <UserPlus className="size-4" /> Create new contact
                  </Button>
                </>
              ) : (
                <Button onClick={() => logActivity(null)} disabled={saving} className="gap-2">
                  {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                  Log voice note
                </Button>
              )}
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function FragmentRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <>
      <dt className="text-ink-faint capitalize">{label}</dt>
      <dd className="text-ink truncate">{value || <span className="text-ink-disabled">—</span>}</dd>
    </>
  )
}
