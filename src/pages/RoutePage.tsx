/**
 * RoutePage — `/route`
 *
 * Call Cycle Planner Phase 1 — weekly diary view.
 * Mon–Sat tabs (1..6 ISO weekday), per-day anchor + radius, suggested stops,
 * mark-visited drawer wired to field_visits via /api/route/mark-visited.
 *
 * Phase F Dark Anchor design tokens only — no new colours.
 */

import { useMemo, useState } from 'react'
import { Loader2, MapPin, Navigation, RotateCw, Sparkles, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { CapsLabel, EmptyState, PageHeader, ScoreBadge, StatusPill, SkeletonRow, type PillTone } from '@/components/primitives'
import { VoiceNoteRecorder } from '@/components/voice/VoiceNoteRecorder'
import { useVenues } from '@/lib/queries/venues'
import {
  useRouteWeek,
  useUpsertRouteDay,
  useGenerateRouteDay,
  useMarkRouteStopVisited,
  fetchRouteMapsUrl,
  todayIsoWeekdayInRange,
  WEEKDAY_LABELS,
  type RouteDay,
  type RouteStop,
} from '@/lib/queries/route'
import { FIELD_OUTCOME_OPTIONS, type FieldOutcome, outcomeLabel } from '@/lib/fieldOutcomes'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

const RADIUS_OPTIONS = [2, 3, 5, 8, 12, 20]
const TARGET_OPTIONS = [3, 4, 5, 6, 8, 10]
const SHARE_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 1.0,  label: '100% prospect' },
  { value: 0.7,  label: '70% prospect / 30% follow-up' },
  { value: 0.5,  label: '50% / 50%' },
  { value: 0.3,  label: '30% prospect / 70% follow-up' },
  { value: 0.0,  label: '100% follow-up' },
]

const STOP_KIND_TONE: Record<RouteStop['stop_kind'], PillTone> = {
  anchor: 'accent',
  follow_up: 'warning',
  prospect: 'neutral',
}

const STOP_KIND_LABEL: Record<RouteStop['stop_kind'], string> = {
  anchor: 'Anchor',
  follow_up: 'Follow-up',
  prospect: 'Prospect',
}

interface DayState {
  anchor_venue_id: string | null
  suburb_focus: string | null
  radius_km: number
  target_stops: number
  prospect_share: number
  notes: string
}

function defaultDayState(): DayState {
  return {
    anchor_venue_id: null,
    suburb_focus: null,
    radius_km: 5,
    target_stops: 5,
    prospect_share: 0.7,
    notes: '',
  }
}

function dayStateFrom(rd: RouteDay | undefined): DayState {
  if (!rd) return defaultDayState()
  return {
    anchor_venue_id: rd.anchor_venue_id,
    suburb_focus: rd.suburb_focus,
    radius_km: Number(rd.radius_km),
    target_stops: rd.target_stops,
    prospect_share: Number(rd.prospect_share),
    notes: rd.notes ?? '',
  }
}

