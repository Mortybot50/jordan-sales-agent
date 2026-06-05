/**
 * FieldPage — `/field`
 *
 * Day-in-the-field map + drop-in form for Jordan. Pins are pulled from
 * geocoded contacts and undismissed reopening events. Phase F Dark Anchor
 * palette — mint / accent / warning / faint surfaces only.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { Compass, Loader2, Route, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { CapsLabel, EmptyState, PageHeader, StatusPill } from '@/components/primitives'
import { VoiceNoteRecorder } from '@/components/voice/VoiceNoteRecorder'
import { useFieldPins, useCreateFieldVisit, optimizeRoute, type FieldPin } from '@/lib/queries/field'
import { useAuth } from '@/hooks/useAuth'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { FIELD_OUTCOME_OPTIONS, type FieldOutcome } from '@/lib/fieldOutcomes'

// Phase F palette — using existing tokens only (no new colours).
const PIN_COLOURS: Record<FieldPin['kind'], string> = {
  warm:      'var(--jordan-accent-mint)',     // mint — warm contact
  deal:      'var(--jordan-warning)',          // amber — active deal
  reopening: 'var(--jordan-danger)',           // red/orange — reopening event
  cold:      'var(--jordan-ink-faint, #94a3b8)', // grey — cold contact
}

const KIND_LABELS: Record<FieldPin['kind'], string> = {
  warm: 'Warm contact',
  deal: 'Active deal',
  reopening: 'Reopening',
  cold: 'Cold contact',
}

const VIC_CENTRE: [number, number] = [144.9631, -37.8136] // Melbourne

// MapLibre + OSM raster — per IDENTITY's "no Mapbox, MapLibre + OSM only"
// constraint. The previous demotiles.maplibre.org style is a low-detail
// world placeholder that rendered a near-blank canvas at Melbourne suburb
// zoom levels; the public OSM tile server gives real street detail and
// requires no API key. Tile-usage policy is fine for Jordan's solo cadence;
// attribution is rendered via maplibregl's built-in AttributionControl.
const OSM_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors',
      maxzoom: 19,
    },
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
}

export function FieldPage() {
  const { data: pins, isLoading } = useFieldPins()
  const { user } = useAuth()
  const createVisit = useCreateFieldVisit()

  const mapRef = useRef<maplibregl.Map | null>(null)
  const mapContainerRef = useRef<HTMLDivElement | null>(null)
  const markersRef = useRef<maplibregl.Marker[]>([])
  const routeLineId = 'field-route-line'

  const [suburbFilter, setSuburbFilter] = useState<string>('all')
  const [showKinds, setShowKinds] = useState<Set<FieldPin['kind']>>(
    new Set(['warm', 'deal', 'reopening', 'cold']),
  )
  const [planTodayOn, setPlanTodayOn] = useState(false)
  const [planLoading, setPlanLoading] = useState(false)
  const [orderedPins, setOrderedPins] = useState<FieldPin[] | null>(null)
  const [routeMeta, setRouteMeta] = useState<{ km: number; mins: number } | null>(null)
  const [selected, setSelected] = useState<FieldPin | null>(null)
  const [outcome, setOutcome] = useState<FieldOutcome>('interested')
  const [notes, setNotes] = useState('')

  const suburbs = useMemo(() => {
    const set = new Set<string>()
    for (const p of pins ?? []) if (p.suburb) set.add(p.suburb)
    return Array.from(set).sort()
  }, [pins])

  // Apply suburb + kind filters.
  const filteredPins = useMemo(() => {
    return (pins ?? []).filter((p) => {
      if (!showKinds.has(p.kind)) return false
      if (suburbFilter !== 'all' && p.suburb !== suburbFilter) return false
      return true
    })
  }, [pins, suburbFilter, showKinds])

  // Smart-suggestion: contacts not visited 6mo+ AND reopenings within 1km of any contact
  const suggestion = useMemo(() => {
    const sixMo = Date.now() - 1000 * 60 * 60 * 24 * 180
    const stale = (pins ?? []).filter(
      (p) => p.source === 'contact' && (!p.last_activity_at || new Date(p.last_activity_at).getTime() < sixMo),
    ).length
    const reopenings = (pins ?? []).filter((p) => p.kind === 'reopening')
    const contactPts = (pins ?? []).filter((p) => p.source === 'contact')
    let nearby = 0
    for (const r of reopenings) {
      for (const c of contactPts) {
        if (haversineKm(r, c) <= 1) { nearby++; break }
      }
    }
    return { stale, nearby }
  }, [pins])

  // Init map (once).
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return
    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: OSM_STYLE,
      center: VIC_CENTRE,
      zoom: 9,
      attributionControl: { compact: true },
    })
    map.addControl(new maplibregl.NavigationControl(), 'top-right')
    mapRef.current = map
    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [])

  // Render markers on filtered change.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    // Clear existing markers
    for (const m of markersRef.current) m.remove()
    markersRef.current = []

    for (const p of filteredPins) {
      const el = document.createElement('div')
      el.style.width = '14px'
      el.style.height = '14px'
      el.style.borderRadius = '50%'
      el.style.background = PIN_COLOURS[p.kind]
      el.style.border = '2px solid white'
      el.style.boxShadow = '0 1px 3px rgba(0,0,0,0.4)'
      el.style.cursor = 'pointer'
      el.title = `${p.name} — ${KIND_LABELS[p.kind]}`
      el.addEventListener('click', () => {
        setSelected(p)
        setOutcome('interested')
        setNotes('')
        map.flyTo({ center: [p.lng, p.lat], zoom: 14 })
      })

      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([p.lng, p.lat])
        .addTo(map)
      markersRef.current.push(marker)
    }

    // If suburb filter or pins, fit bounds.
    if (filteredPins.length > 0) {
      const bounds = new maplibregl.LngLatBounds()
      for (const p of filteredPins) bounds.extend([p.lng, p.lat])
      try { map.fitBounds(bounds, { padding: 60, maxZoom: 14, duration: 500 }) } catch { /* noop */ }
    }
  }, [filteredPins])

  // Render route line when ordered.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const apply = () => {
      // Remove existing
      if (map.getLayer(routeLineId)) map.removeLayer(routeLineId)
      if (map.getSource(routeLineId)) map.removeSource(routeLineId)
      if (!planTodayOn || !orderedPins || orderedPins.length < 2) return
      map.addSource(routeLineId, {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'LineString',
            coordinates: orderedPins.map((p) => [p.lng, p.lat]),
          },
        },
      })
      map.addLayer({
        id: routeLineId,
        type: 'line',
        source: routeLineId,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#2dd47c',
          'line-width': 3,
          'line-opacity': 0.85,
          'line-dasharray': [2, 2],
        },
      })
    }
    if (map.isStyleLoaded()) apply()
    else map.once('load', apply)
  }, [planTodayOn, orderedPins])

  async function handlePlanToday() {
    if (planTodayOn) {
      setPlanTodayOn(false)
      setOrderedPins(null)
      setRouteMeta(null)
      return
    }
    if (filteredPins.length === 0) {
      toast.warning('No pins to plan')
      return
    }
    setPlanLoading(true)
    try {
      const res = await optimizeRoute(
        filteredPins.map((p) => ({ id: p.id, lat: p.lat, lng: p.lng })),
      )
      const idToPin = new Map(filteredPins.map((p) => [p.id, p]))
      const ordered = res.ordered_ids.map((id) => idToPin.get(id)).filter(Boolean) as FieldPin[]
      setOrderedPins(ordered)
      setRouteMeta({ km: res.total_distance_km, mins: res.estimated_minutes })
      setPlanTodayOn(true)
    } catch (err) {
      console.error(err)
      toast.error('Route planning failed')
    } finally {
      setPlanLoading(false)
    }
  }

  function toggleKind(kind: FieldPin['kind']) {
    setShowKinds((s) => {
      const next = new Set(s)
      if (next.has(kind)) next.delete(kind)
      else next.add(kind)
      return next
    })
  }

  async function handleSaveVisit() {
    if (!selected || !user) return
    await createVisit.mutateAsync({
      org_id: user.org_id,
      user_id: user.id,
      contact_id: selected.contact_id,
      venue_observation_id: selected.venue_observation_id,
      outcome,
      notes: notes || null,
      lat: selected.lat,
      lng: selected.lng,
    })
    setSelected(null)
    setNotes('')
  }

  return (
    <div className="flex h-full flex-col">
      <div className="px-6 pt-6 pb-3 flex items-start justify-between gap-3">
        <PageHeader
          eyebrow="Field"
          title="Field Mode"
          description="Map of warm contacts, active deals, and reopening events — plan a sensible drive route and log drop-ins as you go."
        />
        <Button asChild variant="outline" size="sm" className="shrink-0 gap-2 mt-1">
          <Link to="/route">
            <Route className="size-4" />
            <span className="hidden sm:inline">View week</span>
            <span className="sm:hidden">Week</span>
          </Link>
        </Button>
      </div>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[1fr_400px] min-h-0">
        {/* Map */}
        <div className="relative bg-surface-2 lg:border-r border-hairline min-h-[40vh]">
          <div ref={mapContainerRef} className="absolute inset-0" />
          {isLoading && (
            <div className="absolute inset-0 flex items-center justify-center bg-surface-1/60 text-sm text-ink-muted">
              <Loader2 className="size-4 animate-spin mr-2" /> Loading pins…
            </div>
          )}
        </div>

        {/* Sidebar */}
        <aside className="overflow-y-auto bg-surface-1 p-4 space-y-5">
          {/* Smart suggestion strip */}
          <div className="rounded-[10px] border border-hairline bg-[color:var(--jordan-accent-mint-soft)] px-3 py-2.5">
            <CapsLabel className="text-[9px] mb-1">While you're here</CapsLabel>
            <p className="text-[12.5px] leading-snug text-ink">
              <span className="font-medium">{suggestion.stale}</span> contacts not visited 6mo+,{' '}
              <span className="font-medium">{suggestion.nearby}</span> reopenings within 1km of a contact.
            </p>
          </div>

          {/* Suburb filter */}
          <div className="space-y-1.5">
            <CapsLabel className="text-[9px]">Suburb</CapsLabel>
            <Select value={suburbFilter} onValueChange={setSuburbFilter}>
              <SelectTrigger>
                <SelectValue placeholder="All suburbs" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All suburbs</SelectItem>
                {suburbs.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Kind toggles */}
          <div className="space-y-1.5">
            <CapsLabel className="text-[9px]">Show</CapsLabel>
            <div className="flex flex-wrap gap-2">
              {(['warm', 'deal', 'reopening', 'cold'] as const).map((k) => {
                const active = showKinds.has(k)
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => toggleKind(k)}
                    className={cn(
                      'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px] border transition-colors',
                      active
                        ? 'bg-surface-2 text-ink border-hairline'
                        : 'bg-transparent text-ink-faint border-hairline opacity-60 hover:opacity-90',
                    )}
                  >
                    <span
                      aria-hidden
                      className="w-2 h-2 rounded-full"
                      style={{ background: PIN_COLOURS[k] }}
                    />
                    {KIND_LABELS[k]}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Plan today */}
          <div className="space-y-1.5">
            <CapsLabel className="text-[9px]">Route</CapsLabel>
            <Button
              type="button"
              variant={planTodayOn ? 'default' : 'outline'}
              size="sm"
              className="w-full justify-center gap-2"
              onClick={handlePlanToday}
              disabled={planLoading}
            >
              {planLoading ? <Loader2 className="size-4 animate-spin" /> : <Route className="size-4" />}
              {planTodayOn ? 'Clear plan' : 'Plan today'}
            </Button>
            {planTodayOn && routeMeta && orderedPins && (
              <div className="mt-2 space-y-2">
                <div className="text-[12px] text-ink-muted">
                  {orderedPins.length} stops · {routeMeta.km} km · ~{routeMeta.mins} min
                </div>
                <ol className="space-y-1 text-[13px]">
                  {orderedPins.map((p, i) => (
                    <li key={p.id} className="flex gap-2 items-baseline">
                      <span className="text-ink-faint jordan-tnum w-4">{i + 1}.</span>
                      <button
                        type="button"
                        className="text-left hover:underline truncate"
                        onClick={() => {
                          setSelected(p)
                          mapRef.current?.flyTo({ center: [p.lng, p.lat], zoom: 14 })
                        }}
                      >
                        {p.name}{p.suburb ? <span className="text-ink-faint"> · {p.suburb}</span> : null}
                      </button>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>

          {/* Drop-in form */}
          {selected ? (
            <div className="rounded-[10px] border border-hairline bg-surface-2 p-3 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[13px] font-semibold text-ink truncate">{selected.name}</div>
                  <div className="text-[11.5px] text-ink-muted truncate">
                    {selected.address ?? '—'}{selected.suburb ? ` · ${selected.suburb}` : ''}
                  </div>
                  <div className="mt-1.5 flex items-center gap-1.5">
                    <span
                      aria-hidden
                      className="inline-block w-2 h-2 rounded-full"
                      style={{ background: PIN_COLOURS[selected.kind] }}
                    />
                    <StatusPill tone="neutral">{KIND_LABELS[selected.kind]}</StatusPill>
                  </div>
                </div>
                <Button variant="ghost" size="icon" onClick={() => setSelected(null)} aria-label="Close drop-in form">
                  <X className="size-4" />
                </Button>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="outcome">Outcome</Label>
                <Select value={outcome} onValueChange={(v) => setOutcome(v as FieldOutcome)}>
                  <SelectTrigger id="outcome">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FIELD_OUTCOME_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="notes">Notes</Label>
                <Textarea
                  id="notes"
                  rows={3}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="What happened? Any quotes, vibes, follow-ups?"
                />
              </div>

              <div className="flex items-center gap-2">
                <VoiceNoteRecorder
                  variant="compact"
                  onResult={(res) => {
                    if (res.transcript) {
                      setNotes((prev) => prev ? `${prev}\n${res.transcript}` : res.transcript ?? '')
                    }
                  }}
                />
                <Button
                  type="button"
                  className="flex-1"
                  onClick={handleSaveVisit}
                  disabled={createVisit.isPending}
                >
                  {createVisit.isPending ? <Loader2 className="size-4 animate-spin mr-2" /> : null}
                  Save visit
                </Button>
              </div>
            </div>
          ) : filteredPins.length === 0 && !isLoading ? (
            <EmptyState
              icon={Compass}
              title="No pins on the map"
              body="Add a venue address to a contact to see them here — open Contacts, pick a contact, set the venue address. Reopening Radar pins appear automatically when VCGLR data refreshes."
            />
          ) : (
            <div className="rounded-[10px] border border-dashed border-hairline px-3 py-4 text-[12px] text-ink-faint text-center">
              Tap a pin to log a drop-in
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLng = ((b.lng - a.lng) * Math.PI) / 180
  const lat1 = (a.lat * Math.PI) / 180
  const lat2 = (b.lat * Math.PI) / 180
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}
