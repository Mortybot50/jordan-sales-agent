import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { toast } from 'sonner'
import { subDays } from 'date-fns'

export interface ReopeningEvent {
  id: string
  detected_at: string
  event_type: 'reopened' | 'licensee_changed' | 'renamed' | 'status_flip' | 'manual'
  dismissed_at: string | null
  contact_id: string | null
  new: {
    id: string
    venue_name: string
    address: string | null
    suburb: string | null
    licensee: string | null
    licence_type: string | null
    business_status: string
    evidence_url: string | null
    source: 'vcglr' | 'google_places' | 'manual'
  }
  prior: {
    id: string
    venue_name: string | null
    licensee: string | null
    business_status: string | null
  } | null
}

interface RawRow {
  id: string
  detected_at: string
  event_type: ReopeningEvent['event_type']
  dismissed_at: string | null
  contact_id: string | null
  venue_observation_new: {
    id: string
    venue_name: string
    address: string | null
    suburb: string | null
    licensee: string | null
    licence_type: string | null
    business_status: string
    evidence_url: string | null
    source: 'vcglr' | 'google_places' | 'manual'
  } | null
  venue_observation_prior: {
    id: string
    venue_name: string | null
    licensee: string | null
    business_status: string | null
  } | null
}

const SELECT = `
  id, detected_at, event_type, dismissed_at, contact_id,
  venue_observation_new:venue_observations!reopening_events_venue_observation_new_fkey(
    id, venue_name, address, suburb, licensee, licence_type, business_status, evidence_url, source
  ),
  venue_observation_prior:venue_observations!reopening_events_venue_observation_prior_fkey(
    id, venue_name, licensee, business_status
  )
`

function mapRow(r: RawRow): ReopeningEvent {
  return {
    id: r.id,
    detected_at: r.detected_at,
    event_type: r.event_type,
    dismissed_at: r.dismissed_at,
    contact_id: r.contact_id,
    new: {
      id: r.venue_observation_new?.id ?? '',
      venue_name: r.venue_observation_new?.venue_name ?? 'Unknown',
      address: r.venue_observation_new?.address ?? null,
      suburb: r.venue_observation_new?.suburb ?? null,
      licensee: r.venue_observation_new?.licensee ?? null,
      licence_type: r.venue_observation_new?.licence_type ?? null,
      business_status: r.venue_observation_new?.business_status ?? 'ACTIVE',
      evidence_url: r.venue_observation_new?.evidence_url ?? null,
      source: r.venue_observation_new?.source ?? 'manual',
    },
    prior: r.venue_observation_prior
      ? {
          id: r.venue_observation_prior.id,
          venue_name: r.venue_observation_prior.venue_name,
          licensee: r.venue_observation_prior.licensee,
          business_status: r.venue_observation_prior.business_status,
        }
      : null,
  }
}

/** List all active (undismissed, unconverted) reopening events for the current org. */
export function useReopeningEvents() {
  return useQuery({
    queryKey: ['reopening-radar', 'events'],
    queryFn: async (): Promise<ReopeningEvent[]> => {
      const { data, error } = await supabase
        .from('reopening_events')
        .select(SELECT)
        .is('dismissed_at', null)
        .is('contact_id', null)
        .order('detected_at', { ascending: false })
        .limit(100)
      if (error) throw error
      return (data as unknown as RawRow[] | null ?? []).map(mapRow)
    },
  })
}

/** Dashboard KPI: count of reopening_events.detected_at >= 7d ago + 30-day daily buckets. */
export interface ReopeningRadarKPI {
  thisWeekCount: number
  last30d: number[] // length 30, [oldest..newest]
}

export function useReopeningRadarKPI() {
  return useQuery({
    queryKey: ['dashboard', 'reopening-radar-kpi'],
    queryFn: async (): Promise<ReopeningRadarKPI> => {
      const since30d = subDays(new Date(), 30).toISOString()
      const since7d = subDays(new Date(), 7).toISOString()

      const [{ data: allRows }, { count: thisWeekCount }] = await Promise.all([
        supabase
          .from('reopening_events')
          .select('detected_at')
          .gte('detected_at', since30d),
        supabase
          .from('reopening_events')
          .select('id', { count: 'exact', head: true })
          .gte('detected_at', since7d),
      ])

      // Build 30-day sparkline buckets (oldest → newest). Bucket 0 = 29 days ago.
      const buckets = new Array(30).fill(0) as number[]
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      for (const row of allRows ?? []) {
        const d = new Date(row.detected_at as unknown as string)
        d.setHours(0, 0, 0, 0)
        const diff = Math.floor((today.getTime() - d.getTime()) / (24 * 60 * 60 * 1000))
        const idx = 29 - diff
        if (idx >= 0 && idx < 30) buckets[idx]++
      }

      return { thisWeekCount: thisWeekCount ?? 0, last30d: buckets }
    },
    staleTime: 60_000,
  })
}