export function RoutePage() {
  const week = useRouteWeek()
  const venues = useVenues()
  const upsert = useUpsertRouteDay()
  const generate = useGenerateRouteDay()
  const markVisited = useMarkRouteStopVisited()

  const todayIso = todayIsoWeekdayInRange()
  const isSunday = todayIso === null
  const initialTab = isSunday ? 1 : (todayIso ?? 1)
  const [activeDay, setActiveDay] = useState<number>(initialTab)

  const dayByWeekday = useMemo(() => {
    const map = new Map<number, RouteDay>()
    for (const d of week.data ?? []) map.set(d.day_of_week, d)
    return map
  }, [week.data])

  const currentRouteDay = dayByWeekday.get(activeDay)

  // Local form state — synced from server when the active route_day changes.
  // Uses the "reset state on prop change" pattern from the React docs to avoid
  // a setState-in-effect (which the React Compiler warns on).
  const [form, setForm] = useState<DayState>(() => dayStateFrom(currentRouteDay))
  const [trackedDayId, setTrackedDayId] = useState<string | undefined>(currentRouteDay?.id)
  if (currentRouteDay?.id !== trackedDayId) {
    setTrackedDayId(currentRouteDay?.id)
    setForm(dayStateFrom(currentRouteDay))
  }

  const [selectedStop, setSelectedStop] = useState<RouteStop | null>(null)
  const [outcome, setOutcome] = useState<FieldOutcome>('interested')
  const [visitNotes, setVisitNotes] = useState('')
  const [openingMaps, setOpeningMaps] = useState(false)

  const geocodedVenues = useMemo(() => {
    return (venues.data ?? [])
      .filter((v) => v.is_excluded !== true)
      .filter((v) => Number.isFinite((v as unknown as { lat?: number }).lat))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [venues.data])

  async function handleSaveSettings() {
    await upsert.mutateAsync({
      day_of_week: activeDay,
      anchor_venue_id: form.anchor_venue_id,
      suburb_focus: form.suburb_focus,
      radius_km: form.radius_km,
      target_stops: form.target_stops,
      prospect_share: form.prospect_share,
      notes: form.notes || null,
    })
    toast.success(`${WEEKDAY_LABELS[activeDay]} saved`)
  }

  async function handleSuggest() {
    let routeDayId = currentRouteDay?.id
    if (!routeDayId) {
      // Persist the day first so the SQL fn has something to operate on.
      const r = await upsert.mutateAsync({
        day_of_week: activeDay,
        anchor_venue_id: form.anchor_venue_id,
        suburb_focus: form.suburb_focus,
        radius_km: form.radius_km,
        target_stops: form.target_stops,
        prospect_share: form.prospect_share,
        notes: form.notes || null,
      })
      routeDayId = r.route_day_id
    } else if (
      currentRouteDay && (
        currentRouteDay.anchor_venue_id !== form.anchor_venue_id ||
        Number(currentRouteDay.radius_km) !== form.radius_km ||
        currentRouteDay.target_stops !== form.target_stops ||
        Number(currentRouteDay.prospect_share) !== form.prospect_share ||
        currentRouteDay.suburb_focus !== form.suburb_focus
      )
    ) {
      // Persist any pending edits so the generator sees them.
      await upsert.mutateAsync({
        day_of_week: activeDay,
        anchor_venue_id: form.anchor_venue_id,
        suburb_focus: form.suburb_focus,
        radius_km: form.radius_km,
        target_stops: form.target_stops,
        prospect_share: form.prospect_share,
        notes: form.notes || null,
      })
    }
    if (!routeDayId) return
    await generate.mutateAsync({ route_day_id: routeDayId })
  }

  async function handleOpenMaps() {
    if (!currentRouteDay) return
    setOpeningMaps(true)
    try {
      const r = await fetchRouteMapsUrl(currentRouteDay.id, false)
      window.open(r.url, '_blank', 'noopener,noreferrer')
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setOpeningMaps(false)
    }
  }

  async function handleSaveVisit() {
    if (!selectedStop) return
    await markVisited.mutateAsync({
      route_stop_id: selectedStop.id,
      outcome,
      notes: visitNotes || null,
    })
    setSelectedStop(null)
    setVisitNotes('')
  }

  const stops = currentRouteDay?.stops ?? []
  const unvisited = stops.filter((s) => !s.field_visit_id)
  const visited = stops.filter((s) => s.field_visit_id)
  const totalKm = stops.reduce((sum, s) => sum + Number(s.est_drive_km ?? 0), 0)
  const lastEta = stops.length > 0 ? stops[stops.length - 1].est_arrival_min ?? 0 : 0

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 pt-6 pb-3">
        <PageHeader
          eyebrow="Field cycle"
          title="This week's call cycle"
          description="Pick an anchor for each weekday — we'll suggest stops within your radius. Mark-visited writes to your field log and bumps the deal."
        />
      </div>

      <Tabs value={String(activeDay)} onValueChange={(v) => setActiveDay(Number(v))} className="flex-1 flex flex-col min-h-0">
        <div className="px-6">
          <TabsList className="grid grid-cols-6 w-full md:w-fit">
            {[1, 2, 3, 4, 5, 6].map((n) => {
              const has = dayByWeekday.has(n)
              return (
                <TabsTrigger key={n} value={String(n)} className="relative">
                  {WEEKDAY_LABELS[n]}
                  {has && (
                    <span
                      aria-hidden
                      className="absolute -top-0.5 right-1.5 size-1.5 rounded-full bg-[color:var(--jordan-accent-mint)]"
                    />
                  )}
                </TabsTrigger>
              )
            })}
          </TabsList>
          {isSunday && activeDay === 1 && (
            <p className="mt-2 text-[12px] text-ink-muted">
              No route days on Sunday — showing Monday.
            </p>
          )}
        </div>

        <TabsContent value={String(activeDay)} className="flex-1 min-h-0 overflow-y-auto px-6 pb-8 pt-4 space-y-5">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Anchor card */}
            <Card>
              <CardHeader>
                <CardTitle className="text-[14px]">Anchor</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1.5">
                  <CapsLabel className="text-[9px]">Anchor venue</CapsLabel>
                  <Select
                    value={form.anchor_venue_id ?? '__none__'}
                    onValueChange={(v) => setForm((s) => ({
                      ...s,
                      anchor_venue_id: v === '__none__' ? null : v,
                    }))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Pick a geocoded venue" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">— None —</SelectItem>
                      {geocodedVenues.map((v) => (
                        <SelectItem key={v.id} value={v.id}>
                          {v.name}{v.suburb ? ` · ${v.suburb}` : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {geocodedVenues.length === 0 && (
                    <p className="text-[11px] text-ink-faint">
                      No geocoded venues yet — run the venue geocoder from Settings, or add a venue with an address.
                    </p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="suburb-focus" className="text-[10px] uppercase tracking-[0.14em] text-ink-muted">
                    or Suburb focus
                  </Label>
                  <input
                    id="suburb-focus"
                    type="text"
                    value={form.suburb_focus ?? ''}
                    onChange={(e) => setForm((s) => ({ ...s, suburb_focus: e.target.value || null }))}
                    placeholder="e.g. Thornbury"
                    className="w-full rounded-md border border-hairline bg-surface-1 px-2.5 py-1.5 text-[13px]"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="day-notes" className="text-[10px] uppercase tracking-[0.14em] text-ink-muted">
                    Day note
                  </Label>
                  <Textarea
                    id="day-notes"
                    rows={2}
                    value={form.notes}
                    onChange={(e) => setForm((s) => ({ ...s, notes: e.target.value }))}
                    placeholder="Reminders, cancellations, etc."
                  />
                </div>
              </CardContent>
            </Card>

            {/* Settings card */}
            <Card>
              <CardHeader>
                <CardTitle className="text-[14px]">Suggest knobs</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <CapsLabel className="text-[9px]">Radius</CapsLabel>
                    <Select
                      value={String(form.radius_km)}
                      onValueChange={(v) => setForm((s) => ({ ...s, radius_km: Number(v) }))}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {RADIUS_OPTIONS.map((r) => (
                          <SelectItem key={r} value={String(r)}>{r} km</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <CapsLabel className="text-[9px]">Target stops</CapsLabel>
                    <Select
                      value={String(form.target_stops)}
                      onValueChange={(v) => setForm((s) => ({ ...s, target_stops: Number(v) }))}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {TARGET_OPTIONS.map((t) => (
                          <SelectItem key={t} value={String(t)}>{t} stops</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <CapsLabel className="text-[9px]">Mix</CapsLabel>
                  <Select
                    value={String(form.prospect_share)}
                    onValueChange={(v) => setForm((s) => ({ ...s, prospect_share: Number(v) }))}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {SHARE_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={String(opt.value)}>{opt.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex flex-wrap gap-2 pt-1">
                  <Button
                    type="button"
                    variant="default"
                    onClick={handleSuggest}
                    disabled={generate.isPending || upsert.isPending}
                    className="gap-1.5"
                  >
                    {generate.isPending
                      ? <Loader2 className="size-4 animate-spin" />
                      : <Sparkles className="size-4" />}
                    Suggest {form.target_stops} stops
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleSaveSettings}
                    disabled={upsert.isPending}
                  >
                    Save
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Stop list */}
          <Card>
            <CardHeader className="flex-row items-center justify-between gap-3">
              <div>
                <CardTitle className="text-[14px]">Stops</CardTitle>
                {stops.length > 0 && (
                  <p className="text-[12px] text-ink-muted mt-0.5 jordan-tnum">
                    {stops.length} stops · {totalKm.toFixed(1)} km · ~{lastEta} min
                    {visited.length > 0 ? ` · ${visited.length} visited` : ''}
                  </p>
                )}
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleOpenMaps}
                  disabled={!currentRouteDay || unvisited.length === 0 || openingMaps}
                  className="gap-1.5"
                >
                  {openingMaps ? <Loader2 className="size-4 animate-spin" /> : <Navigation className="size-4" />}
                  Open in Maps
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleSuggest}
                  disabled={!currentRouteDay || generate.isPending}
                  className="gap-1.5"
                >
                  <RotateCw className="size-4" />
                  Re-generate
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {week.isLoading ? (
                <div className="space-y-1.5">
                  {[0, 1, 2, 3].map((i) => <SkeletonRow key={i} />)}
                </div>
              ) : stops.length === 0 ? (
                <EmptyState
                  icon={MapPin}
                  title="No stops yet"
                  body="Pick an anchor and tap Suggest to populate the day."
                />
              ) : (
                <ul className="divide-y divide-hairline">
                  {stops.map((stop, i) => (
                    <RouteStopRow
                      key={stop.id}
                      stop={stop}
                      index={i}
                      onMarkVisited={() => {
                        setSelectedStop(stop)
                        setOutcome('interested')
                        setVisitNotes('')
                      }}
                    />
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Sheet
        open={selectedStop !== null}
        onOpenChange={(open) => { if (!open) setSelectedStop(null) }}
      >
        <SheetContent side="right" className="space-y-4 sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Mark visited — {selectedStop?.venue_name_cached ?? ''}</SheetTitle>
            <SheetDescription>
              {selectedStop?.suburb_cached ?? ''}
            </SheetDescription>
          </SheetHeader>

          <div className="space-y-1.5">
            <Label htmlFor="visit-outcome">Outcome</Label>
            <Select value={outcome} onValueChange={(v) => setOutcome(v as FieldOutcome)}>
              <SelectTrigger id="visit-outcome">
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
            <Label htmlFor="visit-notes">Notes</Label>
            <Textarea
              id="visit-notes"
              rows={4}
              value={visitNotes}
              onChange={(e) => setVisitNotes(e.target.value)}
              placeholder="What happened? Any quotes, vibes, follow-ups?"
            />
          </div>

          <div className="flex items-center gap-2">
            <VoiceNoteRecorder
              variant="compact"
              onResult={(res) => {
                if (res.transcript) {
                  setVisitNotes((p) => p ? `${p}\n${res.transcript}` : res.transcript ?? '')
                }
              }}
            />
            <Button
              type="button"
              className="flex-1"
              onClick={handleSaveVisit}
              disabled={markVisited.isPending}
            >
              {markVisited.isPending ? <Loader2 className="size-4 animate-spin mr-2" /> : null}
              Save visit
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setSelectedStop(null)}
              aria-label="Close"
            >
              <X className="size-4" />
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}

function RouteStopRow({
  stop,
  index,
  onMarkVisited,
}: {
  stop: RouteStop
  index: number
  onMarkVisited: () => void
}) {
  const visited = stop.field_visit_id != null
  const tone = STOP_KIND_TONE[stop.stop_kind]
  return (
    <li className="flex items-start gap-3 py-2.5">
      <div className="w-6 text-center text-[11px] text-ink-faint jordan-tnum">{index + 1}</div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <StatusPill tone={tone}>{STOP_KIND_LABEL[stop.stop_kind]}</StatusPill>
          <p className="text-[13px] font-medium text-ink truncate">{stop.venue_name_cached}</p>
          {stop.lead_score_cached != null && (
            <ScoreBadge score={stop.lead_score_cached} />
          )}
        </div>
        <p className="text-[12px] text-ink-muted jordan-tnum">
          {stop.suburb_cached ?? ''}
          {stop.est_drive_km != null ? ` · ${Number(stop.est_drive_km).toFixed(1)} km` : ''}
          {stop.est_arrival_min != null ? ` · ~${stop.est_arrival_min} min` : ''}
        </p>
        {visited && stop.field_visit && (
          <p className="text-[11.5px] text-[color:var(--jordan-success-text)] mt-0.5">
            Visited · {outcomeLabel(stop.field_visit.outcome)}
          </p>
        )}
      </div>
      <div className="shrink-0">
        {visited ? (
          <span className={cn('text-[12px] text-[color:var(--jordan-success-text)]')}>✓</span>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onMarkVisited}
          >
            Mark visited
          </Button>
        )}
      </div>
    </li>
  )
}
