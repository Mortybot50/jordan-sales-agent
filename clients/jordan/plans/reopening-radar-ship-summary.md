# Reopening Radar — Ship Summary

**Shipped:** 25/04/2026 (AEST)
**PR:** [#9](https://github.com/Mortybot50/jordan-sales-agent/pull/9) — squash-merged to `main` as `9579bd2`
**Prod bundle:** `index-aMf5HWRz.js` (verified contains `Reopening Radar`, `signal_reopening`, `reopening-radar-manual`)
**Mode:** stub (`REOPENING_RADAR_LIVE=false`) — GATE-5 still pending

## What it does

Passive watcher that detects VIC hospitality venues moving CLOSED → ACTIVE and surfaces them as fresh leads at the moment of reopening. Three sources: VCGLR scrape, Google Places business_status delta, manual tip. Five event types: `reopened`, `licensee_changed`, `renamed`, `status_flip`, `manual`.

## What landed

### Schema (`20260425000001_reopening_radar.sql`)

| Object | Purpose |
|---|---|
| `venue_observations` | Per-source snapshot of a venue at observed_at — name, address, suburb, licensee, business_status, evidence_url, raw |
| `reopening_events` | Detected transitions between observations — links prior + new observation, event_type, contact_id (set on promote) |
| `contacts.signal_reopening` jsonb | Set when a Radar event is promoted to a contact — drives the "Recently reopened" pill on Pipeline cards |
| Indexes | `(org_id, source, external_id, observed_at desc)` for prior lookup; `(org_id, detected_at desc) where dismissed_at is null and contact_id is null` for the active list |
| RLS | All three policy sets use `auth_org_id()` — no cross-tenant access |

### Edge Functions (deployed to `bsevgxhnxlkzkcalevbb`)

| Function | Auth | Mode |
|---|---|---|
| `reopening-radar-poll` | service-role (cron) | Stub by default; flip `REOPENING_RADAR_LIVE=true` after GATE-5 |
| `reopening-radar-manual` | user JWT (RLS-enforced) | Always live — for Jordan's manual tips |
| `send-morning-briefing` | service-role | Now includes "Reopened This Week" section |

### UI

- **`/reopening-radar`** — full list with Venue / Suburb / Source / Detected / Transition columns, Add to pipeline + Dismiss + Source link actions, inline tip form
- **Sidebar** — Radar icon entry between Pipeline and Briefing (sales section)
- **Dashboard KPI card** — "Reopened this week" with 30d sparkline (light card; Dark Anchor stays capped at 4)
- **Pipeline DealCard** — mint pill "Recently reopened" when the linked contact has `signal_reopening`
- **Briefing email** — "📡 Reopened This Week" section with mint accent, undismissed/unconverted events from last 7 days

## Smoke test

| Probe | Result |
|---|---|
| Migration applied | `20260425000001_reopening_radar` listed in `list_migrations` |
| Edge Fn deploy | `reopening-radar-poll` v1 ACTIVE, `reopening-radar-manual` v1 ACTIVE, `send-morning-briefing` redeployed via CLI |
| Local typecheck | `npx tsc -b` clean |
| Local build | `npm run build` 301ms green |
| Seed 3 events for demo org | 1× `reopened`, 1× `licensee_changed`, 1× `manual` — all visible via the briefing query |
| Promote 1 to pipeline | Contact "Smith Street Espresso (lead)" created with full `signal_reopening` JSON; `reopening_events.contact_id` linked; activity row inserted |
| KPI counts | this_week=3, active_unconverted=2 after promote |
| Prod bundle | `index-aMf5HWRz.js` contains all expected strings |

## Hard rules respected

- ✅ Stub mode by default — `REOPENING_RADAR_LIVE` defaults to `false`; live scrapers return `[]` until explicitly flipped
- ✅ Demo password not reset
- ✅ No new design tokens — reused Phase F mint (`--jordan-accent-mint`, `--jordan-accent-mint-soft`, `--jordan-success-text`)
- ✅ Multi-tenant from day 1 — every new table carries `org_id`, RLS via `auth_org_id()`
- ✅ Conventional commit; PR #9 merged via squash

## Follow-ups (future work, not blocking)

- Implement `fetchVcglr()` once GATE-5 (VCGLR licence_number scrape validation) clears
- Implement `fetchGooglePlaces()` — call Places Details API with `fields=place_id,business_status,name,formatted_address` for tracked `venues.google_place_id`
- Schedule `reopening-radar-poll` via Supabase cron (e.g. daily 04:00 UTC)
- Wire `compute_lead_score(p_contact_id)` boost into the promote path so reopening leads get an automatic score bump