export interface ManualSeedInput {
  venue_name: string
  address?: string
  suburb?: string
  licensee?: string
  licence_type?: string
  prior_name?: string
  prior_licensee?: string
  evidence_url?: string
}

/** Calls the reopening-radar-manual Edge Function with the user's JWT. */
export function useManualSeed() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: ManualSeedInput) => {
      const { data: sess } = await supabase.auth.getSession()
      const token = sess.session?.access_token
      if (!token) throw new Error('Not signed in')

      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/reopening-radar-manual`
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(input),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }))
        throw new Error(err.error ?? `Failed: ${res.status}`)
      }
      return await res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reopening-radar'] })
      qc.invalidateQueries({ queryKey: ['dashboard', 'reopening-radar-kpi'] })
      toast.success('Reopening added')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

/** Soft-dismiss a reopening event (sets dismissed_at). */
export function useDismissReopening() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (eventId: string) => {
      const { error } = await supabase
        .from('reopening_events')
        .update({ dismissed_at: new Date().toISOString() })
        .eq('id', eventId)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reopening-radar'] })
      qc.invalidateQueries({ queryKey: ['dashboard', 'reopening-radar-kpi'] })
      toast.success('Dismissed')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

/**
 * Promote a reopening event to a contact — creates a fresh contacts row,
 * stamps signal_reopening, links the event to it, and inserts a first
 * activity row "Detected via Reopening Radar — {source}".
 *
 * We hold the whole thing together at app layer since we only have
 * user JWT + RLS (no server-side RPC for this yet).
 */
export function usePromoteReopening() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      event,
      orgId,
      defaultContactName,
    }: {
      event: ReopeningEvent
      orgId: string
      defaultContactName?: string
    }) => {
      const fullName = defaultContactName
        ?? event.new.licensee
        ?? `${event.new.venue_name} — decision maker`

      const signal_reopening = {
        source: event.new.source,
        detected_at: event.detected_at,
        prior_status: event.prior?.business_status ?? null,
        new_status: event.new.business_status,
        prior_licensee: event.prior?.licensee ?? null,
        new_licensee: event.new.licensee,
        prior_name: event.prior?.venue_name ?? null,
        new_name: event.new.venue_name,
        address: event.new.address,
        evidence_url: event.new.evidence_url,
      }

      const { data: contact, error: contactErr } = await supabase
        .from('contacts')
        .insert({
          org_id: orgId,
          full_name: fullName,
          notes: `Imported from Reopening Radar — ${event.new.venue_name}${event.new.suburb ? ` (${event.new.suburb})` : ''}`,
          signal_reopening,
        })
        .select('id')
        .single()
      if (contactErr || !contact) throw contactErr ?? new Error('contact insert failed')

      const { error: linkErr } = await supabase
        .from('reopening_events')
        .update({ contact_id: contact.id })
        .eq('id', event.id)
      if (linkErr) throw linkErr

      const { error: actErr } = await supabase.from('activities').insert({
        org_id: orgId,
        contact_id: contact.id,
        activity_type: 'note',
        subject: `Detected via Reopening Radar — ${event.new.source}`,
        body: `Event: ${event.event_type.replace(/_/g, ' ')}\n${event.new.evidence_url ? `Evidence: ${event.new.evidence_url}` : ''}`,
      })
      if (actErr) {
        console.warn('[reopening] activity insert skipped:', actErr.message)
      }

      return { contactId: contact.id }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reopening-radar'] })
      qc.invalidateQueries({ queryKey: ['dashboard', 'reopening-radar-kpi'] })
      qc.invalidateQueries({ queryKey: ['contacts'] })
      qc.invalidateQueries({ queryKey: ['deals'] })
      toast.success('Added to pipeline')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}
