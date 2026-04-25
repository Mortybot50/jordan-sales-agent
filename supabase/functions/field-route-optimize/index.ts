/**
 * field-route-optimize — Supabase Edge Function
 *
 * Greedy nearest-neighbour TSP heuristic over a set of geocoded stops.
 * v1 only — no external routing API. Distance via Haversine; ETA assumes
 * 30 km/h average urban driving.
 *
 * Auth: user JWT (no DB writes — purely arithmetic).
 *
 * POST body:
 *   {
 *     stops: [{ id: string, lat: number, lng: number }, ...],
 *     origin?: { lat: number, lng: number }   // optional starting point
 *   }
 *
 * Response:
 *   {
 *     ordered_ids: string[],
 *     total_distance_km: number,
 *     estimated_minutes: number
 *   }
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const URBAN_AVG_KMH = 30

interface Stop { id: string; lat: number; lng: number }
interface Origin { lat: number; lng: number }

// @ts-expect-error Deno serve
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  if (!req.headers.get('Authorization')) {
    return jsonResponse({ error: 'Missing Authorization header' }, 401)
  }

  let body: { stops?: Stop[]; origin?: Origin } = {}
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400)
  }

  const stops = (body.stops ?? []).filter(
    (s) => s && typeof s.id === 'string' && Number.isFinite(s.lat) && Number.isFinite(s.lng),
  )
  if (stops.length === 0) {
    return jsonResponse({ ordered_ids: [], total_distance_km: 0, estimated_minutes: 0 }, 200)
  }
  if (stops.length === 1) {
    return jsonResponse({ ordered_ids: [stops[0].id], total_distance_km: 0, estimated_minutes: 0 }, 200)
  }

  // Greedy nearest-neighbour from origin (or first stop if no origin given).
  const remaining = [...stops]
  const ordered: Stop[] = []

  let cursor: { lat: number; lng: number }
  if (body.origin && Number.isFinite(body.origin.lat) && Number.isFinite(body.origin.lng)) {
    cursor = { lat: body.origin.lat, lng: body.origin.lng }
  } else {
    const first = remaining.shift()!
    ordered.push(first)
    cursor = { lat: first.lat, lng: first.lng }
  }

  let totalKm = 0
  while (remaining.length > 0) {
    let bestIdx = 0
    let bestDist = haversineKm(cursor, remaining[0])
    for (let i = 1; i < remaining.length; i++) {
      const d = haversineKm(cursor, remaining[i])
      if (d < bestDist) {
        bestDist = d
        bestIdx = i
      }
    }
    const next = remaining.splice(bestIdx, 1)[0]
    ordered.push(next)
    totalKm += bestDist
    cursor = { lat: next.lat, lng: next.lng }
  }

  const estimatedMinutes = Math.round((totalKm / URBAN_AVG_KMH) * 60)

  return jsonResponse({
    ordered_ids: ordered.map((s) => s.id),
    total_distance_km: round1(totalKm),
    estimated_minutes: estimatedMinutes,
  }, 200)
})

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

function toRad(deg: number): number { return (deg * Math.PI) / 180 }
function round1(n: number): number { return Math.round(n * 10) / 10 }

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
