/**
 * Call Cycle Planner — TanStack Query hooks.
 *
 * All reads/writes go through the Vercel `/api/route/*` handlers (see
 * api/route/*.ts). Auth = bearer token from the active Supabase session.
 *
 * Phase 1 endpoints:
 *   GET  /api/route/week         — useRouteWeek()
 *   POST /api/route/upsert-day   — useUpsertRouteDay()
 *   POST /api/route/generate-day — useGenerateRouteDay()
 *   POST /api/route/mark-visited — useMarkRouteStopVisited()
 *   GET  /api/route/maps-url     — fetchRouteMapsUrl()
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { toast } from 'sonner'
import type { FieldOutcome } from '@/lib/fieldOutcomes'

export type StopKind = 'prospect' | 'follow_up' | 'anchor'

/** How Jordan can reach a venue, derived from what enrichment found. */
export type OutreachChannel = 'email' | 'phone_only' | 'visit_only' | 'none'

export interface RouteStop {
  id: string
  route_day_id: string
  stop_order: number
  stop_kind: StopKind
  est_arrival_min: number | null
  est_drive_km: number | null
  venue_id: string
  venue_name_cached: string
  suburb_cached: string | null
  lead_score_cached: number | null
  field_visit_id: string | null
  outreach_channel: OutreachChannel | null
  phone_cached: string | null
  venue: { lat: number | null; lng: number | null } | null
  field_visit: { visited_at: string; outcome: FieldOutcome } | null
}

export interface RouteDay {
  id: string
  day_of_week: number // 1..6
  anchor_venue_id: string | null
  anchor_lat: number | null
  anchor_lng: number | null
  suburb_focus: string | null
  prospect_share: number
  radius_km: number
  target_stops: number
  generated_at: string | null
  notes: string | null
  anchor_venue: { id: string; name: string; suburb: string | null; lat: number | null; lng: number | null } | null
  stops: RouteStop[]
}

interface WeekResponse { days: RouteDay[] }

async function authFetch(path: string, init?: RequestInit): Promise<Response> {
  const { data: sessionData } = await supabase.auth.getSession()
  const token = sessionData.session?.access_token
  if (!token) throw new Error('Not signed in')
  return fetch(path, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  })
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = `HTTP ${res.status}`
    try {
      const body = await res.json() as { error?: string; detail?: string }
      msg = body.error ?? msg
      if (body.detail) msg += ` — ${body.detail}`
    } catch { /* noop */ }
    throw new Error(msg)
  }
  return res.json() as Promise<T>
}

export function useRouteWeek() {
  return useQuery({
    queryKey: ['route', 'week'],
    queryFn: async (): Promise<RouteDay[]> => {
      const r = await authFetch('/api/route/week')
      const body = await jsonOrThrow<WeekResponse>(r)
      return body.days
    },
    staleTime: 5 * 60 * 1000,
  })
}

export interface UpsertDayInput {
  day_of_week: number
  anchor_venue_id?: string | null
  suburb_focus?: string | null
  anchor_lat?: number | null
  anchor_lng?: number | null
  radius_km?: number
  target_stops?: number
  prospect_share?: number
  notes?: string | null
}

export function useUpsertRouteDay() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: UpsertDayInput) => {
      const r = await authFetch('/api/route/upsert-day', {
        method: 'POST',
        body: JSON.stringify(input),
      })
      return jsonOrThrow<{ route_day_id: string }>(r)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['route'] })
    },
    onError: (err: Error) => toast.error(`Save failed: ${err.message}`),
  })
}

export function useGenerateRouteDay() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { route_day_id: string; lookback_days?: number }) => {
      const r = await authFetch('/api/route/generate-day', {
        method: 'POST',
        body: JSON.stringify(input),
      })
      return jsonOrThrow<{
        route_day_id: string
        stop_count: number
        total_distance_km: number
        estimated_minutes: number
      }>(r)
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['route'] })
      toast.success(
        `Generated ${data.stop_count} stops · ${data.total_distance_km.toFixed(1)}km · ~${data.estimated_minutes}min`,
      )
    },
    onError: (err: Error) => toast.error(`Generation failed: ${err.message}`),
  })
}

export interface MarkVisitedInput {
  route_stop_id: string
  outcome: FieldOutcome
  notes?: string | null
  voice_transcript?: string | null
  voice_audio_path?: string | null
  lat?: number | null
  lng?: number | null
  /** Email collected on the visit — feeds the normal verify→draft pipeline. */
  collected_email?: string | null
}

export function useMarkRouteStopVisited() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: MarkVisitedInput) => {
      const r = await authFetch('/api/route/mark-visited', {
        method: 'POST',
        body: JSON.stringify(input),
      })
      return jsonOrThrow<{ field_visit_id: string }>(r)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['route'] })
      qc.invalidateQueries({ queryKey: ['field'] })
      qc.invalidateQueries({ queryKey: ['activities'] })
      toast.success('Visit logged')
    },
    onError: (err: Error) => toast.error(`Mark visited failed: ${err.message}`),
  })
}

export async function fetchRouteMapsUrl(
  routeDayId: string,
  includeVisited = false,
): Promise<{ url: string; stop_count: number }> {
  const params = new URLSearchParams({ route_day_id: routeDayId })
  if (includeVisited) params.set('include_visited', '1')
  const r = await authFetch(`/api/route/maps-url?${params.toString()}`)
  return jsonOrThrow<{ url: string; stop_count: number; scheme: string }>(r)
}

/** Convert ISO weekday (1=Mon..7=Sun) to a 1..6 tab index, or null on Sunday. */
export function todayIsoWeekdayInRange(): number | null {
  // Use Australia/Melbourne; that's where Jordan plans his week.
  const fmt = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Melbourne', weekday: 'short' })
  const day = fmt.format(new Date()).toLowerCase()
  const map: Record<string, number> = { mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 7 }
  const iso = map[day] ?? 1
  return iso <= 6 ? iso : null
}

export const WEEKDAY_LABELS: Record<number, string> = {
  1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat',
}

export interface AreaCoverage {
  suburb_key: string
  suburb_label: string
  total_candidates: number
  phone_only: number
  visit_only: number
  contacted: number
  remaining: number
}

/**
 * Per-suburb coverage of the physical-prospecting funnel (phone_only +
 * visit_only venues), so Jordan can see how much of an area he's worked
 * through and keep chipping at "not yet contacted" over successive weeks.
 * Reads the RLS-scoped `venue_area_coverage` view directly.
 */
export function useAreaCoverage() {
  return useQuery({
    queryKey: ['route', 'coverage'],
    queryFn: async (): Promise<AreaCoverage[]> => {
      const { data, error } = await supabase
        .from('venue_area_coverage')
        .select('suburb_key, suburb_label, total_candidates, phone_only, visit_only, contacted, remaining')
        .order('remaining', { ascending: false })
      if (error) throw error
      return (data ?? []) as AreaCoverage[]
    },
    staleTime: 5 * 60 * 1000,
  })
}
