import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { toast } from 'sonner'
import { subDays } from 'date-fns'
import type { FieldOutcome } from '@/lib/fieldOutcomes'

export type PinKind = 'warm' | 'deal' | 'reopening' | 'cold'

export interface FieldPin {
  id: string                       // contact_id or `vo:<observation_id>`
  kind: PinKind
  source: 'contact' | 'reopening'
  contact_id: string | null
  venue_observation_id: string | null
  name: string
  suburb: string | null
  address: string | null
  lat: number
  lng: number
  /** ISO timestamp of last activity / observation, used for cold detection. */
  last_activity_at: string | null
  /** When pinned from a reopening, the event_type for tooltip. */
  event_type?: 'reopened' | 'licensee_changed' | 'renamed' | 'status_flip' | 'manual' | null
}

export interface FieldVisit {
  id: string
  org_id: string
  user_id: string
  contact_id: string | null
  venue_observation_id: string | null
  outcome: FieldOutcome
  notes: string | null
  voice_transcript: string | null
  voice_audio_path: string | null
  lat: number | null
  lng: number | null
  visited_at: string
  created_at: string
}

const COLD_THRESHOLD_DAYS = 30

export function useFieldPins() {
  return useQuery({
    queryKey: ['field', 'pins'],
    queryFn: async (): Promise<FieldPin[]> => {
      // Contacts with lat/lng + their last activity
      const { data: contacts, error: cErr } = await supabase
        .from('contacts')
        .select(`
          id, full_name, lat, lng, last_visited_at, signal_reopening,
          venue:venues(suburb, address)
        `)
        .not('lat', 'is', null)
        .not('lng', 'is', null)
      if (cErr) throw cErr

      const contactIds = (contacts ?? []).map((c) => c.id)
      const lastActivityMap: Record<string, string> = {}
      if (contactIds.length > 0) {
        const { data: acts } = await supabase
          .from('activities')
          .select('contact_id, occurred_at')
          .in('contact_id', contactIds)
          .order('occurred_at', { ascending: false })
        for (const a of acts ?? []) {
          if (a.contact_id && !lastActivityMap[a.contact_id]) {
            lastActivityMap[a.contact_id] = a.occurred_at as string
          }
        }
      }

      // Active deals → contact_id set so we can mark "deal" pins
      const dealContactIds = new Set<string>()
      if (contactIds.length > 0) {
        const { data: deals } = await supabase
          .from('deals')
          .select('contact_id, closed_at, stage_id, pipeline_stages:stage_id(is_closed)')
          .in('contact_id', contactIds)
        for (const d of deals ?? []) {
          if (!d.contact_id) continue
          const stageRel = d.pipeline_stages as unknown as { is_closed?: boolean } | null
          const isClosed = !!d.closed_at || !!stageRel?.is_closed
          if (!isClosed) dealContactIds.add(d.contact_id)
        }
      }

      const coldCutoff = subDays(new Date(), COLD_THRESHOLD_DAYS).toISOString()

      const contactPins: FieldPin[] = (contacts ?? []).map((c) => {
        const venue = Array.isArray(c.venue) ? c.venue[0] : c.venue
        const lastAt = lastActivityMap[c.id] ?? (c.last_visited_at as string | null)
        let kind: PinKind = 'cold'
        if (dealContactIds.has(c.id)) {
          kind = 'deal'
        } else if (lastAt && lastAt > coldCutoff) {
          kind = 'warm'
        }
        return {
          id: c.id,
          kind,
          source: 'contact',
          contact_id: c.id,
          venue_observation_id: null,
          name: c.full_name as string,
          suburb: (venue?.suburb as string | null) ?? null,
          address: (venue?.address as string | null) ?? null,
          lat: c.lat as number,
          lng: c.lng as number,
          last_activity_at: lastAt,
        }
      })

      // Reopening events (undismissed, unconverted) with geocoded observations
      const { data: events, error: eErr } = await supabase
        .from('reopening_events')
        .select(`
          id, event_type, detected_at, dismissed_at, contact_id,
          vo:venue_observations!reopening_events_venue_observation_new_fkey(
            id, venue_name, suburb, address, lat, lng
          )
        `)
        .is('dismissed_at', null)
        .is('contact_id', null)
      if (eErr) throw eErr

      const eventPins: FieldPin[] = []
      for (const ev of events ?? []) {
        const vo = Array.isArray(ev.vo) ? ev.vo[0] : ev.vo
        if (!vo || vo.lat == null || vo.lng == null) continue
        eventPins.push({
          id: `vo:${vo.id}`,
          kind: 'reopening',
          source: 'reopening',
          contact_id: null,
          venue_observation_id: vo.id as string,
          name: vo.venue_name as string,
          suburb: (vo.suburb as string | null) ?? null,
          address: (vo.address as string | null) ?? null,
          lat: vo.lat as number,
          lng: vo.lng as number,
          last_activity_at: ev.detected_at as string,
          event_type: ev.event_type as FieldPin['event_type'],
        })
      }

      return [...contactPins, ...eventPins]
    },
  })
}

export interface CreateFieldVisitInput {
  org_id: string
  user_id: string
  contact_id?: string | null
  venue_observation_id?: string | null
  outcome: FieldVisit['outcome']
  notes?: string | null
  voice_transcript?: string | null
  voice_audio_path?: string | null
  lat?: number | null
  lng?: number | null
}

export function useCreateFieldVisit() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreateFieldVisitInput) => {
      const { data, error } = await supabase
        .from('field_visits')
        .insert({
          org_id: input.org_id,
          user_id: input.user_id,
          contact_id: input.contact_id ?? null,
          venue_observation_id: input.venue_observation_id ?? null,
          outcome: input.outcome,
          notes: input.notes ?? null,
          voice_transcript: input.voice_transcript ?? null,
          voice_audio_path: input.voice_audio_path ?? null,
          lat: input.lat ?? null,
          lng: input.lng ?? null,
        })
        .select()
        .single()

      if (error) throw error
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['field'] })
      qc.invalidateQueries({ queryKey: ['contacts'] })
      qc.invalidateQueries({ queryKey: ['activities'] })
      toast.success('Visit saved')
    },
    onError: (err: Error) => {
      toast.error(`Failed to save visit: ${err.message}`)
    },
  })
}

export interface RouteOptimizeResponse {
  ordered_ids: string[]
  total_distance_km: number
  estimated_minutes: number
}

export async function optimizeRoute(
  stops: Array<{ id: string; lat: number; lng: number }>,
  origin?: { lat: number; lng: number },
): Promise<RouteOptimizeResponse> {
  const { data: sessionData } = await supabase.auth.getSession()
  const token = sessionData.session?.access_token
  if (!token) throw new Error('Not signed in')
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/field-route-optimize`
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ stops, origin }),
  })
  if (!r.ok) throw new Error(`Route optimize failed: ${r.status}`)
  return await r.json()
}

export async function geocodeBatch(input: {
  contact_ids?: string[]
  venue_observation_ids?: string[]
} = {}): Promise<{ geocoded: number; failed: number; errors: string[] }> {
  const { data: sessionData } = await supabase.auth.getSession()
  const token = sessionData.session?.access_token
  if (!token) throw new Error('Not signed in')
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/geocode-batch`
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!r.ok) throw new Error(`Geocode failed: ${r.status}`)
  return await r.json()
}
