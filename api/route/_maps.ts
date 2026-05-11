/**
 * Pure Google Maps multi-stop URL builder, separated from the handler so it
 * can be unit-tested via `node --test --experimental-strip-types` without
 * pulling in @vercel/node + Supabase env at import time.
 */

export interface MapsStop {
  lat: number
  lng: number
  visited: boolean
}

export function buildGoogleMapsUrl(stops: MapsStop[], includeVisited: boolean): {
  url: string
  count: number
} {
  const filtered = includeVisited ? stops : stops.filter((s) => !s.visited)
  if (filtered.length === 0) {
    return { url: '', count: 0 }
  }
  if (filtered.length === 1) {
    const s = filtered[0]
    return { url: `https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}`, count: 1 }
  }
  const origin = filtered[0]
  const destination = filtered[filtered.length - 1]
  const waypoints = filtered.slice(1, -1).map((s) => `${s.lat},${s.lng}`).join('|')
  const params = new URLSearchParams({
    api: '1',
    travelmode: 'driving',
    origin: `${origin.lat},${origin.lng}`,
    destination: `${destination.lat},${destination.lng}`,
  })
  if (waypoints) params.set('waypoints', waypoints)
  return {
    url: `https://www.google.com/maps/dir/?${params.toString()}`,
    count: filtered.length,
  }
}
