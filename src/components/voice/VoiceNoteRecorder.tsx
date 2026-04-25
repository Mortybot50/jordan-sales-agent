/**
 * VoiceNoteRecorder
 *
 * Hold-to-record (or tap-toggle) mic button. Captures via the browser
 * MediaRecorder API, uploads to the `voice-transcribe` Edge Function,
 * and surfaces transcript + extracted fields back to the caller.
 *
 * Phase F Dark Anchor: mint accent when idle, danger when recording (we
 * don't have an amber token at the variant level, so danger stands in
 * for the "live recording" cue per the existing palette).
 */

import { useEffect, useRef, useState } from 'react'
import { Mic, MicOff, Loader2, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { supabase } from '@/lib/supabase'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

export interface VoiceTranscriptionResult {
  transcript: string | null
  extracted: {
    venue_name: string | null
    address: string | null
    suburb: string | null
    outcome_hint: string | null
    notes: string | null
  } | null
  audio_path: string
  error?: string
}

interface VoiceNoteRecorderProps {
  /** Called when transcription completes (success or graceful no-key). */
  onResult: (result: VoiceTranscriptionResult) => void
  /** Optional override for button label. */
  label?: string
  /** Compact (icon only) or full (icon + label). */
  variant?: 'compact' | 'full'
  className?: string
  disabled?: boolean
}

type Phase = 'idle' | 'recording' | 'uploading' | 'denied'

export function VoiceNoteRecorder({
  onResult,
  label = 'Voice note',
  variant = 'full',
  className,
  disabled = false,
}: VoiceNoteRecorderProps) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [elapsed, setElapsed] = useState(0)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        recorderRef.current.stop()
      }
      streamRef.current?.getTracks().forEach((t) => t.stop())
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [])

  async function startRecording() {
    if (disabled || phase !== 'idle') return
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const mr = new MediaRecorder(stream)
      chunksRef.current = []
      mr.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data)
      }
      mr.onstop = handleStop
      mr.start()
      recorderRef.current = mr
      setPhase('recording')
      setElapsed(0)
      intervalRef.current = setInterval(() => setElapsed((s) => s + 1), 1000)
    } catch (err) {
      console.error('[VoiceNoteRecorder] mic permission denied:', err)
      setPhase('denied')
      toast.error('Mic permission denied — type instead')
    }
  }

  function stopRecording() {
    if (phase !== 'recording') return
    recorderRef.current?.stop()
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }

  async function handleStop() {
    setPhase('uploading')
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null

    const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
    chunksRef.current = []

    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const token = sessionData.session?.access_token
      if (!token) {
        toast.error('Not signed in')
        setPhase('idle')
        return
      }

      const formData = new FormData()
      formData.append('audio', blob, `voice-${Date.now()}.webm`)

      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/voice-transcribe`
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData,
      })
      const json = (await r.json()) as VoiceTranscriptionResult
      if (json.error && !json.transcript) {
        toast.warning(json.error)
      } else if (json.transcript) {
        toast.success('Voice note transcribed')
      }
      onResult(json)
    } catch (err) {
      console.error('[VoiceNoteRecorder] upload failed:', err)
      toast.error('Voice upload failed')
    } finally {
      setPhase('idle')
      setElapsed(0)
    }
  }

  const isRecording = phase === 'recording'
  const isUploading = phase === 'uploading'

  const Icon = isUploading ? Loader2 : isRecording ? Square : phase === 'denied' ? MicOff : Mic

  return (
    <Button
      type="button"
      size={variant === 'compact' ? 'icon' : 'sm'}
      variant={isRecording ? 'destructive' : 'outline'}
      disabled={disabled || isUploading || phase === 'denied'}
      onClick={isRecording ? stopRecording : startRecording}
      onPointerDown={(e) => {
        // Hold-to-record on pointer devices: only start if not already recording
        if (!isRecording && phase === 'idle' && !disabled) {
          e.preventDefault()
          startRecording()
        }
      }}
      onPointerUp={() => {
        if (isRecording) stopRecording()
      }}
      onPointerLeave={() => {
        if (isRecording) stopRecording()
      }}
      className={cn(
        'gap-2',
        !isRecording && phase !== 'denied' && 'border-[color:var(--jordan-accent-mint)] text-[color:var(--jordan-success-text)] hover:bg-[color:var(--jordan-accent-mint-soft)]',
        isRecording && 'animate-pulse',
        className,
      )}
      aria-label={isRecording ? 'Stop recording' : label}
    >
      <Icon className={cn('size-4', isUploading && 'animate-spin')} />
      {variant === 'full' && (
        <span>
          {phase === 'denied'
            ? 'Mic blocked'
            : isUploading
              ? 'Transcribing…'
              : isRecording
                ? `Recording ${elapsed}s — release`
                : label}
        </span>
      )}
    </Button>
  )
}
