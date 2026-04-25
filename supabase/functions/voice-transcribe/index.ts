/**
 * voice-transcribe — Supabase Edge Function
 *
 * Accepts a multipart/form-data audio upload, persists to Storage under
 * voice-notes/{user_id}/{uuid}.webm, then:
 *   - if OPENAI_API_KEY is set: transcribes via OpenAI Whisper (whisper-1)
 *     and runs a Claude Haiku extraction pass for venue/address/outcome
 *   - if OPENAI_API_KEY is not set: stores audio only and returns a stub
 *     error so the audio is preserved for later transcription.
 *
 * Auth: user JWT, RLS via storage policies (per-user folder).
 *
 * Response shape (always 200 on successful upload, even when transcription
 * is unavailable, so the client can save the path):
 *   {
 *     transcript: string | null,
 *     extracted: { venue_name, address, suburb, outcome_hint, notes } | null,
 *     audio_path: string,
 *     error?: string
 *   }
 */

// @ts-expect-error Deno edge runtime import — not typed in Node tsc
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// @ts-expect-error Deno globals
const SUPABASE_URL = Deno.env.get('VITE_SUPABASE_URL') ?? Deno.env.get('SUPABASE_URL')!
// @ts-expect-error Deno globals
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
// @ts-expect-error Deno globals
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')
// @ts-expect-error Deno globals
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface Extracted {
  venue_name: string | null
  address: string | null
  suburb: string | null
  outcome_hint: string | null
  notes: string | null
}

// @ts-expect-error Deno serve
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return jsonResponse({ error: 'Missing Authorization header' }, 401)

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  })

  // Identify the user (RLS will gate storage writes anyway, but we also use
  // user.id for the folder convention).
  const { data: userData, error: userErr } = await supabase.auth.getUser()
  if (userErr || !userData?.user) {
    return jsonResponse({ error: 'Unauthenticated' }, 401)
  }
  const userId = userData.user.id

  // Parse multipart form
  let form: FormData
  try {
    form = await req.formData()
  } catch (e) {
    return jsonResponse({ error: `Invalid multipart body: ${String(e)}` }, 400)
  }

  const audio = form.get('audio')
  if (!(audio instanceof File) && !(audio instanceof Blob)) {
    return jsonResponse({ error: 'Missing "audio" form field' }, 400)
  }

  const fileExt = (audio instanceof File && audio.name.includes('.'))
    ? audio.name.split('.').pop()
    : 'webm'
  const audioPath = `${userId}/${crypto.randomUUID()}.${fileExt}`

  const { error: upErr } = await supabase.storage
    .from('voice-notes')
    .upload(audioPath, audio, {
      contentType: (audio as File).type || 'audio/webm',
      upsert: false,
    })
  if (upErr) {
    return jsonResponse({ error: `Storage upload failed: ${upErr.message}` }, 500)
  }

  if (!OPENAI_API_KEY) {
    return jsonResponse({
      transcript: null,
      extracted: null,
      audio_path: audioPath,
      error: 'Voice transcription requires Morty to set OPENAI_API_KEY in Supabase secrets. Audio is saved.',
    }, 200)
  }

  // Transcribe via OpenAI Whisper
  let transcript: string | null = null
  try {
    const whisperForm = new FormData()
    whisperForm.append('file', audio, `voice-${Date.now()}.${fileExt}`)
    whisperForm.append('model', 'whisper-1')
    const wr = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}` },
      body: whisperForm,
    })
    if (!wr.ok) {
      const errText = await wr.text()
      return jsonResponse({
        transcript: null,
        extracted: null,
        audio_path: audioPath,
        error: `Whisper API ${wr.status}: ${errText.slice(0, 300)}`,
      }, 200)
    }
    const wj = await wr.json() as { text?: string }
    transcript = wj.text ?? null
  } catch (e) {
    return jsonResponse({
      transcript: null,
      extracted: null,
      audio_path: audioPath,
      error: `Whisper call failed: ${String(e)}`,
    }, 200)
  }

  if (!transcript || transcript.trim().length === 0) {
    return jsonResponse({
      transcript: null,
      extracted: null,
      audio_path: audioPath,
      error: 'Transcription produced empty output',
    }, 200)
  }

  // Optional Claude Haiku extraction pass
  let extracted: Extracted | null = null
  if (ANTHROPIC_API_KEY) {
    extracted = await extractWithClaude(transcript).catch(() => null)
  }

  return jsonResponse({
    transcript,
    extracted,
    audio_path: audioPath,
  }, 200)
})

async function extractWithClaude(transcript: string): Promise<Extracted | null> {
  const prompt = `Extract venue name, suburb, address, and any sales context from this rep's voice note. Return JSON: { "venue_name": ..., "address": ..., "suburb": ..., "outcome_hint": ..., "notes": ... }. Use null for any field you can't extract. outcome_hint should be one of: "interested", "not_now", "closed", "not_in", "dm_absent", "other", or null.\n\nVoice note: "${transcript.replace(/"/g, '\\"')}"`

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5',
      max_tokens: 400,
      messages: [{ role: 'user', content: prompt }],
    }),
  })
  if (!r.ok) return null
  const j = await r.json() as { content?: Array<{ type: string; text?: string }> }
  const text = j.content?.find((c) => c.type === 'text')?.text ?? ''
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) return null
  try {
    const parsed = JSON.parse(match[0]) as Partial<Extracted>
    return {
      venue_name: parsed.venue_name ?? null,
      address: parsed.address ?? null,
      suburb: parsed.suburb ?? null,
      outcome_hint: parsed.outcome_hint ?? null,
      notes: parsed.notes ?? null,
    }
  } catch {
    return null
  }
}

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
