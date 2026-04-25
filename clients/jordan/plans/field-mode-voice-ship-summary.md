# Field Mode + Voice-Note Capture + Auth Hardening — Ship Summary

**Shipped:** 25/04/2026 (AEST)
**PR:** [#10](https://github.com/Mortybot50/jordan-sales-agent/pull/10) — squash-merged to `main` as `95a3807`
**Prod bundle:** `index-DbXJCFPq.js` (verified to contain `Field Mode`, `Voice note`, `maplibregl`, `/functions/v1/voice-transcribe`)
**Branch:** `feature/field-mode-voice` (deleted post-merge)

## What landed

Three coupled features that turn LeadFlow into a road-ready sales tool:

1. **Auth hardening** — eliminates iOS Safari PWA cold-start hang.
2. **Field Mode** — map-based day-trip planner with route optimisation and walk-in visit logging.
3. **Voice-note capture** — hold-to-record from both Field Mode and Contacts, with transcript + entity extraction.

---

## 1. fix(auth): timeout + clear stale session

`src/hooks/useAuth.ts` now wraps `supabase.auth.getSession()` in a 5s `Promise.race`. On timeout/error:

- Clears `sb-<projectRef>-auth-token` from localStorage (and any other `sb-*-auth-token` keys as belt-and-braces).
- Redirects to `/login`.
- Surfaces a toast: "Session expired — please sign in again".

| Behaviour | Before | After |
|---|---|---|
| Stale-session cold-start on iOS Safari standalone PWA | indefinite white screen | 5s → cleared → redirect → toast |
| Healthy session bootstrap | unchanged | unchanged |

---

## 2. feat(field-mode): map + route optimiser + walk-in logger

### Schema (`20260425000002_field_mode.sql`)

| Object | Purpose |
|---|---|
| `contacts.lat`, `contacts.lng`, `contacts.geocoded_at` | Forward-geocoded venue location used to pin contacts on the map |
| `contacts.last_visited_at` | Bumped by trigger when a `field_visit` row inserts |
| `venue_observations.lat/lng/geocoded_at` | Map pins for reopening events |
| `field_visits` | (org_id, contact_id, user_id, outcome, notes, voice_audio_path, visited_at, lat, lng) with RLS scoped to `auth_org_id()` AND `auth.uid() = user_id` |
| `handle_field_visit_insert()` trigger | Mirrors the visit row into `activities` (`activity_type='field_visit'`, body = outcome + notes) and updates `contacts.last_visited_at` |
| `voice-notes` Storage bucket | Per-user folder RLS — uploads must be under `auth.uid()/...` |
| `activities_activity_type_check` constraint | Extended to include `field_visit` and `voice_note` (existing values preserved) |

### Edge Functions (deployed ACTIVE to `bsevgxhnxlkzkcalevbb`)

| Function | Verify JWT | Notes |
|---|---|---|
| `geocode-batch` | true | Forward-geocodes via Nominatim (free, OSM). 1 req/s, 25-row batches. RLS-enforced via user JWT. |
| `field-route-optimize` | true | Greedy nearest-neighbour TSP, Haversine distance, 30 km/h ETA assumption. Pure arithmetic — no DB writes. |

### UI

`/field` route — 60/40 split (MapLibre map | drop-in form):

- **Map:** MapLibre GL JS + OSM `demotiles` style. Melbourne-centred. DOM markers coloured by pin kind:
  - mint = warm contact
  - amber (`--jordan-warning`) = active deal
  - danger (`--jordan-danger`) = reopening event
  - faint = cold contact
- **Filters:** suburb dropdown, kind toggle chips.
- **"Plan today":** calls `field-route-optimize` with selected pins, renumbers markers in optimised order, shows total km + ETA.
- **Drop-in form:** outcome dropdown (interested / not_now / closed / not_in / dm_absent / other), notes textarea, voice recorder, Save.

Phase F Dark Anchor tokens only — no new tokens added.

---

## 3. feat(voice-note): hold-to-record + transcribe + extract

### Edge Function (deployed ACTIVE)

| Function | Verify JWT | Notes |
|---|---|---|
| `voice-transcribe` | true | Multipart audio upload → Storage (`voice-notes/{user_id}/{uuid}.webm`) → Whisper (`whisper-1`) → optional Claude Haiku entity extraction (`venue_name`, `address`, `suburb`, `outcome_hint`, `notes`). Graceful degrade when `OPENAI_API_KEY` is absent — audio still saves and the path is returned. |

### Components

| File | Purpose |
|---|---|
| `src/components/voice/VoiceNoteRecorder.tsx` | Hold-to-record button using `MediaRecorder`. Phases: `idle` / `recording` / `uploading` / `denied`. Uploads to `voice-transcribe` and surfaces `VoiceTranscriptionResult` to the parent. |
| `src/components/voice/ContactVoiceNoteDialog.tsx` | Modal triggered from Contacts page. Fuzzy-matches extracted `venue_name` against existing contacts. Three CTAs: "Log on {match}", "Create new contact" (prefills `/contacts/new` with extracted hints), "Just log it". |

### Surfaces

- **Field Mode "Just visited" form:** voice recorder inline.
- **Contacts page top bar:** new "Voice note" action button → opens dialog.

---

## Smoke proof

| Probe | Result |
|---|---|
| `npx tsc -b` | exit 0 |
| `npm run build` | dist built, 2.1MB JS, 184KB CSS |
| `gh pr merge 10 --squash` | merged to `main` as `95a3807` |
| `vercel --prod` | aliased to `https://jordan-sales-agent.vercel.app` (prod deploy `eq71gs9y3`) |
| `curl /` → bundle | served `index-DbXJCFPq.js` (2.13MB) |
| `strings bundle.js | grep "Field Mode"` | 2 hits |
| `strings bundle.js | grep "Voice note"` | 5 hits |
| `strings bundle.js | grep maplibregl` | 3 hits |
| `strings bundle.js | grep voice-transcribe` | confirmed (`/functions/v1/voice-transcribe`) |
| Edge Functions list | `geocode-batch` ACTIVE, `field-route-optimize` ACTIVE, `voice-transcribe` ACTIVE |
| Migration | `20260425000002_field_mode.sql` applied — `field_visits` + lat/lng columns + voice-notes bucket present |

---

## What's deferred

- **Voice transcription requires `OPENAI_API_KEY`** in Supabase secrets. Until set, audio uploads succeed and audio_path is returned — but transcript is null. Set once Morty's ready.
- **Claude Haiku extraction** requires `ANTHROPIC_API_KEY` in Supabase secrets. Otherwise transcript is returned without structured fields.
- **Initial geocoding** of existing demo contacts: run `geocode-batch` once with empty body to forward-geocode up to 25 contacts and venue_observations in the org.
- **Bundle size warning** (2.13MB JS) — MapLibre is ~600KB unzipped. Worth a future code-split for `/field` if mobile data becomes a concern.

---

## Constraints honoured

- [x] Demo password untouched
- [x] Phase F Dark Anchor tokens only — no new tokens
- [x] Multi-tenant from day 1: org_id on `field_visits`, RLS on table + storage bucket
- [x] MapLibre GL JS + OSM (no Mapbox)
- [x] Build does not block on missing `OPENAI_API_KEY`
- [x] End on green main, deployed to prod, with smoke proof
- [x] Conventional commits (`fix(auth):`, `feat(field-mode):`, `feat(voice-note):`)
